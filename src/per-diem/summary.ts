import type { CheckResult } from '../flight-history/checks.ts';
import type { Destination, PerDiemRow } from './read.ts';

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

const yearly = (lodging: readonly number[]) =>
	lodging.reduce((total, rate) => total + rate, 0) / 12;
const average = (rows: readonly PerDiemRow[]) =>
	rows.reduce((total, row) => total + yearly(row.lodging), 0) / rows.length;
const count = (n: number) => n.toLocaleString('en-US');

/**
 * The pull request's description: what's in the file, how ZIP codes in more
 * than one destination were averaged, GSA's standard rate, the meals rates, the
 * priciest places, and how the year compares with the one before when that is
 * in the repo. `destinations` are GSA's rows; `rows` are the published ones.
 */
export function summarize(
	fiscalYear: number,
	destinations: readonly Destination[],
	rows: readonly PerDiemRow[],
	lunchByTotal: ReadonlyMap<number, number>,
	checks: readonly CheckResult[],
	previous: readonly PerDiemRow[] | null,
): string {
	const averaged = rows.filter((row) => row.destinationIds.length > 1);
	const standard = destinations.find((destination) => destination.name === 'Standard Rate');
	const lines = [
		`## Per diem rates for FY${fiscalYear}`,
		'',
		`${count(destinations.length)} rows in GSA's file became ${count(rows.length)} ZIP codes in the Lower 48 and DC. ${count(averaged.length)} ZIP codes are listed under more than one destination (they span counties, and ${count(averaged.filter((row) => row.state.includes('/')).length)} cross a state line); each of those is the average of its rows, every row counting equally, month by month.`,
		'',
	];

	if (standard) {
		lines.push(
			`GSA's standard rate, for places it lists no rate for: $${standard.lodging[0]} a night and $${standard.meals} for meals and incidentals.`,
			'',
		);
	}

	lines.push(
		"### Meals rates in GSA's file",
		'',
		'| Meals and incidentals | Lunch | Rows |',
		'| ---: | ---: | ---: |',
	);

	const tiers = new Map<number, number>();

	for (const destination of destinations) {
		tiers.set(destination.meals, (tiers.get(destination.meals) ?? 0) + 1);
	}

	for (const [meals, rowCount] of [...tiers].sort(([a], [b]) => a - b)) {
		lines.push(`| $${meals} | $${lunchByTotal.get(meals) ?? '?'} | ${count(rowCount)} |`);
	}

	const peaks = new Map<string, { peak: number; month: string; state: string }>();

	for (const destination of destinations) {
		const peak = Math.max(...destination.lodging);
		const known = peaks.get(destination.name);

		if (!known || peak > known.peak) {
			peaks.set(destination.name, {
				peak,
				month: MONTH_NAMES[destination.lodging.indexOf(peak)] ?? '',
				state: destination.state,
			});
		}
	}

	lines.push(
		'',
		'### Priciest destinations (highest month)',
		'',
		'| Destination | Lodging a night | Month |',
		'| --- | ---: | --- |',
	);

	for (const [name, place] of [...peaks].sort(([, a], [, b]) => b.peak - a.peak).slice(0, 5)) {
		lines.push(`| ${name}, ${place.state} | $${place.peak} | ${place.month} |`);
	}

	lines.push('', '### Against the year before', '');

	if (previous && previous.length > 0) {
		const now = average(rows);
		const before = average(previous);

		lines.push(
			`Average yearly lodging per ZIP code: $${now.toFixed(2)}, against $${before.toFixed(2)} (${now >= before ? '+' : '−'}${(Math.abs(now / before - 1) * 100).toFixed(1)}%). ZIP codes: ${count(rows.length)}, against ${count(previous.length)}.`,
		);

		const before_standard = previous.find((row) => row.name === 'Standard Rate');

		if (standard && before_standard) {
			lines.push(
				'',
				`Standard lodging: $${standard.lodging[0]}, against $${before_standard.lodging[0]}.`,
			);
		}
	} else {
		lines.push('The year before is not in the repo.');
	}

	lines.push('', '### Checks', '');

	for (const check of checks) {
		lines.push(
			`- ${check.passed ? '✅' : '❌'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`,
		);
	}

	return `${lines.join('\n')}\n`;
}
