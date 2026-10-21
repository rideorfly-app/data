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
			name: 'The nationwide row counts every flight kept',
			passed: !!nation && nation.flights === result.kept,
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
					row.lateShare >= 0 && row.lateShare <= 1 && row.cancelShare >= 0 && row.cancelShare <= 1,
			),
		},
		{
			name: 'Every route has a scheduled time',
			passed: rows.every((row) => !('route' in row) || (row.scheduledMinutes ?? 0) > 0),
		},
	];
}
