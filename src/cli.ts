// Runs a job on this computer, the same way the workflows do.
//
//   npm run job -- flight-history --check
//   npm run job -- flight-history --month 2026-08
//   npm run job -- flight-history --from 2022-01 --to 2026-08
//   npm run job -- gas-prices --update 2026-10-26     (weekly and yearly jobs name an update)
//
// The workflows use three more options:
//   node src/cli.ts --list                            the jobs, as a JSON list
//   node src/cli.ts gas-prices --next                 prints only the next update's name (nothing if up to date)
//   node src/cli.ts gas-prices --update 2026-10-26 --summary-file summary.md
//                                                     also writes the pull request text to a file

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Job } from './lib/job.ts';
import { monthsBetween, parseMonth } from './lib/months.ts';

const root = join(import.meta.dirname, '..');

/** Every job is a folder in `src/` other than `lib/`. */
async function jobNames(): Promise<string[]> {
	const entries = await readdir(import.meta.dirname, { withFileTypes: true });

	return entries.filter((e) => e.isDirectory() && e.name !== 'lib').map((e) => e.name);
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		check: { type: 'boolean' },
		list: { type: 'boolean' },
		next: { type: 'boolean' },
		'summary-file': { type: 'string' },
		month: { type: 'string' },
		from: { type: 'string' },
		to: { type: 'string' },
		update: { type: 'string', multiple: true },
	},
});

const [name] = positionals;
const names = await jobNames();

if (values.list) {
	console.log(JSON.stringify(names.sort()));
	process.exit(0);
}

if (!name || !names.includes(name)) {
	console.error(
		`Usage: npm run job -- JOB [--check | --month YYYY-MM | --from YYYY-MM --to YYYY-MM | --update ID]`,
	);
	console.error(`Jobs: ${names.join(', ')}`);
	process.exit(1);
}

const job: Job = (await import(`./${name}/index.ts`)).default;

if (values.next) {
	const { next } = await job.check();
	console.log(next ?? '');
	process.exit(0);
}

if (values.check) {
	const { note } = await job.check();
	console.log(`${job.name}: ${note}`);
	process.exit(0);
}

let updates: string[];

if (values.update?.length) {
	updates = values.update;
} else if (values.month) {
	updates = [parseMonth(values.month)];
} else if (values.from && values.to) {
	updates = monthsBetween(parseMonth(values.from), parseMonth(values.to));
} else {
	console.error(
		'Say which update: --month YYYY-MM, --from YYYY-MM --to YYYY-MM, or --update ID (a week or a year).',
	);
	process.exit(1);
}

for (const update of updates) {
	const build = await job.build(update);
	const path = join(root, build.path);

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, build.contents);

	console.log(`${build.path}`);

	if (values['summary-file'] && updates.length === 1) {
		await writeFile(values['summary-file'], build.summary);
	}
	if (updates.length === 1) {
		console.log(`\n${build.summary}`);
	}
}
