// Opens a pull request for one update, from inside a GitHub Actions run.
//
//   node src/pr.ts --branch update/gas-prices/2026-10-26 --title "Gas prices for 2026-10-26" \
//     --body-file summary.md --file datasets/gas-prices/2026-10-26.json
//
// Needs GITHUB_TOKEN and GITHUB_REPOSITORY (Actions provides both). PR_REVIEWER,
// a GitHub username, is optional. Does nothing if the branch or a pull request
// for it already exists, so a run that repeats an update is harmless.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
	branchHead,
	commitFiles,
	dispatchWorkflow,
	type GitHub,
	openPull,
	openPullRequest,
} from './lib/github.ts';

const { values } = parseArgs({
	options: {
		branch: { type: 'string' },
		title: { type: 'string' },
		'body-file': { type: 'string' },
		file: { type: 'string', multiple: true },
		base: { type: 'string', default: 'master' },
	},
});

const { token, repo } = { token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY };

if (!values.branch || !values.title || !values['body-file'] || !values.file?.length) {
	console.error(
		'Usage: node src/pr.ts --branch B --title T --body-file F --file PATH [--file PATH ...]',
	);
	process.exit(1);
}

if (!token || !repo) {
	console.error('GITHUB_TOKEN and GITHUB_REPOSITORY are needed. GitHub Actions sets both.');
	process.exit(1);
}

const github: GitHub = { token, repo, apiUrl: process.env.GITHUB_API_URL };
const root = join(import.meta.dirname, '..');
const existing =
	(await openPullRequest(github, values.branch)) ?? (await branchHead(github, values.branch));

if (existing) {
	console.log(`Skipped: ${values.branch} already has a branch or an open pull request.`);
	process.exit(0);
}

await commitFiles(github, {
	base: values.base,
	branch: values.branch,
	message: values.title,
	files: await Promise.all(
		values.file.map(async (path) => ({ path, content: await readFile(join(root, path)) })),
	),
});

const pull = await openPull(github, {
	base: values.base,
	branch: values.branch,
	title: values.title,
	body: await readFile(values['body-file'], 'utf8'),
	reviewer: process.env.PR_REVIEWER || undefined,
});

await dispatchWorkflow(github, 'tests.yml', values.branch);
console.log(`Opened ${pull.url}`);
