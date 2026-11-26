import type { ReportRow } from './report.ts';

/** The method the engine uses. The other two are kept in the report to show it is the better choice. */
const USED = 'average';

const METHODS: Readonly<Record<string, string>> = {
	average: 'Average of the same month over five years (used)',
	'last-year': 'The same month last year',
	newest: 'The newest month alone',
};

const fixed = (value: number, places = 1) => value.toFixed(places);
const points = (share: number) => `${fixed(share * 100)} points`;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const count = (n: number) => n.toLocaleString('en-US');

/** `2025-12` as "December 2025". */
function monthName(month: string): string {
	return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});
}

type Of<K extends ReportRow['kind']> = Extract<ReportRow, { kind: K }>;

/**
 * The Announcement for one month's report: headline figures for each method, at
 * each lead time, and a link to the whole file at the release. Plain text for
 * a Discussions post. The numbers are copied from the file, never worked out
 * again, so the post can't disagree with the report.
 */
export function buildPost(
	rows: readonly ReportRow[],
	release: string,
): { title: string; body: string } {
	const head = rows.find((row): row is Of<'report'> => row.kind === 'report');

	if (!head) {
		throw new Error("The report file has no 'report' line, so it can't be announced.");
	}

	const month = head.month;
	const lines = [
		`How close the engine's estimates came to what flights did in ${monthName(month)}, using only the data published before then. The engine was \`${head.engine}\`. For delays, smaller numbers are better; for flight times, a larger share of route-days is better.`,
	];

	for (const lead of [
		...new Set(rows.flatMap((row) => ('leadMonths' in row ? [row.leadMonths] : []))),
	].sort((a, b) => a - b)) {
		const coverage = rows.find(
			(row): row is Of<'coverage'> => row.kind === 'coverage' && row.leadMonths === lead,
		);
		const delays = rows.filter(
			(row): row is Of<'delay'> =>
				row.kind === 'delay' && row.leadMonths === lead && row.group === 'all',
		);
		const times = rows.filter(
			(row): row is Of<'flight-time'> =>
				row.kind === 'flight-time' && row.leadMonths === lead && row.group === 'all',
		);

		if (!coverage || delays.length === 0) {
			throw new Error(`The ${lead}-month part of the report is incomplete.`);
		}

		lines.push(
			'',
			`### Estimates made ${lead} months ahead`,
			'',
			`${count(coverage.routes)} routes and ${count(coverage.flights)} flights.`,
			'',
			'**Delays**',
			'',
			'| Method | Average delay off by | Delayed flights off by | Cancellations and diversions off by |',
			'| --- | ---: | ---: | ---: |',
			...order(delays).map(
				(row) =>
					`| ${METHODS[row.method] ?? row.method} | ${fixed(row.maeDelayMinutes)} minutes | ${points(row.maeDelayShare)} | ${points(row.maeDisruptShare)} |`,
			),
		);

		if (times.length > 0) {
			lines.push(
				'',
				"**Flight times**, compared with the day's typical flight on each route. A plus sign means the estimate ran longer than that flight.",
				'',
				'| Method | Route-days within 10 minutes | Within 15% | Median error |',
				'| --- | ---: | ---: | ---: |',
				...order(times).map(
					(row) =>
						`| ${METHODS[row.method] ?? row.method} | ${percent(row.within10Minutes)} | ${percent(row.within15Percent)} | ${row.medianErrorMinutes > 0 ? '+' : ''}${fixed(row.medianErrorMinutes)} minutes |`,
				),
			);
		}
	}

	lines.push(
		'',
		`The full report, one line per figure: [datasets/accuracy/${month}.json](https://github.com/rideorfly-app/data/blob/${release}/datasets/accuracy/${month}.json), in data release ${release}. Anyone can rerun it from the public sources.`,
	);

	return { title: `Accuracy report: ${monthName(month)}`, body: `${lines.join('\n')}\n` };
}

/** The method the engine uses first, then the others by name. */
function order<T extends { method: string }>(rows: readonly T[]): T[] {
	return [...rows].sort(
		(a, b) =>
			Number(b.method === USED) - Number(a.method === USED) || (a.method < b.method ? -1 : 1),
	);
}
