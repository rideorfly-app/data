import {
	DELAY,
	type DelayEstimate,
	type DelayMethod,
	expectedDelay,
	type FlightMonth,
} from '@rideorfly/engine';
import { addMonths, type Month } from '../lib/months.ts';
import type { RouteDay } from './flights.ts';
import { type Index, seriesUpTo } from './history.ts';
import { median, quantile, round } from './stats.ts';

/** The three ways the engine can estimate; the report says which guessed best. */
export const METHODS: readonly DelayMethod[] = ['average', 'newest', 'last-year'];

/** A day needs at least this many flown flights on a route before its "typical" time means anything. */
export const MIN_DAY_FLIGHTS = 3;

/** A flight-time estimate counts as close when it's within this many minutes ... */
const CLOSE_MINUTES = 10;

/** ... or within this share of the day's typical time. */
const CLOSE_SHARE = 0.15;

/** What the estimate would have been for one route in the month under test, next to what really happened. */
export interface RouteEstimate {
	route: string;

	/** The route's real figures for the month. */
	actual: FlightMonth;

	/**
	 * A reporting group: true when the route had fewer flights in the newest month
	 * known than the engine's cutoff. The engine's own blend weight comes from the
	 * route's flights in the same month of past years, so the two can differ.
	 */
	thin: boolean;

	/** What the "average" method's figures rested on: the route's own past years, those blended with its airports', or only its newest month. */
	basis: DelayEstimate['basis'];

	estimates: Record<DelayMethod, DelayEstimate>;
}

export interface Estimated {
	routes: RouteEstimate[];

	/** Routes that flew in the month but had no record in the newest month known, so the engine would have used typical figures. */
	unknown: { routes: number; flights: number };
}

/**
 * Works out, for every route that flew in `target`, the estimate the engine
 * would have made `lead` months earlier. It sees only months up to
 * `target - lead` (DOT's records run about two months behind, so a lead of 3
 * is a matchup opened at the start of the month).
 */
export function estimateRoutes(index: Index, target: Month, lead: number): Estimated {
	const newestMonth = addMonths(target, -lead);
	const date = `${target}-15`;
	const known = index.get(newestMonth);
	const cache = new Map<string, ReturnType<typeof seriesUpTo>>();
	const series = (key: string) => {
		let rows = cache.get(key);

		if (!rows) {
			rows = seriesUpTo(index, key, newestMonth);
			cache.set(key, rows);
		}

		return rows;
	};

	const routes: RouteEstimate[] = [];
	const unknown = { routes: 0, flights: 0 };

	for (const [key, actual] of index.get(target) ?? []) {
		if (!key.startsWith('route:')) {
			continue;
		}

		const route = key.slice('route:'.length);
		const latest = known?.get(key);

		if (!latest) {
			unknown.routes++;
			unknown.flights += actual.flights;
			continue;
		}

		const [from, to] = route.split('-');
		const history = {
			route: series(key),
			origin: series(`airport:${from}`),
			destination: series(`airport:${to}`),
		};

		const average = expectedDelay(history, date, 'average');
		const newest = expectedDelay(history, date, 'newest');
		const lastYear = expectedDelay(history, date, 'last-year');

		// The route has a row in the newest month, so none of these is null.
		if (!average || !newest || !lastYear) {
			continue;
		}

		routes.push({
			route,
			actual,
			thin: latest.flights < DELAY.borrowFlights,
			basis: average.basis,
			estimates: { average, newest, 'last-year': lastYear },
		});
	}

	return { routes, unknown };
}

/** How far an estimate of the delay was off, for a group of routes. Errors are the estimate minus what happened, so a positive bias means too gloomy. */
export interface DelayFigures {
	method: DelayMethod;
	group: string;
	routes: number;

	/** Flights in the month on those routes, which is how much each route counts. */
	flights: number;
	maeDelayMinutes: number;
	biasDelayMinutes: number;
	maeDelayShare: number;
	biasDelayShare: number;
	maeDisruptShare: number;
	biasDisruptShare: number;
}

const DELAY_GROUPS = [
	'all',
	'busy',
	'thin',
	'basis-route',
	'basis-route-and-airports',
	'basis-newest-month',
];

/** Every group a route belongs to: all of them, busy or thin, and what the "average" method rested on. */
const delayGroupsOf = (route: RouteEstimate) => [
	'all',
	route.thin ? 'thin' : 'busy',
	`basis-${route.basis}`,
];

interface DelayTotals {
	routes: number;
	flights: number;
	minutes: number;
	absMinutes: number;
	delay: number;
	absDelay: number;
	disrupt: number;
	absDisrupt: number;
}

/**
 * Part one of the report: which method guessed the route's delay figures best.
 * Each route counts in proportion to its flights in the month, so a busy
 * route's miss matters more than a thin route's.
 */
