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

// Eight made-up flights (see on-time-sample.csv): five AAA to BBB (one early,
// one late, one cancelled, one diverted), one BBB to AAA, one to Alaska and
// one from Puerto Rico, which the launch area leaves out.
const sample = join(import.meta.dirname, 'on-time-sample.zip');

const month = '2026-08';
const run = () => aggregate(readZippedCsv(sample), month);
const find = (rows: FlightRow[], key: string, value: string) =>
	rows.find((row) => key in row && (row as unknown as Record<string, unknown>)[key] === value);

describe('aggregate', () => {
	it('counts only flights between the Lower 48 and DC', async () => {
		const result = await run();

		expect(result.kept).toBe(6);
		expect(result.outside).toBe(2);
		expect(result.otherMonth).toBe(0);
		expect(LAUNCH_STATES.size).toBe(49);
	});

	it('summarizes a route: early arrivals negative, cancelled and diverted flights not flown but disrupted', async () => {
		const { rows } = await run();

		expect(find(rows, 'route', 'AAA-BBB')).toEqual({
			route: 'AAA-BBB',
			month,
			flights: 5,
			averageDelayMinutes: 6.7, // (10 + 20 - 10) / 3 flown
			delayShare: 0.333, // one of three flown arrived over 15 minutes late
			disruptShare: 0.4, // one cancelled and one diverted, out of five
			scheduledMinutes: 60, // the middle of 60, 60, 60, 60, 70
		});
	});

	it('counts an airport’s flights in and out', async () => {
		const { rows } = await run();

		expect(find(rows, 'airport', 'AAA')).toEqual({
			airport: 'AAA',
			month,
			flights: 6,
			averageDelayMinutes: 6.3, // (10 + 20 - 10 + 5) / 4 flown
			delayShare: 0.25,
			disruptShare: 0.333, // two of six
		});
		expect(find(rows, 'airport', 'ANC')).toBeUndefined();
		expect(find(rows, 'airport', 'SJU')).toBeUndefined();
	});

	it('adds a nationwide row, and puts it first, then airports, then routes', async () => {
		const { rows } = await run();

		expect(rows[0]).toMatchObject({ nation: 'US', flights: 6 });
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

	for (let i = 0; i < 300; i++) {
		rows.push({
			airport: `A${i}`,
			month,
			flights: 10,
			averageDelayMinutes: 10,
			delayShare: 0.2,
			disruptShare: 0.02,
		});
	}

	for (let i = 0; i < 5_000; i++) {
		rows.push({
			route: `R${i}`,
			month,
			flights: 10,
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

	it('fails when the nationwide row disagrees with the flights kept', () => {
		expect(failing({ ...plausible(), kept: 400_000 })).toEqual([
			'The nationwide row counts every flight kept',
		]);
	});

	it('fails a share outside 0 to 1', () => {
		const bad = plausible();
		bad.rows.push({
			airport: 'ZZZ',
			month,
			flights: 1,
			averageDelayMinutes: 0,
			delayShare: 1.2,
			disruptShare: 0,
		});

		expect(failing(bad)).toContain('Every share is between 0 and 1');
	});

	it('fails a route with no scheduled time', () => {
		const bad = plausible();
		bad.rows.push({
			route: 'ZZZ-YYY',
			month,
			flights: 1,
			averageDelayMinutes: 0,
			delayShare: 0,
			disruptShare: 0,
		});

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
		expect(text).toContain('5,000 routes, 300 airports, and 500,000 flights');
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
