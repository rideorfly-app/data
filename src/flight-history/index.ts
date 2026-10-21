import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readZippedCsv } from '../lib/csv.ts';
import { download, exists } from '../lib/download.ts';
import type { Build, Job } from '../lib/job.ts';
import { addMonths, type Month } from '../lib/months.ts';
import { formatRows } from '../lib/write.ts';
import { aggregate, type FlightRow } from './aggregate.ts';
import { runChecks } from './checks.ts';
import { summarize } from './summary.ts';

const root = join(import.meta.dirname, '..', '..');
const folder = 'datasets/flight-history';

/** BTS's address for a month of "Reporting Carrier On-Time Performance". The month number has no leading zero. */
export function sourceUrl(month: Month): string {
	const [year, number] = month.split('-');

	return `https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_${year}_${Number(number)}.zip`;
}

/** The months already in the repo, oldest first. */
async function monthsOnHand(directory = join(root, folder)): Promise<Month[]> {
	const names = await readdir(directory).catch(() => []);

	return names
		.filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
		.map((name) => name.slice(0, 7))
		.sort();
}

/** A month's rows from the repo, or null when it isn't there. */
async function load(month: Month): Promise<FlightRow[] | null> {
	const text = await readFile(join(root, folder, `${month}.json`), 'utf8').catch(() => null);

	return text ? (JSON.parse(text) as FlightRow[]) : null;
}

/**
 * The month after the newest one on hand, if DOT has published it. The months
 * come one at a time, so a gap in the repo is never skipped over.
 */
export async function nextUpdate(
	have: readonly Month[],
	published: (month: Month) => Promise<boolean>,
): Promise<{ next: Month | null; note: string }> {
	const newest = have.at(-1);

	if (!newest) {
		return { next: null, note: 'No months in the repo yet. Run the backfill with --from.' };
	}

	const next = addMonths(newest, 1);

	return (await published(next))
		? { next, note: `DOT has ${next}.` }
		: {
				next: null,
				note: `Up to date: ${newest} is the newest, and DOT doesn't have ${next} yet.`,
			};
}

const job: Job = {
	name: 'flight-history',

	async check() {
		return nextUpdate(await monthsOnHand(), (month) => exists(sourceUrl(month)));
	},

	async build(month): Promise<Build> {
		const zip = await download(
			sourceUrl(month),
			join(root, '.cache', 'flight-history', `${month}.zip`),
		);
		const result = await aggregate(readZippedCsv(zip), month);
		const checks = runChecks(result);

		const failed = checks.filter((check) => !check.passed);

		if (failed.length > 0) {
			throw new Error(
				`${month} failed its checks, so nothing was written:\n${failed.map((check) => `  - ${check.name}`).join('\n')}`,
			);
		}

		const summary = summarize(month, result.rows, checks, {
			previous: await load(addMonths(month, -1)),
			yearAgo: await load(addMonths(month, -12)),
		});

		return { path: `${folder}/${month}.json`, contents: formatRows(result.rows), summary };
	},
};

export default job;
