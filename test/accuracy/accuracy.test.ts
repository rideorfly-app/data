import { join } from 'node:path';
import type { FlightMonth } from '@rideorfly/engine';
import { describe, expect, it } from 'vitest';
import { routeDays } from '../../src/accuracy/flights.ts';
import { type Index, keyOf, seriesUpTo } from '../../src/accuracy/history.ts';
import { buildReport } from '../../src/accuracy/report.ts';
import {
	estimateRoutes,
	MIN_DAY_FLIGHTS,
	scoreDelays,
	scoreFlightTimes,
} from '../../src/accuracy/score.ts';
import { median, quantile, round } from '../../src/accuracy/stats.ts';
import { summarize } from '../../src/accuracy/summary.ts';
import type { FlightRow } from '../../src/flight-history/aggregate.ts';
import { readZippedCsv } from '../../src/lib/csv.ts';
import { formatRows } from '../../src/lib/write.ts';

// The nine flights from the flight-history tests (see on-time-sample.csv).
const sample = join(import.meta.dirname, '..', 'flight-history', 'on-time-sample.zip');

const figures = (
	month: string,
	flights: number,
	averageDelayMinutes: number,
	delayShare: number,
	disruptShare: number,
	scheduledMinutes?: number,
): FlightMonth => ({
	month,
	flights,
	averageDelayMinutes,
	delayShare,
	disruptShare,
	...(scheduledMinutes === undefined ? {} : { scheduledMinutes }),
});

const rowFor = (key: string, row: FlightMonth): FlightRow =>
	key.startsWith('route:')
		? { route: key.slice('route:'.length), ...row }
		: key.startsWith('airport:')
			? { airport: key.slice('airport:'.length), ...row }
			: { nation: 'US', ...row };

/** A history from `[key, row]` pairs, with months in order the way `loadIndex` makes it. */
function indexOf(entries: [string, FlightMonth][]): Index {
	const index: Index = new Map();

	for (const [key, row] of [...entries].sort(([, a], [, b]) => (a.month < b.month ? -1 : 1))) {
		const month = index.get(row.month) ?? new Map();

		month.set(key, rowFor(key, row));
		index.set(row.month, month);
	}

	return index;
}

// June 2025 is the month under test, and a lead of 3 months means the engine
// knows March 2025 and earlier. The figures are made up: these tests check the
// arithmetic, not which method does better.
//
// - AAA-BBB is a busy route with a June in each of five past years (2020 is
//   skipped) that average 11 minutes, 0.152 late, and 0.02 disrupted, and two
//   airports that have a June of their own.
// - EEE-FFF is a thin route with one past June and two airports.
// - GGG-HHH has one past June and no airports in the history.
// - CCC-DDD has no record in the newest month.
const history = indexOf([
	['route:AAA-BBB', figures('2025-03', 200, 12, 0.2, 0.02, 100)],
	['route:AAA-BBB', figures('2025-06', 300, 18, 0.3, 0.04, 100)],
	['route:AAA-BBB', figures('2024-06', 200, 16, 0.25, 0.03, 100)],
	['route:AAA-BBB', figures('2023-06', 200, 12, 0.14, 0.02, 100)],
	['route:AAA-BBB', figures('2022-06', 200, 11, 0.15, 0.03, 100)],
	['route:AAA-BBB', figures('2021-06', 200, 9, 0.12, 0.01, 100)],
	['route:AAA-BBB', figures('2020-06', 200, 90, 0.9, 0.5, 100)],
	['route:AAA-BBB', figures('2019-06', 200, 7, 0.1, 0.01, 100)],
	['airport:AAA', figures('2024-06', 900, 8, 0.1, 0.01)],
	['airport:AAA', figures('2023-06', 900, 6, 0.1, 0.01)],
	['airport:BBB', figures('2024-06', 900, 5, 0.1, 0.01)],
	['route:EEE-FFF', figures('2025-03', 50, 5, 0.1, 0.01, 80)],
	['route:EEE-FFF', figures('2025-06', 60, 9, 0.2, 0.02, 80)],
	['route:EEE-FFF', figures('2024-06', 50, 6, 0.1, 0.01, 80)],
	['airport:EEE', figures('2024-06', 900, 10, 0.1, 0.01)],
	['airport:FFF', figures('2024-06', 900, 14, 0.1, 0.01)],
	['route:GGG-HHH', figures('2025-03', 150, 4, 0.1, 0.01, 60)],
	['route:GGG-HHH', figures('2025-06', 100, 8, 0.2, 0.02, 60)],
	['route:GGG-HHH', figures('2024-06', 150, 6, 0.1, 0.01, 60)],
	['route:CCC-DDD', figures('2025-06', 40, 3, 0.1, 0.0, 90)],

	// Months DOT hadn't published when the estimate was made. The estimate must
	// not see them, so they hold figures that would change it a lot.
	['route:AAA-BBB', figures('2025-04', 200, 99, 0.9, 0.5, 100)],
	['route:AAA-BBB', figures('2025-05', 200, 99, 0.9, 0.5, 100)],
]);

