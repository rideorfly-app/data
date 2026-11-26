import { LAUNCH_STATES } from '../flight-history/aggregate.ts';
import type { Month } from '../lib/months.ts';

/** One route's flown flights on one day. */
export interface RouteDay {
	route: string;
	day: string;

	/** Each flight's time from its scheduled departure to its actual arrival: the scheduled gate-to-gate time plus the arrival delay, early arrivals negative. */
	minutes: number[];
}

/**
 * Groups a month of DOT's on-time records by route and day. The flights it
 * counts are the ones `flight-history` counts (both ends in the Lower 48 and
 * DC); cancelled and diverted flights are left out, since they have no
 * arrival delay.
 */
export async function routeDays(
	records: AsyncIterable<Record<string, string>> | Iterable<Record<string, string>>,
	month: Month,
): Promise<RouteDay[]> {
	const groups = new Map<string, RouteDay>();

	for await (const record of records) {
		const { FlightDate: day, Origin: from, Dest: to } = record;

		if (
			!day?.startsWith(month) ||
			!from ||
			!to ||
			!LAUNCH_STATES.has(record.OriginState ?? '') ||
			!LAUNCH_STATES.has(record.DestState ?? '') ||
			Number(record.Cancelled) === 1 ||
			Number(record.Diverted) === 1
		) {
			continue;
		}

		const delay = record.ArrDelay === '' ? Number.NaN : Number(record.ArrDelay);
		const scheduled = record.CRSElapsedTime === '' ? Number.NaN : Number(record.CRSElapsedTime);

		if (Number.isNaN(delay) || Number.isNaN(scheduled)) {
			continue;
		}

		const route = `${from}-${to}`;
		const key = `${route} ${day}`;
		let group = groups.get(key);

		if (!group) {
			group = { route, day, minutes: [] };
			groups.set(key, group);
		}

		group.minutes.push(scheduled + delay);
	}

	return [...groups.values()];
}
