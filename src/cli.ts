// Runs a job on this computer, the same way the workflows do.
//
//   npm run job -- flight-history --check
//   npm run job -- flight-history --month 2026-08
//   npm run job -- flight-history --from 2022-01 --to 2026-08

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Job } from './lib/job.ts';
import { type Month, monthsBetween, parseMonth } from './lib/months.ts';

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
		month: { type: 'string' },
		from: { type: 'string' },
		to: { type: 'string' },
	},
});

const [name] = positionals;
const names = await jobNames();

if (!name || !names.includes(name)) {
	console.error(
		`Usage: npm run job -- JOB [--check | --month YYYY-MM | --from YYYY-MM --to YYYY-MM]`,
	);
	console.error(`Jobs: ${names.join(', ')}`);
	process.exit(1);
}

const job: Job = (await import(`./${name}/index.ts`)).default;

if (values.check) {
	const { note } = await job.check();
	console.log(`${job.name}: ${note}`);
	process.exit(0);
}

let months: Month[];

if (values.month) {
	months = [parseMonth(values.month)];
} else if (values.from && values.to) {
	months = monthsBetween(parseMonth(values.from), parseMonth(values.to));
} else {
	console.error('Say which update: --month YYYY-MM, or --from YYYY-MM --to YYYY-MM.');
	process.exit(1);
}

for (const month of months) {
	const build = await job.build(month);
	const path = join(root, build.path);

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, build.contents);

	console.log(`${build.path}`);
	if (months.length === 1) {
		console.log(`\n${build.summary}`);
	}
}