describe('stats', () => {
	it('finds quantiles between values', () => {
		expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
		expect(quantile([10, 20, 30, 40], 0.25)).toBe(17.5);
		expect(median([30, 10, 20])).toBe(20);
		expect(median([])).toBe(0);
		expect(round(1.2345, 2)).toBe(1.23);
	});
});

describe('history', () => {
	it('keys rows by what they describe', () => {
		expect(keyOf(rowFor('route:AAA-BBB', figures('2025-03', 1, 0, 0, 0, 60)))).toBe(
			'route:AAA-BBB',
		);
		expect(keyOf(rowFor('airport:AAA', figures('2025-03', 1, 0, 0, 0)))).toBe('airport:AAA');
		expect(keyOf(rowFor('nation', figures('2025-03', 1, 0, 0, 0)))).toBe('nation');
	});

	it('leaves out months after the newest one known', () => {
		const months = seriesUpTo(history, 'route:AAA-BBB', '2025-03').map((row) => row.month);

		expect(months).toEqual([
			'2019-06',
			'2020-06',
			'2021-06',
			'2022-06',
			'2023-06',
			'2024-06',
			'2025-03',
		]);
	});
});

describe('routeDays', () => {
	it('groups flown flights by route and day, leaving out the rest', async () => {
		const days = await routeDays(readZippedCsv(sample), '2026-08');
		const times = Object.fromEntries(days.map((day) => [`${day.route} ${day.day}`, day.minutes]));

		// The scheduled time plus the arrival delay, early arrivals negative. The
		// cancelled and diverted flights, Alaska, and Puerto Rico are left out.
		expect(times).toEqual({
			'AAA-BBB 2026-08-01': [70],
			'AAA-BBB 2026-08-02': [90],
			'AAA-BBB 2026-08-03': [50],
			'AAA-BBB 2026-08-09': [75],
			'BBB-AAA 2026-08-06': [70],
		});
	});
});

describe('estimateRoutes', () => {
	const { routes, unknown } = estimateRoutes(history, '2025-06', 3);
	const find = (route: string) => routes.find((r) => r.route === route);

	it('averages the five past Junes and blends in the airports', () => {
		const route = find('AAA-BBB');

		// The route's Junes average 11 over 200 flights a month, so it counts two
		// thirds; its airports average 6 (7 and 5) and count a third.
		expect(route?.estimates.average.averageDelayMinutes).toBeCloseTo((2 / 3) * 11 + (1 / 3) * 6);
		expect(route?.estimates.average.delayChance).toBeCloseTo((2 / 3) * 0.152 + (1 / 3) * 0.1);
		expect(route?.estimates.average.disruptChance).toBeCloseTo((2 / 3) * 0.02 + (1 / 3) * 0.01);
		expect(route?.basis).toBe('route-and-airports');
		expect(route?.thin).toBe(false);

		// The newest month alone, and last June alone.
		expect(route?.estimates.newest.averageDelayMinutes).toBe(12);
		expect(route?.estimates['last-year'].averageDelayMinutes).toBe(16);
	});

	it('counts a thin route mostly for its airports', () => {
		const route = find('EEE-FFF');

		// 50 flights a month: a third its own June (6), two thirds its airports (12).
		expect(route?.thin).toBe(true);
		expect(route?.basis).toBe('route-and-airports');
		expect(route?.estimates.average.averageDelayMinutes).toBeCloseTo(10);
	});

	it('uses the route alone when its airports aren’t in the history', () => {
		const route = find('GGG-HHH');

		expect(route?.basis).toBe('route');
		expect(route?.estimates.average.averageDelayMinutes).toBe(6);
	});

	it('never sees months after the newest one known', () => {
		// April, May, and the month under test are all in the history, but a lead
		// of 3 months means March was the newest DOT had published.
		for (const { estimates } of routes) {
			for (const estimate of Object.values(estimates)) {
				expect(estimate.newestMonth).toBe('2025-03');
			}
		}
	});

	it('counts a route with no record in the newest month as unknown', () => {
		expect(find('CCC-DDD')).toBeUndefined();
		expect(unknown).toEqual({ routes: 1, flights: 40 });
	});
});

