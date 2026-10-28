import { describe, expect, it } from 'vitest';
import {
	branchHead,
	commitFiles,
	dispatchWorkflow,
	type GitHub,
	openPull,
	openPullRequest,
} from '../../src/lib/github.ts';

interface Request {
	method: string;
	path: string;
	body: unknown;
	authorization: string | null;
}

/** A GitHub that answers from a table of "METHOD /path" and records what it was asked. */
function fake(answers: Record<string, { status?: number; body?: unknown }>) {
	const requests: Request[] = [];
	const github: GitHub = {
		token: 'secret-token',
		repo: 'rideorfly-app/data',
		apiUrl: 'https://api.test',
		fetch: (async (url: string, init: RequestInit) => {
			const path = url.replace('https://api.test/repos/rideorfly-app/data', '');
			const key = `${init.method} ${path}`;

			requests.push({
				method: init.method ?? '',
				path,
				body: init.body ? JSON.parse(init.body as string) : undefined,
				authorization: new Headers(init.headers).get('Authorization'),
			});

			const answer = answers[key];

			if (!answer) {
				throw new Error(`Unexpected request: ${key}`);
			}

			return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
				status: answer.status ?? 200,
			});
		}) as typeof fetch,
	};

	return { github, requests };
}

describe('branchHead', () => {
	it('returns the commit a branch points at, and null when there is no such branch', async () => {
		const { github } = fake({
			'GET /git/ref/heads/master': { body: { object: { sha: 'abc' } } },
			'GET /git/ref/heads/update/gas-prices/2026-10-26': {
				status: 404,
				body: { message: 'Not Found' },
			},
		});

		expect(await branchHead(github, 'master')).toBe('abc');
		expect(await branchHead(github, 'update/gas-prices/2026-10-26')).toBeNull();
	});

	it('fails loudly on any other error, and never prints the token', async () => {
		const { github } = fake({
			'GET /git/ref/heads/master': { status: 500, body: { message: 'boom' } },
		});
		const error = await branchHead(github, 'master').catch((e: Error) => e);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain('GitHub said 500 to GET /git/ref/heads/master');
		expect((error as Error).message).not.toContain('secret-token');
	});
});

describe('openPullRequest', () => {
	it('finds an open pull request from a branch in this repo, or null', async () => {
		const head = encodeURIComponent('rideorfly-app:update/a');
		const { github, requests } = fake({
			[`GET /pulls?state=open&head=${head}`]: { body: [{ number: 7 }] },
			[`GET /pulls?state=open&head=${encodeURIComponent('rideorfly-app:update/b')}`]: { body: [] },
		});

		expect(await openPullRequest(github, 'update/a')).toBe(7);
		expect(await openPullRequest(github, 'update/b')).toBeNull();
		expect(requests[0]?.authorization).toBe('Bearer secret-token');
	});
});

describe('commitFiles', () => {
	const answers = {
		'GET /git/ref/heads/master': { body: { object: { sha: 'base-sha' } } },
		'GET /git/commits/base-sha': { body: { tree: { sha: 'base-tree' } } },
		'POST /git/blobs': { status: 201, body: { sha: 'blob-sha' } },
		'POST /git/trees': { status: 201, body: { sha: 'new-tree' } },
		'POST /git/commits': { status: 201, body: { sha: 'new-commit' } },
		'POST /git/refs': { status: 201, body: {} },
	};

	it('adds the files to a new branch from the tip of master, with no author so GitHub signs it', async () => {
		const { github, requests } = fake(answers);
		const sha = await commitFiles(github, {
			base: 'master',
			branch: 'update/gas-prices/2026-10-26',
			message: 'Gas prices for 2026-10-26',
			files: [{ path: 'datasets/gas-prices/2026-10-26.json', content: Buffer.from('[\n]\n') }],
		});

		expect(sha).toBe('new-commit');
		expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
			'GET /git/ref/heads/master',
			'GET /git/commits/base-sha',
			'POST /git/blobs',
			'POST /git/trees',
			'POST /git/commits',
			'POST /git/refs',
		]);
		expect(requests[2]?.body).toEqual({
			content: Buffer.from('[\n]\n').toString('base64'),
			encoding: 'base64',
		});
		expect(requests[3]?.body).toEqual({
			base_tree: 'base-tree',
			tree: [
				{
					path: 'datasets/gas-prices/2026-10-26.json',
					mode: '100644',
					type: 'blob',
					sha: 'blob-sha',
				},
			],
		});
		expect(requests[4]?.body).toEqual({
			message: 'Gas prices for 2026-10-26',
			tree: 'new-tree',
			parents: ['base-sha'],
		});
		expect(requests[5]?.body).toEqual({
			ref: 'refs/heads/update/gas-prices/2026-10-26',
			sha: 'new-commit',
		});
	});

	it('keeps binary-safe content: bytes come back out of the base64 unchanged', async () => {
		const { github, requests } = fake(answers);
		const content = Buffer.from([0, 255, 10, 13, 128]);

		await commitFiles(github, {
			base: 'master',
			branch: 'b',
			message: 'm',
			files: [{ path: 'x.bin', content }],
		});

		const sent = requests[2]?.body as { content: string };

		expect(Buffer.from(sent.content, 'base64').equals(content)).toBe(true);
	});

	it('stops if the base branch is missing', async () => {
		const { github } = fake({ 'GET /git/ref/heads/main': { status: 404, body: {} } });

		await expect(
			commitFiles(github, { base: 'main', branch: 'b', message: 'm', files: [] }),
		).rejects.toThrow(/"main" wasn't found/);
	});
});

describe('openPull', () => {
	it('opens a pull request and asks the reviewer, when there is one', async () => {
		const { github, requests } = fake({
			'POST /pulls': { status: 201, body: { number: 12, html_url: 'https://github.test/pull/12' } },
			'POST /pulls/12/requested_reviewers': { status: 201, body: {} },
		});
		const pull = await openPull(github, {
			base: 'master',
			branch: 'update/x',
			title: 'T',
			body: 'B',
			reviewer: 'owner',
		});

		expect(pull).toEqual({ number: 12, url: 'https://github.test/pull/12' });
		expect(requests[0]?.body).toEqual({ title: 'T', head: 'update/x', base: 'master', body: 'B' });
		expect(requests[1]?.body).toEqual({ reviewers: ['owner'] });
	});

	it('skips the reviewer request when no reviewer is named', async () => {
		const { github, requests } = fake({
			'POST /pulls': { status: 201, body: { number: 3, html_url: 'u' } },
		});

		await openPull(github, { base: 'master', branch: 'b', title: 'T', body: 'B' });
		expect(requests).toHaveLength(1);
	});
});

describe('dispatchWorkflow', () => {
	it('starts a workflow on a branch', async () => {
		const { github, requests } = fake({
			'POST /actions/workflows/tests.yml/dispatches': { status: 204 },
		});

		await dispatchWorkflow(github, 'tests.yml', 'update/x');
		expect(requests[0]?.body).toEqual({ ref: 'update/x' });
	});
});
