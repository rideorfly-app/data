import type { FlightMonth } from '@rideorfly/engine';
import type { Month } from '../lib/months.ts';

/**
 * The Lower 48 states and DC, where the app launches. A flight counts only if
 * both ends are here, so the nationwide row and the airport rows describe the
 * same market the app serves.
 */
export const LAUNCH_STATES: ReadonlySet<string> = new Set(
	'AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
		' ',
	),
);

/** One published row: a route, an airport, or the nation, with the engine's figures after the key. */
export type FlightRow = ({ route: string } | { airport: string } | { nation: 'US' }) & FlightMonth;

export interface Aggregate {
	rows: FlightRow[];

	/** Flights in the file that count (both ends in the launch area, in this month). */
	kept: number;

	/** Flights left out because an end is outside the launch area. */
	outside: number;

	/** Flights dated outside the month asked for; a clean file has none. */
	otherMonth: number;
}

/** Running totals for one route, airport, or the nation. */
interface Tally {
	flights: number;
	cancelled: number;
	flown: number;
	delayTotal: number;
	late: number;
	scheduled: number[];
}

const tally = (): Tally => ({
	flights: 0,
	cancelled: 0,
	flown: 0,
	delayTotal: 0,
	late: 0,
	scheduled: [],
});

/**
 * Boils one month of DOT's on-time records down to rows: one per route (each
 * direction), one per airport (flights in and out), and one for the nation.
 *
 * - `flights` counts every scheduled flight, cancelled ones too.
 * - The average delay and late share cover flights that flew (not cancelled or
 *   diverted), with early arrivals counted as negative minutes. Late means
 *   more than 15 minutes.
 * - A group with no flown flights gets no row, since it has no delay to report.
 */
export async function aggregate(
	records: AsyncIterable<Record<string, string>> | Iterable<Record<string, string>>,
	month: Month,
): Promise<Aggregate> {
	const routes = new Map<string, Tally>();
	const airports = new Map<string, Tally>();
	const nation = tally();
	let outside = 0;
	let otherMonth = 0;

	for await (const record of records) {
		if (!record.FlightDate?.startsWith(month)) {
			otherMonth++;
			continue;
		}

		const { Origin: from, Dest: to } = record;

		if (
			!from ||
			!to ||
			!LAUNCH_STATES.has(record.OriginState ?? '') ||
			!LAUNCH_STATES.has(record.DestState ?? '')
		) {
			outside++;
			continue;
		}

		const cancelled = Number(record.Cancelled) === 1;
		const diverted = Number(record.Diverted) === 1;
		const delay = record.ArrDelay === '' ? Number.NaN : Number(record.ArrDelay);
		const scheduled = record.CRSElapsedTime === '' ? Number.NaN : Number(record.CRSElapsedTime);
		const flew = !cancelled && !diverted && !Number.isNaN(delay);

		for (const group of [
			nation,
			grab(airports, from),
			grab(airports, to),
			grab(routes, `${from}-${to}`),
		]) {
			group.flights++;

			if (cancelled) {
				group.cancelled++;
			}

			if (flew) {
				group.flown++;
				group.delayTotal += delay;

				if (delay > 15) {
					group.late++;
				}
			}
		}

		if (!Number.isNaN(scheduled)) {
			routes.get(`${from}-${to}`)?.scheduled.push(scheduled);
		}
	}

	const rows: FlightRow[] = [];

	const nationRow = row(month, nation);

	if (nationRow) {
		rows.push({ nation: 'US', ...nationRow });
	}

	for (const [airport, totals] of sorted(airports)) {
		const figures = row(month, totals);

		if (figures) {
			rows.push({ airport, ...figures });
		}
	}

	for (const [route, totals] of sorted(routes)) {
		const figures = row(month, totals);

		if (figures) {
			rows.push({ route, ...figures, scheduledMinutes: median(totals.scheduled) });
		}
	}

	return { rows, kept: nation.flights, outside, otherMonth };
}

/** The group's figures in the order they're published, or null when no flight flew. */
function row(month: Month, totals: Tally): FlightMonth | null {
	if (totals.flown === 0) {
		return null;
	}

	return {
		month,
		flights: totals.flights,
		averageDelayMinutes: round(totals.delayTotal / totals.flown, 1),
		lateShare: round(totals.late / totals.flown, 3),
		cancelShare: round(totals.cancelled / totals.flights, 3),
	};
}

/** The middle scheduled time, rounded to a whole minute. */
function median(values: number[]): number {
	const ordered = [...values].sort((a, b) => a - b);
	const middle = Math.floor(ordered.length / 2);

	return Math.round(
		ordered.length % 2
			? (ordered[middle] ?? 0)
			: ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2,
	);
}

function round(value: number, places: number): number {
	const scale = 10 ** places;

	return Math.round(value * scale) / scale;
}

function grab(groups: Map<string, Tally>, key: string): Tally {
	let found = groups.get(key);

	if (!found) {
		found = tally();
		groups.set(key, found);
	}

	return found;
}

function sorted(groups: Map<string, Tally>): [string, Tally][] {
	return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