describe('scoreDelays', () => {
	const { routes } = estimateRoutes(history, '2025-06', 3);
	const scored = scoreDelays(routes);
	const find = (method: string, group: string) =>
		scored.find((s) => s.method === method && s.group === group);

	it('scores each method against what the busy route really did', () => {
		// June 2025 really ran 18 minutes, 30% delayed, 4% disrupted, over 300
		// flights. The average is 8.67 minutes under, 0.1653 under on lateness.
		expect(find('average', 'busy')).toMatchObject({ routes: 2, flights: 400 });
		expect(find('newest', 'basis-route-and-airports')).toMatchObject({
			routes: 2,
			flights: 360,
			maeDelayMinutes: 5.67, // (6 × 300 + 4 × 60) ÷ 360
		});
	});

	it('weights each route by its flights', () => {
		// Off by 8.67, 1, and 2 minutes on 300, 60, and 100 flights: 2,860 ÷ 460.
		expect(find('average', 'all')).toMatchObject({
			routes: 3,
			flights: 460,
			maeDelayMinutes: 6.22,
			biasDelayMinutes: -5.96,
		});

		// Off by 6, 4, and 4: 2,440 ÷ 460. And by 2, 3, and 2: 980 ÷ 460.
		expect(find('newest', 'all')).toMatchObject({ maeDelayMinutes: 5.3, biasDelayMinutes: -5.3 });
		expect(find('last-year', 'all')).toMatchObject({ maeDelayMinutes: 2.13 });
	});

	it('breaks the scores down by busy and thin routes and by what the estimate rested on', () => {
		// Busy is AAA-BBB and GGG-HHH (150 flights in March): 2,800 ÷ 400.
		expect(find('average', 'busy')).toMatchObject({ maeDelayMinutes: 7, biasDelayMinutes: -7 });

		// Thin is EEE-FFF, which the average put 1 minute over.
		expect(find('average', 'thin')).toMatchObject({
			routes: 1,
			flights: 60,
			maeDelayMinutes: 1,
			biasDelayMinutes: 1,
		});
		expect(find('average', 'basis-route')?.routes).toBe(1);
		expect(find('average', 'basis-route-and-airports')?.routes).toBe(2);
		expect(find('average', 'basis-newest-month')).toBeUndefined();
	});

	it('scores the chances too', () => {
		expect(find('newest', 'thin')).toMatchObject({
			maeDelayShare: 0.1, // 0.1 against 0.2
			maeDisruptShare: 0.01,
		});
	});
});

