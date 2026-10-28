import type { CheckResult } from '../flight-history/checks.ts';
import type { PerDiemRow } from './read.ts';

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

const yearly = (row: PerDiemRow) => row.lodging.reduce((total, rate) => total + rate, 0) / 12;
const average = (rows: readonly PerDiemRow[]) =>
	rows.reduce((total, row) => total + yearly(row), 0) / rows.length;

/**
 * The pull request's description: what's in the file, GSA's standard rate, the
 * priciest places, how the meals rates break down, and how the year compares
 * with the one before when that is in the repo.
 */
export function summarize(
	fiscalYear: number,
	rows: readonly PerDiemRow[],
	checks: readonly CheckResult[],
	previous: readonly PerDiemRow[] | null,
): string {
	const zips = new Set(rows.map((row) => row.zip));
	const inTwo = new Map<string, number>();

	for (const row of rows) {
		inTwo.set(row.zip, (inTwo.get(row.zip) ?? 0) + 1);
	}

	const standard = rows.find((row) => row.name === 'Standard Rate');
	const lines = [
		`## Per diem rates for FY${fiscalYear}`,
		'',
		`${rows.length.toLocaleString('en-US')} rows for ${zips.size.toLocaleString('en-US')} ZIP codes in the Lower 48 and DC. ${[...inTwo.values()].filter((count) => count > 1).length.toLocaleString('en-US')} ZIP codes appear more than once, because they span counties with different rates; both rows are kept, as GSA lists them.`,
		'',
	];

	if (standard) {
		lines.push(
			`GSA's standard rate, for places it lists no rate for: $${standard.lodging[0]} a night and $${standard.meals} for meals and incidentals.`,
			'',
		);
	}

	lines.push(
		'### Meals rates',
		'',
		'| Meals and incidentals | Lunch | Rows |',
		'| ---: | ---: | ---: |',
	);

	const tiers = new Map<number, { lunch: number; rows: number }>();

	for (const row of rows) {
		const tier = tiers.get(row.meals) ?? { lunch: row.lunch, rows: 0 };

		tier.rows++;
		tiers.set(row.meals, tier);
	}

	for (const [meals, tier] of [...tiers].sort(([a], [b]) => a - b)) {
		lines.push(`| $${meals} | $${tier.lunch} | ${tier.rows.toLocaleString('en-US')} |`);
	}

	const peaks = new Map<string, { peak: number; month: string; state: string }>();

	for (const row of rows) {
		const peak = Math.max(...row.lodging);
		const known = peaks.get(row.name);

		if (!known || peak > known.peak) {
			peaks.set(row.name, {
				peak,
				month: MONTH_NAMES[row.lodging.indexOf(peak)] ?? '',
				state: row.state,
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
		const before_standard = previous.find((row) => row.name === 'Standard Rate');

		lines.push(
			`Average yearly lodging per row: $${now.toFixed(2)}, against $${before.toFixed(2)} (${now >= before ? '+' : '−'}${(Math.abs(now / before - 1) * 100).toFixed(1)}%). Rows: ${rows.length.toLocaleString('en-US')}, against ${previous.length.toLocaleString('en-US')}.`,
		);

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
		lines.push(`- ${check.passed ? '✅' : '❌'} ${check.name}`);
	}

	return `${lines.join('\n')}\n`;
}
