import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	type Aggregate,
	aggregate,
	type FlightRow,
	LAUNCH_STATES,
} from '../../src/flight-history/aggregate.ts';
import { EXPECTED, runChecks } from '../../src/flight-history/checks.ts';
import { nextUpdate, sourceUrl } from '../../src/flight-history/index.ts';
import { summarize } from '../../src/flight-history/summary.ts';
import { readZippedCsv } from '../../src/lib/csv.ts';
import { formatRows } from '../../src/lib/write.ts';

// Nine made-up flights (see on-time-sample.csv): six AAA to BBB (one early,
// one 20 minutes late, one exactly 15 minutes late, one cancelled, one
// diverted), one BBB to AAA, one to Alaska and one from Puerto Rico, which
// the launch area leaves out.
const sample = join(import.meta.dirname, 'on-time-sample.zip');

const month = '2026-08';
const run = () => aggregate(readZippedCsv(sample), month);
const find = (rows: FlightRow[], key: string, value: string) =>
	rows.find((row) => key in row && (row as unknown as Record<string, unknown>)[key] === value);

describe('aggregate', () => {
	it('counts only flights between the Lower 48 and DC', async () => {
		const result = await run();

		expect(result.kept).toBe(7);
		expect(result.outside).toBe(2);
		expect(result.otherMonth).toBe(0);
		expect(LAUNCH_STATES.size).toBe(49);
	});

	it('summarizes a route: early arrivals negative, cancelled and diverted flights not flown but disrupted', async () => {
		const { rows } = await run();

		expect(find(rows, 'route', 'AAA-BBB')).toEqual({
			route: 'AAA-BBB',
			month,
			flights: 6,
			averageDelayMinutes: 8.8, // (10 + 20 - 10 + 15) / 4 flown
			delayShare: 0.5, // 20 and exactly 15 minutes late both count, as DOT counts them
			disruptShare: 0.333, // one cancelled and one diverted, out of six
			scheduledMinutes: 60, // the middle of 60, 60, 60, 60, 60, 70
		});
	});

	it('counts an airport’s flights in and out', async () => {
		const { rows } = await run();

		expect(find(rows, 'airport', 'AAA')).toEqual({
			airport: 'AAA',
			month,
			flights: 7,
			averageDelayMinutes: 8, // (10 + 20 - 10 + 15 + 5) / 5 flown
			delayShare: 0.4,
			disruptShare: 0.286, // two of seven
		});
		expect(find(rows, 'airport', 'ANC')).toBeUndefined();
		expect(find(rows, 'airport', 'SJU')).toBeUndefined();
	});

	it('adds a nationwide row, and puts it first, then airports, then routes', async () => {
		const { rows } = await run();

		expect(rows[0]).toMatchObject({ nation: 'US', flights: 7 });
		expect(rows.map((row) => Object.keys(row)[0])).toEqual([
			'nation',
			'airport',
			'airport',
			'route',
			'route',
		]);
	});

	it('gives a route with no flown flights no row', async () => {
		const { rows } = await aggregate(
			[
				{
					FlightDate: '2026-08-01',
					Origin: 'AAA',
					OriginState: 'TX',
					Dest: 'BBB',
					DestState: 'CA',
					Cancelled: '1.00',
					Diverted: '0.00',
					ArrDelay: '',
					CRSElapsedTime: '60.00',
				},
			],
			month,
		);

		expect(rows).toEqual([]);
	});

	it('counts flights dated outside the month, and leaves them out', async () => {
		const result = await aggregate(
			[
				{
					FlightDate: '2026-07-31',
					Origin: 'AAA',
					OriginState: 'TX',
					Dest: 'BBB',
					DestState: 'CA',
				},
			],
			month,
		);

		expect(result.otherMonth).toBe(1);
		expect(result.kept).toBe(0);
	});

	it('writes the same bytes every time', async () => {
		expect(formatRows((await run()).rows)).toBe(formatRows((await run()).rows));
	});
});

/** A month shaped like a real one, to run the checks on. */
function plausible(): Aggregate {
	const rows: FlightRow[] = [
		{
			nation: 'US',
			month,
			flights: 500_000,
			averageDelayMinutes: 10,
			delayShare: 0.2,
			disruptShare: 0.02,
		},
	];

	// Each flight is at two airports, so the airports add up to twice the nation.
	for (let i = 0; i < 250; i++) {
		rows.push({
			airport: `A${i}`,
			month,
			flights: 4_000,
			averageDelayMinutes: 10,
			delayShare: 0.2,
			disruptShare: 0.02,
		});
	}

	for (let i = 0; i < 5_000; i++) {
		rows.push({
			route: `R${i}`,
			month,
			flights: 100,
			averageDelayMinutes: 10,
			delayShare: 0.2,
			disruptShare: 0.02,
			scheduledMinutes: 90,
		});
	}

	return { rows, kept: 500_000, outside: 0, otherMonth: 0 };
}

