import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { download } from '../lib/download.ts';
import type { Build, Job } from '../lib/job.ts';
import { formatRows } from '../lib/write.ts';
import { readZippedLines } from '../lib/zip.ts';
import { type GasRow, runChecks } from './checks.ts';
import { priceFor, REGIONS, readSeries } from './series.ts';
import { summarize } from './summary.ts';

const root = join(import.meta.dirname, '..', '..');
const folder = 'datasets/gas-prices';

/**
 * EIA's bulk file of every petroleum series, as JSON lines in a zip. It needs
 * no key. The weekly prices are also on EIA's website, but as an old binary
 * spreadsheet, and its API wants a key.
 */
export const SOURCE_URL = 'https://www.eia.gov/opendata/bulk/PET.zip';

/** The bulk file changes daily, so a copy kept this long is fetched again. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** The weeks already in the repo, oldest first. */
export async function weeksOnHand(directory = join(root, folder)): Promise<string[]> {
	const names = await readdir(directory).catch(() => []);

	return names
		.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
		.map((name) => name.slice(0, 10))
		.sort();
}

/**
 * The first week EIA has that the repo doesn't, after the newest one on hand.
 * The weeks come one at a time, so a gap in the repo is never skipped over.
 */
export function nextWeek(
	have: readonly string[],
	available: readonly string[],
): { next: string | null; note: string } {
	const newest = have.at(-1);

	if (!newest) {
		return { next: null, note: 'No weeks in the repo yet. Make one with --update YYYY-MM-DD.' };
	}

	const next = [...available].sort().find((week) => week > newest);

	return next
		? { next, note: `EIA has the week of ${next}.` }
		: { next: null, note: `Up to date: ${newest} is the newest week EIA has.` };
}

/** EIA's bulk file, downloaded again if the copy kept in `.cache/` is old. */
async function sourceZip(): Promise<string> {
	const path = join(root, '.cache', 'gas-prices', 'PET.zip');
	const age = await stat(path).then(
		(file) => Date.now() - file.mtimeMs,
		() => Number.POSITIVE_INFINITY,
	);

	if (age > MAX_AGE_MS) {
		await rm(path, { force: true });
	}

	return download(SOURCE_URL, path);
}

const read = async () => readSeries(readZippedLines(await sourceZip(), 'PET.txt'));

const job: Job = {
	name: 'gas-prices',

	async check() {
		const national = (await read()).get('national') ?? [];

		return nextWeek(
			await weeksOnHand(),
			national.map(([week]) => week),
		);
	},

	async build(week): Promise<Build> {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
			throw new Error(`"${week}" isn't a week. Use the Monday as YYYY-MM-DD, such as 2026-10-26.`);
		}

		const weekly = await read();
		const rows: GasRow[] = [];
		const missing: string[] = [];

		for (const region of REGIONS) {
			const price = priceFor(weekly, region, week);

			if (price === undefined) {
				missing.push(region);
			} else {
				rows.push({ week, region, dollarsPerGallon: price });
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`EIA has no price for the week of ${week} in: ${missing.join(', ')}. Nothing was written.`,
			);
		}

		const checks = runChecks(week, rows);
		const failed = checks.filter((check) => !check.passed);

		if (failed.length > 0) {
			throw new Error(
				`${week} failed its checks, so nothing was written:\n${failed.map((check) => `  - ${check.name}`).join('\n')}`,
			);
		}

		return {
			path: `${folder}/${week}.json`,
			contents: formatRows(rows),
			summary: summarize(week, rows, checks, weekly),
		};
	},
};

export default job;
