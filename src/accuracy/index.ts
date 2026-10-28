import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monthsOnHand, sourceUrl } from '../flight-history/index.ts';
import { readZippedCsv } from '../lib/csv.ts';
import { download } from '../lib/download.ts';
import type { Build, Job } from '../lib/job.ts';
import { addMonths } from '../lib/months.ts';
import { formatRows } from '../lib/write.ts';
import { routeDays } from './flights.ts';
import { type Index, loadIndex } from './history.ts';
import { buildReport } from './report.ts';
import { summarize } from './summary.ts';

const root = join(import.meta.dirname, '..', '..');
const folder = 'datasets/accuracy';
const historyFolder = 'datasets/flight-history';

let history: Promise<Index> | undefined;

/** The flight history in the repo, read once per run so a range of months doesn't read it again for each. */
const loadHistory = () => {
	history ??= loadIndex(join(root, historyFolder));

	return history;
};

/** The engine version the estimates come from: the commit `data` pins until the engine is on npm, the version after. */
async function engineVersion(): Promise<string> {
	const { dependencies } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
		dependencies: Record<string, string>;
	};
	const pinned = dependencies['@rideorfly/engine'] ?? 'unknown';

	return pinned.includes('#') ? (pinned.split('#')[1] ?? pinned).slice(0, 7) : pinned;
}

const job: Job = {
	name: 'accuracy',

	/** The month after the newest report, once its flight history is in the repo. */
	async check() {
		const newest = (await monthsOnHand(join(root, folder))).at(-1);

		if (!newest) {
			return { next: null, note: 'No reports yet. Make the first with --from and --to.' };
		}

		const next = addMonths(newest, 1);

		return (await monthsOnHand()).includes(next)
			? { next, note: `The flight history has ${next}.` }
			: {
					next: null,
					note: `Up to date: ${newest} is the newest, and there's no flight history for ${next} yet.`,
				};
	},

	async build(month): Promise<Build> {
		const index = await loadHistory();
		const zip = await download(
			sourceUrl(month),
			join(root, '.cache', 'flight-history', `${month}.zip`),
		);
		const days = await routeDays(readZippedCsv(zip), month);
		const rows = buildReport(index, month, days, await engineVersion());

		return {
			path: `${folder}/${month}.json`,
			contents: formatRows(rows),
			summary: summarize(month, rows),
		};
	},
};

export default job;