describe('scoreFlightTimes', () => {
	const { routes } = estimateRoutes(history, '2025-06', 3);
	const day = (route: string, minutes: number[], n: number) => ({
		route,
		day: `2025-06-${String(n).padStart(2, '0')}`,
		minutes,
	});
	const days = [
		// Typical 117.5, middle half 113.75 to 121.25.
		day('AAA-BBB', [110, 115, 120, 125], 1),
		day('AAA-BBB', [150, 150, 150], 2),
		day('AAA-BBB', [112, 112, 112], 3),

		// Too few flights, a route with no estimate, and a thin route.
		day('AAA-BBB', [60, 70], 4),
		day('CCC-DDD', [90, 90, 90], 1),
		day('EEE-FFF', [80, 80, 80], 1),
	];
	const scored = scoreFlightTimes(routes, days);
	const find = (method: string, group: string) =>
		scored.find((s) => s.method === method && s.group === group);

	it('needs three flights in a day', () => {
		expect(MIN_DAY_FLIGHTS).toBe(3);
		expect(find('average', 'busy')?.routeDays).toBe(3);
		expect(find('average', 'thin')?.routeDays).toBe(1);
		expect(find('average', 'all')?.routeDays).toBe(4);
	});

	it('compares the scheduled time plus the expected delay with the day’s typical time', () => {
		// 100 + 9.33 = 109.33 against 117.5, 150, and 112: off by -8.17, -40.67, and -2.67.
		expect(find('average', 'busy')).toMatchObject({
			medianErrorMinutes: -8.2,
			medianAbsErrorMinutes: 8.2,
			within10Minutes: 0.667,
			within15Percent: 0.667,
			withinSpread: 0,
		});
	});

	it('scores the other methods the same way', () => {
		// 100 + 12 = 112: off by -5.5, -38, and 0. Only the third is inside its spread.
		expect(find('newest', 'busy')).toMatchObject({
			medianErrorMinutes: -5.5,
			within10Minutes: 0.667,
			withinSpread: 0.333,
		});
	});

	it('also measures against the day’s average flight, which late flights pull above its typical one', () => {
		// 95, 95, 95, and 125: typical 95, average 102.5. The estimate of 109.33 is
		// 14.33 above the typical flight but only 6.83 above the average.
		const skewed = scoreFlightTimes(routes, [day('AAA-BBB', [95, 95, 95, 125], 5)]);
		const average = skewed.find((s) => s.method === 'average' && s.group === 'all');

		expect(average).toMatchObject({
			routeDays: 1,
			medianErrorMinutes: 14.3,
			within10Minutes: 0,
			medianErrorVsAverageMinutes: 6.8,
			within10MinutesOfAverage: 1,
		});
	});
});

describe('buildReport', () => {
	const days = [{ route: 'AAA-BBB', day: '2025-06-01', minutes: [110, 115, 120, 125] }];

	// A six-month lead needs December 2024 in the history, though no route has a record there.
	const withDecember: Index = new Map(
		([...history, ['2024-12', new Map()]] as [string, Map<string, FlightRow>][]).sort(([a], [b]) =>
			a < b ? -1 : 1,
		),
	);

	it('reports each lead time and names the engine', () => {
		const rows = buildReport(withDecember, '2025-06', days, 'abc1234');

		expect(rows[0]).toEqual({
			kind: 'report',
			month: '2025-06',
			engine: 'abc1234',
			minDayFlights: 3,
		});
		expect(rows.filter((row) => row.kind === 'coverage')).toEqual([
			{
				kind: 'coverage',
				month: '2025-06',
				leadMonths: 3,
				routes: 3,
				flights: 460,
				unknownRoutes: 1,
				unknownFlights: 40,
			},
			{
				kind: 'coverage',
				month: '2025-06',
				leadMonths: 6,
				routes: 0,
				flights: 0,
				unknownRoutes: 4,
				unknownFlights: 500,
			},
		]);
		expect(rows.some((row) => row.kind === 'delay' && row.leadMonths === 3)).toBe(true);
		expect(rows.some((row) => row.kind === 'flight-time' && row.leadMonths === 3)).toBe(true);
	});

	it('writes the same bytes every time, one row per line', () => {
		const first = formatRows(buildReport(withDecember, '2025-06', days, 'abc1234'));
		const second = formatRows(buildReport(withDecember, '2025-06', days, 'abc1234'));

		expect(first).toBe(second);
		expect(first.split('\n').length).toBe(JSON.parse(first).length + 3);
	});

	it('refuses a month it has no history to check against', () => {
		expect(() => buildReport(history, '2025-07', days, 'abc1234')).toThrow(
			/no flight history for 2025-07/,
		);
		expect(() => buildReport(history, '2025-06', days, 'abc1234')).toThrow(
			/needs the flight history for 2024-12/,
		);
	});

	it('summarizes for the pull request', () => {
		const text = summarize('2025-06', buildReport(withDecember, '2025-06', days, 'abc1234'));

		expect(text).toContain('## Accuracy report for 2025-06');
		expect(text).toContain('engine abc1234');
		expect(text).toContain('### 3 months ahead');
		expect(text).toContain('### 6 months ahead');
		expect(text).toContain('| average |');
	});
});
