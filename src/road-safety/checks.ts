import type { CheckResult } from '../flight-history/checks.ts';
import { STATE_CODES } from '../lib/states.ts';
import type { Deaths, Miles, RoadSafetyRow } from './read.ts';

/**
 * Sanity ranges for a year of road deaths. They are wide on purpose: they catch
 * a broken file (a truncated download, a changed column, miles in the wrong
 * units), not an unusual year. In 2023 the states ran from 0.56 to 1.79 deaths
 * per 100 million miles, and the nation was 1.26.
 */
export const EXPECTED = {
	nationalDeaths: [25_000, 55_000],
	stateDeaths: [10, 6_000],
	stateMiles: [1_000, 500_000],
	stateRate: [0.3, 3],
	nationalRate: [0.8, 2],
} as const;

/** Runs every check on a year's rows; the job writes nothing unless all pass. */
export function runChecks(
	year: number,
	deaths: Deaths,
	miles: ReadonlyMap<string, Miles>,
	rows: readonly RoadSafetyRow[],
): CheckResult[] {
	const within = (value: number, [low, high]: readonly [number, number]) =>
		value >= low && value <= high;
	const states = rows.filter((row) => row.state !== 'US');
	const national = rows.find((row) => row.state === 'US');
	const missing = [...STATE_CODES.values()].filter(
		(code) => !states.some((row) => row.state === code),
	);
	const names = (bad: (row: RoadSafetyRow) => boolean) => {
		const found = states.filter(bad).map((row) => row.state);

		return found.length === 0 ? undefined : found.join(', ');
	};

	return [
		{
			name: 'Every state and DC has deaths in the crash file and miles in the FHWA table',
			passed: missing.length === 0 && states.length === STATE_CODES.size,
			detail: missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
		},
		{
			name: `Every crash in the file is from ${year}`,
			passed: deaths.otherYear === 0,
			detail:
				deaths.otherYear > 0 ? `${deaths.otherYear} crashes are from another year` : undefined,
		},
		{
			name: `The nation's deaths are plausible (${EXPECTED.nationalDeaths[0].toLocaleString('en-US')} to ${EXPECTED.nationalDeaths[1].toLocaleString('en-US')})`,
			passed: !!national && within(national.deaths, EXPECTED.nationalDeaths),
		},
		{
			name: `Every state's deaths are plausible (${EXPECTED.stateDeaths[0]} to ${EXPECTED.stateDeaths[1].toLocaleString('en-US')})`,
			passed: states.every((row) => within(row.deaths, EXPECTED.stateDeaths)),
			detail: names((row) => !within(row.deaths, EXPECTED.stateDeaths)),
		},
		{
			name: `Every state's vehicle miles are plausible (${EXPECTED.stateMiles[0].toLocaleString('en-US')} to ${EXPECTED.stateMiles[1].toLocaleString('en-US')} million)`,
			passed: states.every((row) => within(row.vehicleMilesMillions, EXPECTED.stateMiles)),
			detail: names((row) => !within(row.vehicleMilesMillions, EXPECTED.stateMiles)),
		},
		{
			name: "FHWA's rural and urban miles add up to its total for every state",
			passed: [...miles.values()].every(
				(state) => Math.abs(state.rural + state.urban - state.total) < 1,
			),
		},
		{
			name: `Every state's rate is plausible (${EXPECTED.stateRate[0]} to ${EXPECTED.stateRate[1]} deaths per 100 million miles)`,
			passed: states.every((row) => within(row.ratePer100MillionMiles, EXPECTED.stateRate)),
			detail: names((row) => !within(row.ratePer100MillionMiles, EXPECTED.stateRate)),
		},
		{
			name: `The national rate is plausible (${EXPECTED.nationalRate[0]} to ${EXPECTED.nationalRate[1]})`,
			passed: !!national && within(national.ratePer100MillionMiles, EXPECTED.nationalRate),
		},
	];
}
