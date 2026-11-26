// Posts an Announcement for a new accuracy report, from inside the Release data
// workflow: finds the newest accuracy report this release has that the one before
// did not, builds the post, and starts the posting workflow in the `.github` repo.
//
//   node src/announce.ts manifest.json previous-manifest.json 2026-10-14
//   node src/announce.ts manifest.json - 2026-10-14        (no earlier release)
//
// Needs ANNOUNCE_TOKEN, a token allowed to start workflows in the `.github` repo
// and nothing else. ANNOUNCE_REPO (default `<owner>/.github`) and ANNOUNCE_REF
// (default `master`) say where. Prints what it would post and does nothing else
// when there is no new report.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPost } from './accuracy/post.ts';
import type { ReportRow } from './accuracy/report.ts';
import { newestNewReport } from './lib/announce.ts';
import { dispatchWorkflow } from './lib/github.ts';
import type { Manifest } from './lib/manifest.ts';

const [manifestPath, previousPath, release] = process.argv.slice(2);

if (!manifestPath || !previousPath || !release) {
	console.error('Usage: node src/announce.ts MANIFEST PREVIOUS_MANIFEST_OR_DASH RELEASE');
	process.exit(1);
}

const read = async (path: string): Promise<Manifest> => JSON.parse(await readFile(path, 'utf8'));
const manifest = await read(manifestPath);
const report = newestNewReport(manifest, previousPath === '-' ? null : await read(previousPath));

if (!report) {
	console.log('No new accuracy report in this release, so nothing to announce.');
	process.exit(0);
}

const root = join(import.meta.dirname, '..');
const post = buildPost(
	JSON.parse(await readFile(join(root, report.path), 'utf8')) as ReportRow[],
	release,
);
const token = process.env.ANNOUNCE_TOKEN;
const repo = process.env.ANNOUNCE_REPO || `${process.env.GITHUB_REPOSITORY_OWNER}/.github`;

if (!token) {
	console.error(
		`There is a new report (${report.covers}) to announce, but ANNOUNCE_TOKEN is not set.`,
	);
	process.exit(1);
}

await dispatchWorkflow({ token, repo }, 'announce.yml', process.env.ANNOUNCE_REF || 'master', {
	title: post.title,
	body: post.body,
});
console.log(`Asked ${repo} to post "${post.title}".`);
