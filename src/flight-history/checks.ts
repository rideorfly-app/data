import type { Aggregate, FlightRow } from './aggregate.ts';

/**
 * Sanity ranges for a month of domestic flights in the Lower 48 and DC. They
 * are wide on purpose: they catch a broken file (a wrong month, a truncated
 * download, a changed column), not an unusual month.
 */
export const EXPECTED = {
	nationFlights: [250_000, 900_000],
	routeRows: [4_000, 30_000],
	airportRows: [200, 600],
	averageDelayMinutes: [-15, 40],
} as const;

export interface CheckResult {
	name: string;
	passed: boolean;
}

/** How far short of its total a set of rows may fall, since a group with no flown flight gets no row. */
const MISSING_SHARE = 0.005;

const total = (rows: readonly FlightRow[]) => rows.reduce((sum, row) => sum + row.flights, 0);

/** True when `sum` reaches `expected` without going over, give or take the rows left out. */
const addsUp = (sum: number, expected: number) =>
	sum <= expected && sum >= expected * (1 - MISSING_SHARE);

/** Runs every check on a month's rows; the job writes nothing unless all pass. */
export function runChecks(result: Aggregate): CheckResult[] {
	const { rows } = result;
	const nation = rows.find((row): row is FlightRow & { nation: 'US' } => 'nation' in row);
	const routes = rows.filter((row) => 'route' in row);
	const airports = rows.filter((row) => 'airport' in row);

	const within = (value: number, [low, high]: readonly [number, number]) =>
		value >= low && value <= high;

	return [
		{ name: 'The file holds only the month asked for', passed: result.otherMonth === 0 },
		{
			name: `Nationwide flights are plausible (${EXPECTED.nationFlights[0].toLocaleString('en-US')} to ${EXPECTED.nationFlights[1].toLocaleString('en-US')})`,
			passed: !!nation && within(nation.flights, EXPECTED.nationFlights),
		},
		{
			name: 'Route rows add up to the nationwide row',
			passed: !!nation && addsUp(total(routes), nation.flights),
		},
		{
			name: 'Airport rows add up to twice the nationwide row (each flight is at two airports)',
			passed: !!nation && addsUp(total(airports), 2 * nation.flights),
		},
		{
			name: `The number of routes is plausible (${EXPECTED.routeRows[0].toLocaleString('en-US')} to ${EXPECTED.routeRows[1].toLocaleString('en-US')})`,
			passed: within(routes.length, EXPECTED.routeRows),
		},
		{
			name: `The number of airports is plausible (${EXPECTED.airportRows[0]} to ${EXPECTED.airportRows[1]})`,
			passed: within(airports.length, EXPECTED.airportRows),
		},
		{
			name: 'The nationwide average delay is plausible',
			passed: !!nation && within(nation.averageDelayMinutes, EXPECTED.averageDelayMinutes),
		},
		{
			name: 'Every share is between 0 and 1',
			passed: rows.every(
				(row) =>
					row.delayShare >= 0 &&
					row.delayShare <= 1 &&
					row.disruptShare >= 0 &&
					row.disruptShare <= 1,
			),
		},
		{
			name: 'Every route has a scheduled time',
			passed: rows.every((row) => !('route' in row) || (row.scheduledMinutes ?? 0) > 0),
		},
	];
}