export function scoreDelays(routes: readonly RouteEstimate[]): DelayFigures[] {
	const totals = new Map<string, DelayTotals>();

	for (const route of routes) {
		const weight = route.actual.flights;

		for (const method of METHODS) {
			const estimate = route.estimates[method];
			const minutes = estimate.averageDelayMinutes - route.actual.averageDelayMinutes;
			const delay = estimate.delayChance - route.actual.delayShare;
			const disrupt = estimate.disruptChance - route.actual.disruptShare;

			for (const group of delayGroupsOf(route)) {
				const key = `${method} ${group}`;
				const sum = totals.get(key) ?? {
					routes: 0,
					flights: 0,
					minutes: 0,
					absMinutes: 0,
					delay: 0,
					absDelay: 0,
					disrupt: 0,
					absDisrupt: 0,
				};

				sum.routes++;
				sum.flights += weight;
				sum.minutes += minutes * weight;
				sum.absMinutes += Math.abs(minutes) * weight;
				sum.delay += delay * weight;
				sum.absDelay += Math.abs(delay) * weight;
				sum.disrupt += disrupt * weight;
				sum.absDisrupt += Math.abs(disrupt) * weight;
				totals.set(key, sum);
			}
		}
	}

	const figures: DelayFigures[] = [];

	for (const method of METHODS) {
		for (const group of DELAY_GROUPS) {
			const sum = totals.get(`${method} ${group}`);

			if (sum) {
				figures.push({
					method,
					group,
					routes: sum.routes,
					flights: sum.flights,
					maeDelayMinutes: round(sum.absMinutes / sum.flights, 2),
					biasDelayMinutes: round(sum.minutes / sum.flights, 2),
					maeDelayShare: round(sum.absDelay / sum.flights, 4),
					biasDelayShare: round(sum.delay / sum.flights, 4),
					maeDisruptShare: round(sum.absDisrupt / sum.flights, 4),
					biasDisruptShare: round(sum.disrupt / sum.flights, 4),
				});
			}
		}
	}

	return figures;
}

/** How close the flight-time estimate came to the day's flights, for a group of route-days. */
export interface FlightTimeFigures {
	method: DelayMethod;
	group: string;
	routeDays: number;

	/** The middle of the estimate minus the day's typical time, so a negative number means too short. */
	medianErrorMinutes: number;
	medianAbsErrorMinutes: number;

	/** The share of route-days where the estimate was within 10 minutes of the day's typical time. */
	within10Minutes: number;

	/** ... within 15% of it. */
	within15Percent: number;

	/** ... between the day's quarter-way and three-quarter-way flights, so it sat inside the day's real spread. */
	withinSpread: number;

	/**
	 * The same, measured against the day's average flight instead of its typical
	 * one. The estimate is a scheduled time plus an average delay, so it aims at
	 * the average; late flights pull the average above the typical flight.
	 */
	medianErrorVsAverageMinutes: number;
	within10MinutesOfAverage: number;
}

const FLIGHT_TIME_GROUPS = ['all', 'busy', 'thin'];

interface FlightTimeTotals {
	errors: number[];
	errorsVsAverage: number[];
	close: number;
	closeShare: number;
	closeToAverage: number;
	inSpread: number;
}

/**
 * Part two of the report, and Phase 1's check: the flight-time estimate (the
 * route's scheduled gate-to-gate time plus the expected delay) against what
 * the day's flights really took. A day's typical time is the middle of its
 * flights' times; its spread is the middle half.
 */
export function scoreFlightTimes(
	routes: readonly RouteEstimate[],
	days: readonly RouteDay[],
): FlightTimeFigures[] {
	const byRoute = new Map(routes.map((route) => [route.route, route]));
	const totals = new Map<string, FlightTimeTotals>();

	for (const day of days) {
		const route = byRoute.get(day.route);

		if (!route || day.minutes.length < MIN_DAY_FLIGHTS) {
			continue;
		}

		const ordered = [...day.minutes].sort((a, b) => a - b);
		const typical = quantile(ordered, 0.5);
		const average = ordered.reduce((sum, minutes) => sum + minutes, 0) / ordered.length;
		const low = quantile(ordered, 0.25);
		const high = quantile(ordered, 0.75);

		for (const method of METHODS) {
			const { scheduledMinutes, averageDelayMinutes } = route.estimates[method];

			if (scheduledMinutes === undefined) {
				continue;
			}

			const estimate = scheduledMinutes + averageDelayMinutes;
			const error = estimate - typical;

			for (const group of ['all', route.thin ? 'thin' : 'busy']) {
				const key = `${method} ${group}`;
				const sum = totals.get(key) ?? {
					errors: [],
					errorsVsAverage: [],
					close: 0,
					closeShare: 0,
					closeToAverage: 0,
					inSpread: 0,
				};

				sum.errors.push(error);
				sum.errorsVsAverage.push(estimate - average);
				sum.close += Math.abs(error) <= CLOSE_MINUTES ? 1 : 0;
				sum.closeShare += Math.abs(error) <= CLOSE_SHARE * typical ? 1 : 0;
				sum.closeToAverage += Math.abs(estimate - average) <= CLOSE_MINUTES ? 1 : 0;
				sum.inSpread += estimate >= low && estimate <= high ? 1 : 0;
				totals.set(key, sum);
			}
		}
	}

	const figures: FlightTimeFigures[] = [];

	for (const method of METHODS) {
		for (const group of FLIGHT_TIME_GROUPS) {
			const sum = totals.get(`${method} ${group}`);

			if (sum) {
				const count = sum.errors.length;

				figures.push({
					method,
					group,
					routeDays: count,
					medianErrorMinutes: round(median(sum.errors), 1),
					medianAbsErrorMinutes: round(median(sum.errors.map(Math.abs)), 1),
					within10Minutes: round(sum.close / count, 3),
					within15Percent: round(sum.closeShare / count, 3),
					withinSpread: round(sum.inSpread / count, 3),
					medianErrorVsAverageMinutes: round(median(sum.errorsVsAverage), 1),
					within10MinutesOfAverage: round(sum.closeToAverage / count, 3),
				});
			}
		}
	}

	return figures;
}