const failing = (result: Aggregate) =>
	runChecks(result)
		.filter((check) => !check.passed)
		.map((check) => check.name);

describe('runChecks', () => {
	it('passes a month that looks like a real one', () => {
		expect(failing(plausible())).toEqual([]);
	});

	it('fails a file with another month in it', () => {
		expect(failing({ ...plausible(), otherMonth: 3 })).toEqual([
			'The file holds only the month asked for',
		]);
	});

	it('fails a truncated download', () => {
		const small = plausible();
		small.rows = small.rows.slice(0, 50);

		expect(failing(small).length).toBeGreaterThan(0);
		expect(EXPECTED.routeRows[0]).toBeGreaterThan(50);
	});

	it('fails when the route rows fall short of the nationwide row', () => {
		const short = plausible();
		short.rows = short.rows.slice(0, -100); // 100 routes lost, 2% of the flights

		expect(failing(short)).toEqual(['Route rows add up to the nationwide row']);
	});

	it('forgives a few routes left out for having no flown flight', () => {
		const nearly = plausible();
		nearly.rows = nearly.rows.slice(0, -10); // 10 routes, 0.2% of the flights

		expect(failing(nearly)).toEqual([]);
	});

	it('fails when the nationwide row is bigger than its parts', () => {
		const bad = plausible();
		bad.rows[0] = { ...bad.rows[0], flights: 520_000 } as FlightRow;

		expect(failing(bad)).toEqual([
			'Route rows add up to the nationwide row',
			'Airport rows add up to twice the nationwide row (each flight is at two airports)',
		]);
	});

	it('fails when the parts add up to more than the nationwide row', () => {
		const bad = plausible();
		bad.rows[0] = { ...bad.rows[0], flights: 480_000 } as FlightRow;

		expect(failing(bad)).toEqual([
			'Route rows add up to the nationwide row',
			'Airport rows add up to twice the nationwide row (each flight is at two airports)',
		]);
	});

	it('fails a share outside 0 to 1', () => {
		const bad = plausible();
		bad.rows[1] = { ...bad.rows[1], delayShare: 1.2 } as FlightRow;

		expect(failing(bad)).toEqual(['Every share is between 0 and 1']);
	});

	it('fails a route with no scheduled time', () => {
		const bad = plausible();
		bad.rows[bad.rows.length - 1] = {
			route: 'R4999',
			month,
			flights: 100,
			averageDelayMinutes: 10,
			delayShare: 0.2,
			disruptShare: 0.02,
		};

		expect(failing(bad)).toEqual(['Every route has a scheduled time']);
	});
});

describe('summarize', () => {
	it('compares the month with the one before and a year earlier, and lists the checks', () => {
		const current = plausible();
		const before: FlightRow[] = [
			{
				nation: 'US',
				month: '2026-07',
				flights: 480_000,
				averageDelayMinutes: 12.5,
				delayShare: 0.25,
				disruptShare: 0.03,
			},
		];
		const text = summarize(month, current.rows, runChecks(current), {
			previous: before,
			yearAgo: null,
		});

		expect(text).toContain('## Flight history for 2026-08');
		expect(text).toContain('5,000 routes, 250 airports, and 500,000 flights');
		expect(text).toContain('| Month before | 480,000 | 12.5 min | 25.0% | 3.0% |');
		expect(text).toContain('| A year earlier | not in the repo |');
		expect(text).toContain('✅ The file holds only the month asked for');
		expect(text).not.toContain('❌');
	});
});

describe('nextUpdate', () => {
	it('offers the month after the newest, when DOT has it', async () => {
		const result = await nextUpdate(['2026-06', '2026-07'], async (m) => m === '2026-08');

		expect(result.next).toBe('2026-08');
	});

	it('says it is up to date when DOT does not have the next month yet', async () => {
		const result = await nextUpdate(['2026-07', '2026-08'], async () => false);

		expect(result.next).toBeNull();
		expect(result.note).toContain('2026-08 is the newest');
	});

	it('points to the backfill when the repo has no months', async () => {
		const result = await nextUpdate([], async () => true);

		expect(result.next).toBeNull();
		expect(result.note).toContain('backfill');
	});
});

describe('sourceUrl', () => {
	it('uses BTS’s address, with no leading zero on the month', () => {
		expect(sourceUrl('2026-08')).toBe(
			'https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_2026_8.zip',
		);
		expect(sourceUrl('2025-12')).toContain('_2025_12.zip');
	});
});
