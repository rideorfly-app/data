import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { download, exists } from '../lib/download.ts';
import type { Build, Job } from '../lib/job.ts';
import { formatRows } from '../lib/write.ts';
import { runChecks } from './checks.ts';
import { type RoadSafetyRow, readDeaths, readMiles, toRows } from './read.ts';
import { summarize } from './summary.ts';

const root = join(import.meta.dirname, '..', '..');
const folder = 'datasets/road-safety';

/** NHTSA's FARS crash files for a year, as CSV in a zip. No key is needed. */
export const farsUrl = (year: number) =>
	`https://static.nhtsa.gov/nhtsa/downloads/FARS/${year}/National/FARS${year}NationalCSV.zip`;

/** FHWA's table VM-2, vehicle miles of travel by state, as a spreadsheet. */
export const milesUrl = (year: number) =>
	`https://www.fhwa.dot.gov/policyinformation/statistics/${year}/xls/vm2.xlsx`;

/** The years already in the repo, oldest first, as `2023`. */
export async function yearsOnHand(directory = join(root, folder)): Promise<string[]> {
	const names = await readdir(directory).catch(() => []);

	return names
		.filter((name) => /^\d{4}\.json$/.test(name))
		.map((name) => name.slice(0, 4))
		.sort();
}

/**
 * The year after the newest one on hand, if both NHTSA and FHWA have published
 * it. The years come one at a time, so a gap in the repo is never skipped over.
 */
export async function nextYear(
	have: readonly string[],
	published: (year: number) => Promise<boolean>,
): Promise<{ next: string | null; note: string }> {
	const newest = have.at(-1);

	if (!newest) {
		return {
			next: null,
			note: 'No years in the repo yet. Make one with --update YYYY, such as 2024.',
		};
	}

	const next = Number(newest) + 1;

	return (await published(next))
		? { next: String(next), note: `NHTSA and FHWA both have ${next}.` }
		: {
				next: null,
				note: `Up to date: ${newest} is the newest year both NHTSA and FHWA have, and ${next} isn't out yet.`,
			};
}

/** A year already in the repo, for the pull request's comparison, or null. */
async function load(year: number): Promise<RoadSafetyRow[] | null> {
	const text = await readFile(join(root, folder, `${year}.json`), 'utf8').catch(() => null);

	return text ? (JSON.parse(text) as RoadSafetyRow[]) : null;
}

const job: Job = {
	name: 'road-safety',

	async check() {
		return nextYear(
			await yearsOnHand(),
			async (year) => (await exists(farsUrl(year))) && (await exists(milesUrl(year))),
		);
	},

	async build(update): Promise<Build> {
		if (!/^\d{4}$/.test(update)) {
			throw new Error(`"${update}" isn't a year. Use four digits, such as 2024.`);
		}

		const year = Number(update);
		const cache = join(root, '.cache', 'road-safety');
		const deaths = await readDeaths(
			await download(farsUrl(year), join(cache, `FARS${year}NationalCSV.zip`)),
			year,
		);
		const miles = await readMiles(await download(milesUrl(year), join(cache, `vm2-${year}.xlsx`)));
		const rows = toRows(deaths, miles, year);
		const checks = runChecks(year, deaths, miles, rows);
		const failed = checks.filter((check) => !check.passed);

		if (failed.length > 0) {
			throw new Error(
				`${year} failed its checks, so nothing was written:\n${failed.map((check) => `  - ${check.name}${check.detail ? ` (${check.detail})` : ''}`).join('\n')}`,
			);
		}

		return {
			path: `${folder}/${year}.json`,
			contents: formatRows(rows),
			summary: summarize(year, rows, deaths, checks, await load(year - 1)),
		};
	},
};

export default job;
