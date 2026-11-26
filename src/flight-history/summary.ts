import type { Month } from '../lib/months.ts';
import type { FlightRow } from './aggregate.ts';
import type { CheckResult } from './checks.ts';

/** Routes with fewer flights than this are too few for their average to mean much. */
const OUTLIER_MIN_FLIGHTS = 100;

type Nation = FlightRow & { nation: 'US' };

const nationOf = (rows: readonly FlightRow[]) => rows.find((row): row is Nation => 'nation' in row);

/**
 * The pull request's description. Nobody can review thousands of rows by eye,
 * so it says what's in the file, how it compares with the month before and the
 * same month a year earlier, the biggest outliers, and whether the checks passed.
 */
export function summarize(
	month: Month,
	rows: readonly FlightRow[],
	checks: readonly CheckResult[],
	earlier: { previous: readonly FlightRow[] | null; yearAgo: readonly FlightRow[] | null },
): string {
	const nation = nationOf(rows);
	const routes = rows.filter((row) => 'route' in row);
	const airports = rows.filter((row) => 'airport' in row);

	const lines = [
		`## Flight history for ${month}`,
		'',
		`${routes.length.toLocaleString('en-US')} routes, ${airports.length.toLocaleString('en-US')} airports, and ${nation ? nation.flights.toLocaleString('en-US') : 0} flights in the Lower 48 and DC.`,
		'',
		'### Nationwide',
		'',
		'| | Flights | Average delay | Delayed 15+ min | Cancelled or diverted |',
		'| --- | ---: | ---: | ---: | ---: |',
	];

	for (const [label, set] of [
		[month, rows],
		['Month before', earlier.previous],
		['A year earlier', earlier.yearAgo],
	] as const) {
		const found = set ? nationOf(set) : undefined;

		lines.push(
			found
				? `| ${label} | ${found.flights.toLocaleString('en-US')} | ${found.averageDelayMinutes} min | ${percent(found.delayShare)} | ${percent(found.disruptShare)} |`
				: `| ${label} | not in the repo | | | |`,
		);
	}

	const busy = routes.filter((row) => row.flights >= OUTLIER_MIN_FLIGHTS);
	const byDelay = [...busy].sort((a, b) => b.averageDelayMinutes - a.averageDelayMinutes);

	lines.push('', `### Biggest outliers (routes with ${OUTLIER_MIN_FLIGHTS}+ flights)`, '');
	lines.push('| Route | Flights | Average delay |', '| --- | ---: | ---: |');

	for (const row of [...byDelay.slice(0, 5), ...byDelay.slice(-3)]) {
		if ('route' in row) {
			lines.push(`| ${row.route} | ${row.flights} | ${row.averageDelayMinutes} min |`);
		}
	}

	lines.push('', '### Checks', '');

	for (const check of checks) {
		lines.push(`- ${check.passed ? '✅' : '❌'} ${check.name}`);
	}

	return `${lines.join('\n')}\n`;
}

function percent(share: number): string {
	return `${(share * 100).toFixed(1)}%`;
}
