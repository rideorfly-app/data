import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type GasRow, runChecks } from '../../src/gas-prices/checks.ts';
import { nextWeek, weeksOnHand } from '../../src/gas-prices/index.ts';
import {
	priceFor,
	REGIONS,
	readSeries,
	SERIES,
	type Weekly,
	weeksBefore,
} from '../../src/gas-prices/series.ts';
import { summarize } from '../../src/gas-prices/summary.ts';
import { formatRows } from '../../src/lib/write.ts';
import { readZippedLines } from '../../src/lib/zip.ts';

// Twelve made-up JSON lines (see PET.txt): the nine real series, a null week,
// and three decoys (crude oil stocks, diesel, and Colorado) that must be ignored.
const sample = join(import.meta.dirname, 'eia-sample.zip');
const week = '2026-10-26';

const read = async (): Promise<Weekly> => readSeries(readZippedLines(sample, 'PET.txt'));

/** The sample's rows for `week`. */
async function rowsFor(): Promise<GasRow[]> {
	const weekly = await read();

	return REGIONS.map((region) => ({
		week,
		region,
		dollarsPerGallon: priceFor(weekly, region, week) ?? Number.NaN,
	}));
}

describe('readZippedLines', () => {
	it('reads a text file inside a zip a line at a time', async () => {
		const lines: string[] = [];

		for await (const line of readZippedLines(sample, 'PET.txt')) {
			lines.push(line);
		}

		expect(lines).toHaveLength(12);
		expect(lines[0]).toContain('PET.WCRSTUS1.W');
	});

	it('fails loudly when the file isn’t in the zip', async () => {
		const drain = async () => {
			for await (const _ of readZippedLines(sample, 'nope.txt')) {
				// Nothing to read.
			}
		};

		await expect(drain()).rejects.toThrow(/unzip failed/);
	});
});

describe('readSeries', () => {
	it('keeps the nine regions and ignores every other series', async () => {
		const weekly = await read();

		expect([...weekly.keys()].sort()).toEqual([...REGIONS].sort());
		expect(Object.keys(SERIES)).toHaveLength(9);
	});

	it('lists weeks newest first as dates, and drops a week with no price', async () => {
		const national = (await read()).get('national');

		expect(national).toEqual([
			['2026-10-26', 4],
			['2026-10-19', 3.9],
			['2026-10-12', 3.85],
			['2025-10-27', 3.5],
		]);
	});

	it('matches California and the rest of the West Coast to their own series', async () => {
		const weekly = await read();

		expect(priceFor(weekly, 'west-coast', week)).toBe(4.7);
		expect(priceFor(weekly, 'california', week)).toBe(5.5);
		expect(priceFor(weekly, 'midwest', '2026-01-05')).toBeUndefined();
	});
});

describe('weeksBefore', () => {
	it('counts back in whole weeks, across a year', () => {
		expect(weeksBefore(week, 1)).toBe('2026-10-19');
		expect(weeksBefore(week, 52)).toBe('2025-10-27');
		expect(weeksBefore('2026-01-05', 1)).toBe('2025-12-29');
	});
});

describe('runChecks', () => {
	const failedNames = (rows: GasRow[], forWeek = week) =>
		runChecks(forWeek, rows)
			.filter((check) => !check.passed)
			.map((check) => check.name);

	it('passes for a real week', async () => {
		expect(failedNames(await rowsFor())).toEqual([]);
	});

	it('wants a Monday', async () => {
		expect(failedNames(await rowsFor(), '2026-10-27')).toHaveLength(2); // the Monday check, and rows dated another week
	});

	it('catches prices that are in cents, or too low', async () => {
		const rows = await rowsFor();

		expect(
			failedNames(rows.map((row) => ({ ...row, dollarsPerGallon: row.dollarsPerGallon * 100 }))),
		).toEqual(
			expect.arrayContaining([
				expect.stringContaining('plausible'),
				expect.stringContaining('within'),
			]),
		);
		expect(failedNames(rows.map((row) => ({ ...row, dollarsPerGallon: 1 })))).toEqual([
			expect.stringContaining('plausible'),
		]);
	});

	it('catches a region that sits too far from the nation', async () => {
		const rows = (await rowsFor()).map((row) =>
			row.region === 'california' ? { ...row, dollarsPerGallon: 6.6 } : row,
		);

		expect(failedNames(rows)).toEqual([expect.stringContaining('within $2.50 of the national')]);
	});

	it('catches a missing region and a doubled one', async () => {
		const rows = await rowsFor();

		expect(failedNames(rows.filter((row) => row.region !== 'midwest'))).toEqual([
			expect.stringContaining('exactly one price'),
		]);
		expect(failedNames([...rows, rows[1] as GasRow])).toEqual([
			expect.stringContaining('exactly one price'),
		]);
	});
});

describe('nextWeek', () => {
	const available = ['2026-10-12', '2026-10-19', '2026-10-26'];

	it('says to make the first week by hand when the repo has none', () => {
		expect(nextWeek([], available)).toEqual({
			next: null,
			note: expect.stringContaining('No weeks in the repo yet'),
		});
	});

	it('offers the week after the newest one on hand, so a gap is never skipped', () => {
		expect(nextWeek(['2026-10-05', '2026-10-12'], available).next).toBe('2026-10-19');
	});

	it('knows when the repo is up to date', () => {
		expect(nextWeek(['2026-10-26'], available)).toEqual({
			next: null,
			note: expect.stringContaining('Up to date: 2026-10-26'),
		});
	});
});

describe('weeksOnHand', () => {
	it('lists only dated week files, and nothing for a folder that isn’t there', async () => {
		expect(await weeksOnHand(join(import.meta.dirname, 'nowhere'))).toEqual([]);
		expect(await weeksOnHand(import.meta.dirname)).toEqual([]);
	});
});

describe('summarize and the file format', () => {
	it('compares each region with the week before and a year earlier', async () => {
		const weekly = await read();
		const rows = await rowsFor();
		const text = summarize(week, rows, runChecks(week, rows), weekly);

		expect(text).toContain('## Gas prices for the week of 2026-10-26');
		expect(text).toContain('| national | $4.000 | +$0.100 | +$0.500 |');
		expect(text).toContain('| california | $5.500 | +$0.100 | +$0.700 |');
		expect(text).not.toContain('❌');
	});

	it('says n/a when EIA has no earlier week', async () => {
		const rows = await rowsFor();
		const text = summarize(week, rows, [], new Map());

		expect(text).toContain('| national | $4.000 | n/a | n/a |');
	});

	it('writes one row per line, keys in a fixed order, national first', async () => {
		const text = formatRows(await rowsFor());

		expect(text.split('\n')[1]).toBe(
			'{"week":"2026-10-26","region":"national","dollarsPerGallon":4},',
		);
		expect(text.split('\n')).toHaveLength(9 + 3);
	});
});
