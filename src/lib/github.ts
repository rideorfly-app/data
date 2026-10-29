/** Where to send requests, who we are, and the fetch to use (swapped in tests). */
export interface GitHub {
	token: string;

	/** `owner/name`, as GitHub Actions gives it in `GITHUB_REPOSITORY`. */
	repo: string;
	apiUrl?: string;
	fetch?: typeof fetch;
}

/** A file to put in a commit. */
export interface CommitFile {
	path: string;
	content: Buffer;
}

async function call<T>(
	github: GitHub,
	method: string,
	path: string,
	body?: object,
	okStatuses: readonly number[] = [],
): Promise<{ status: number; data: T }> {
	const response = await (github.fetch ?? fetch)(
		`${github.apiUrl ?? 'https://api.github.com'}/repos/${github.repo}${path}`,
		{
			method,
			headers: {
				Authorization: `Bearer ${github.token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		},
	);

	if (!response.ok && !okStatuses.includes(response.status)) {
		throw new Error(
			`GitHub said ${response.status} to ${method} ${path}: ${(await response.text()).slice(0, 300)}`,
		);
	}

	const text = await response.text();

	return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
}

/** The commit a branch points at, or null when the branch doesn't exist. */
export async function branchHead(github: GitHub, branch: string): Promise<string | null> {
	const { status, data } = await call<{ object: { sha: string } }>(
		github,
		'GET',
		`/git/ref/heads/${branch}`,
		undefined,
		[404],
	);

	return status === 404 ? null : data.object.sha;
}

/** The number of an open pull request from this branch, or null. */
export async function openPullRequest(github: GitHub, branch: string): Promise<number | null> {
	const owner = github.repo.split('/')[0];
	const { data } = await call<{ number: number }[]>(
		github,
		'GET',
		`/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
	);

	return data[0]?.number ?? null;
}

/**
 * Makes a branch from the tip of `base` with one commit that adds the files.
 * The commit is made through the API with the workflow's own token, which GitHub
 * signs, so it passes `master`'s signed-commits rule. (A commit made with `git`
 * on the runner and pushed would be unsigned.)
 */
export async function commitFiles(
	github: GitHub,
	options: { base: string; branch: string; message: string; files: readonly CommitFile[] },
): Promise<string> {
	const baseSha = await branchHead(github, options.base);

	if (!baseSha) {
		throw new Error(`The branch "${options.base}" wasn't found.`);
	}

	const baseCommit = (
		await call<{ tree: { sha: string } }>(github, 'GET', `/git/commits/${baseSha}`)
	).data;
	const tree: { path: string; mode: string; type: string; sha: string }[] = [];

	for (const file of options.files) {
		const blob = await call<{ sha: string }>(github, 'POST', '/git/blobs', {
			content: file.content.toString('base64'),
			encoding: 'base64',
		});

		tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.data.sha });
	}

	const newTree = await call<{ sha: string }>(github, 'POST', '/git/trees', {
		base_tree: baseCommit.tree.sha,
		tree,
	});
	const commit = await call<{ sha: string }>(github, 'POST', '/git/commits', {
		message: options.message,
		tree: newTree.data.sha,
		parents: [baseSha],
	});

	await call(github, 'POST', '/git/refs', {
		ref: `refs/heads/${options.branch}`,
		sha: commit.data.sha,
	});

	return commit.data.sha;
}

/** Opens a pull request and, if given, asks someone to review it. Returns its number and address. */
export async function openPull(
	github: GitHub,
	options: { base: string; branch: string; title: string; body: string; reviewer?: string },
): Promise<{ number: number; url: string }> {
	const { data } = await call<{ number: number; html_url: string }>(github, 'POST', '/pulls', {
		title: options.title,
		head: options.branch,
		base: options.base,
		body: options.body,
	});

	if (options.reviewer) {
		await call(github, 'POST', `/pulls/${data.number}/requested_reviewers`, {
			reviewers: [options.reviewer],
		});
	}

	return { number: data.number, url: data.html_url };
}

/**
 * Starts a workflow on a branch, with inputs if it takes any. GitHub doesn't run
 * other workflows for a pull request opened with a workflow's own token, but it
 * does allow this one call. `repo` names another repository when the workflow
 * lives elsewhere (the token must be allowed to start workflows there).
 */
export async function dispatchWorkflow(
	github: GitHub,
	workflow: string,
	ref: string,
	inputs?: Record<string, string>,
): Promise<void> {
	await call(github, 'POST', `/actions/workflows/${workflow}/dispatches`, {
		ref,
		...(inputs ? { inputs } : {}),
	});
}
