import { LAUNCH_STATES } from '../flight-history/aggregate.ts';
import type { CheckResult } from '../flight-history/checks.ts';
import type { Destination } from './read.ts';

/**
 * Sanity ranges for a year of per diem rates in the Lower 48 and DC. They are
 * wide on purpose: they catch a broken file (a truncated download, a changed
 * column, rates in cents), not an unusual year. FY2027 has 42,358 rows for
 * 40,426 ZIP codes, and lodging from $113 to $499.
 */
export const EXPECTED = {
	rows: [40_000, 46_000],
	zips: [38_000, 44_000],
	lodging: [50, 700],
} as const;

/** Up to five ZIP codes (and their destinations) that fail `bad`, as text. */
function examples(
	rows: readonly Destination[],
	bad: (row: Destination) => boolean,
): string | undefined {
	const found = rows.filter(bad);

	return found.length === 0
		? undefined
		: `${found.length} rows, such as ${found
				.slice(0, 5)
				.map((row) => `${row.zip || '(no ZIP)'} ${row.name}`)
				.join('; ')}`;
}

/** Runs every check on a year's rows; the job writes nothing unless all pass. */
export function runChecks(
	fiscalYear: number,
	destinations: readonly Destination[],
	lunchByTotal: ReadonlyMap<number, number>,
): CheckResult[] {
	const within = (value: number, [low, high]: readonly [number, number]) =>
		value >= low && value <= high;
	const zips = new Set(destinations.map((row) => row.zip));
	const pairs = new Set(destinations.map((row) => `${row.zip} ${row.destinationId}`));
	const [low, high] = EXPECTED.lodging;

	return [
		{
			name: `Every row is for FY${fiscalYear}`,
			passed: destinations.every((row) => row.fiscalYear === fiscalYear),
		},
		{
			name: `The number of rows is plausible (${EXPECTED.rows[0].toLocaleString('en-US')} to ${EXPECTED.rows[1].toLocaleString('en-US')})`,
			passed: within(destinations.length, EXPECTED.rows),
		},
		{
			name: `The number of ZIP codes is plausible (${EXPECTED.zips[0].toLocaleString('en-US')} to ${EXPECTED.zips[1].toLocaleString('en-US')})`,
			passed: within(zips.size, EXPECTED.zips),
		},
		{
			name: 'Every ZIP code is five digits, with its leading zeros',
			passed: destinations.every((row) => /^\d{5}$/.test(row.zip)),
			detail: examples(destinations, (row) => !/^\d{5}$/.test(row.zip)),
		},
		{
			name: 'Every state is in the Lower 48 or DC',
			passed: destinations.every((row) => LAUNCH_STATES.has(row.state)),
			detail: examples(destinations, (row) => !LAUNCH_STATES.has(row.state)),
		},
		{
			name: 'No ZIP code appears twice for the same destination',
			passed: pairs.size === destinations.length,
		},
		{
			name: `Every month's lodging rate is plausible ($${low} to $${high} a night)`,
			passed: destinations.every(
				(row) =>
					row.lodging.length === 12 && row.lodging.every((rate) => within(rate, EXPECTED.lodging)),
			),
		},
		{
			name: "Every meals rate has a lunch in GSA's breakdown",
			passed: destinations.every((row) => lunchByTotal.has(row.meals)),
		},
		{
			name: 'The standard rate (for places GSA lists no rate for) is in the file',
			passed: destinations.some((row) => row.name === 'Standard Rate'),
		},
	];
}
