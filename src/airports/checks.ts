import type { CheckResult } from '../flight-history/checks.ts';
import type { FaaAirport, Matched } from './read.ts';

/**
 * Sanity ranges for a year of commercial-service airports in the Lower 48 and
 * DC. They are wide on purpose: they catch a broken file (a truncated
 * spreadsheet, a changed column), not an unusual year. For 2025 the FAA lists
 * 412 airports: 29 large, 32 medium, and the rest small.
 */
export const EXPECTED = {
	airports: [350, 480],
	large: [20, 45],
	medium: [20, 60],

	/** The most that may go unmatched before the job refuses to write the file. */
	unmatchedShare: 0.02,

	/** The Lower 48 and DC, with a little room. */
	lat: [24, 50],
	lon: [-125, -66],
} as const;

/** Airports every year of data has, and that are large hubs. */
const BIG = ['ATL', 'LAX', 'ORD', 'DFW', 'DEN', 'JFK'];

/** Runs every check on a year's airports; the job writes nothing unless all pass. */
export function runChecks(
	year: number,
	asked: number,
	faa: readonly FaaAirport[],
	matched: Matched,
): CheckResult[] {
	const within = (value: number, [low, high]: readonly [number, number]) =>
		value >= low && value <= high;
	const count = (size: string) => faa.filter((airport) => airport.size === size).length;
	const unmatchedShare = faa.length === 0 ? 1 : matched.unmatched.length / faa.length;
	const outside = matched.rows.filter(
		(row) => !within(row.lat, EXPECTED.lat) || !within(row.lon, EXPECTED.lon),
	);

	return [
		{ name: `The spreadsheet is for ${asked}`, passed: year === asked },
		{
			name: `The number of airports is plausible (${EXPECTED.airports[0]} to ${EXPECTED.airports[1]})`,
			passed: within(faa.length, EXPECTED.airports),
		},
		{
			name: `The number of large hubs is plausible (${EXPECTED.large[0]} to ${EXPECTED.large[1]}), and of medium hubs (${EXPECTED.medium[0]} to ${EXPECTED.medium[1]})`,
			passed: within(count('large'), EXPECTED.large) && within(count('medium'), EXPECTED.medium),
		},
		{
			name: 'No airport code appears twice',
			passed: new Set(faa.map((airport) => airport.code)).size === faa.length,
		},
		{
			name: 'Every airport has a positive whole number of enplanements',
			passed: faa.every(
				(airport) => Number.isInteger(airport.enplanements) && airport.enplanements > 0,
			),
		},
		{
			name: `The big airports are all there, as large hubs (${BIG.join(', ')})`,
			passed: BIG.every((code) =>
				faa.some((airport) => airport.code === code && airport.size === 'large'),
			),
		},
		{
			name: `At least ${100 - EXPECTED.unmatchedShare * 100}% of airports were matched to coordinates`,
			passed: unmatchedShare <= EXPECTED.unmatchedShare,
			detail:
				matched.unmatched.length > 0
					? `${matched.unmatched.length} not matched: ${matched.unmatched.map((airport) => `${airport.code} ${airport.name}`).join('; ')}`
					: undefined,
		},
		{
			name: 'Every coordinate is inside the Lower 48',
			passed: outside.length === 0,
			detail:
				outside.length > 0
					? outside
							.slice(0, 5)
							.map((row) => `${row.code} ${row.lat}, ${row.lon}`)
							.join('; ')
					: undefined,
		},
	];
}
