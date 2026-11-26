import { addMonths, type Month } from '../lib/months.ts';
import type { RouteDay } from './flights.ts';
import type { Index } from './history.ts';
import {
	type DelayFigures,
	estimateRoutes,
	type FlightTimeFigures,
	MIN_DAY_FLIGHTS,
	scoreDelays,
	scoreFlightTimes,
} from './score.ts';

/**
 * How many months ahead of the month under test the estimates are made. DOT's
 * records run about two months behind, so 3 is a matchup opened at the start
 * of the month; 6 is one planned ahead.
 */
export const LEADS = [3, 6] as const;

/** A line of the report file. The first says what made it; the rest are figures. */
export type ReportRow =
	| { kind: 'report'; month: Month; engine: string; minDayFlights: number }
	| {
			kind: 'coverage';
			month: Month;
			leadMonths: number;
			routes: number;
			flights: number;
			unknownRoutes: number;
			unknownFlights: number;
	  }
	| ({ kind: 'delay'; month: Month; leadMonths: number } & DelayFigures)
	| ({ kind: 'flight-time'; month: Month; leadMonths: number } & FlightTimeFigures);

/**
 * The accuracy report for one month: for each lead time, how close the
 * engine's estimates came to what the month's flights did. `engine` names the
 * engine version that made the estimates.
 */
export function buildReport(
	index: Index,
	month: Month,
	days: readonly RouteDay[],
	engine: string,
): ReportRow[] {
	if (!index.has(month)) {
		throw new Error(`There is no flight history for ${month} to check the estimates against.`);
	}

	const rows: ReportRow[] = [{ kind: 'report', month, engine, minDayFlights: MIN_DAY_FLIGHTS }];

	for (const leadMonths of LEADS) {
		const newest = addMonths(month, -leadMonths);

		if (!index.has(newest)) {
			throw new Error(
				`A ${leadMonths}-month lead needs the flight history for ${newest}. Make it with the flight-history job first.`,
			);
		}

		const { routes, unknown } = estimateRoutes(index, month, leadMonths);

		rows.push({
			kind: 'coverage',
			month,
			leadMonths,
			routes: routes.length,
			flights: routes.reduce((sum, route) => sum + route.actual.flights, 0),
			unknownRoutes: unknown.routes,
			unknownFlights: unknown.flights,
		});

		for (const figures of scoreDelays(routes)) {
			rows.push({ kind: 'delay', month, leadMonths, ...figures });
		}

		for (const figures of scoreFlightTimes(routes, days)) {
			rows.push({ kind: 'flight-time', month, leadMonths, ...figures });
		}
	}

	return rows;
}
