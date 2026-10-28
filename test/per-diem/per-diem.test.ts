import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAUNCH_STATES } from '../../src/flight-history/aggregate.ts';
import { formatRows } from '../../src/lib/write.ts';
import { readXlsx, withHeaders } from '../../src/lib/xlsx.ts';
import { runChecks } from '../../src/per-diem/checks.ts';
import { nextYear, yearsOnHand } from '../../src/per-diem/index.ts';
import { findFiles } from '../../src/per-diem/links.ts';
import {
	type Destination,
	mealsTable,
	parseZipFile,
	readMealsTable,
	readZipFile,
	toRows,
} from '../../src/per-diem/read.ts';
import { summarize } from '../../src/per-diem/summary.ts';

// zip-sample.xlsx is GSA's ZIP-code file in miniature (see the made-up rows
// below); listing.html is the shape of GSA's files page; the meals table is the
// sample Word file with two tiers ($68 and $74).
const here = import.meta.dirname;
const zipSample = join(here, 'zip-sample.xlsx');
const mealsSample = join(here, '..', 'lib', 'sample.docx');
const base = 'https://www.gsa.gov/travel/plan-a-trip/per-diem-rates/per-diem-files';
const lunch = new Map([
	[68, 19],
	[74, 20],
	[80, 22],
	[86, 23],
]);

describe('findFiles', () => {
	it('finds the ZIP-code file of each year and the newest meals breakdown, and resolves relative links', async () => {
		const found = findFiles(await readFile(join(here, 'listing.html'), 'utf8'), base);

		expect([...found.zipFiles]).toEqual([
			[2027, 'https://www.gsa.gov/system/files/FY2027PerDiemZipCode_Validated090126.xlsx'],
			[2026, 'https://www.gsa.gov/system/files/FY2026_ZipCodeFile.xlsx'],
		]);
		expect(found.mealsTable).toBe(
			'https://www.gsa.gov/system/files/FY%202025%20MIE%20Breakdown.docx',
		);
	});

	it('finds nothing on a page that has changed', () => {
		expect(findFiles('<a href="/other.pdf">x</a>', base)).toEqual({
			zipFiles: new Map(),
			mealsTable: null,
		});
	});
});

describe('parseZipFile', () => {
	it('reads each row, with lodging in calendar order and a null county for the standard rate', async () => {
		const rows = parseZipFile(withHeaders(await readXlsx(zipSample)));

		expect(rows).toHaveLength(5);
		expect(rows[0]).toEqual({
			zip: '00501', // the leading zeros stay
			destinationId: 271,
			name: 'Riverhead / Ronkonkoma / Melville',
			county: 'Suffolk County, NY',
			state: 'NY',
			fiscalYear: 2027,
			lodging: Array(12).fill(163),
			meals: 86,
		});
		expect(rows[3]?.county).toBeNull();
		expect(rows[3]?.name).toBe('Standard Rate');

		// GSA lists October to September; the rows are January to December.
		expect(rows[4]?.lodging).toEqual([100, 100, 130, 144, 160, 180, 190, 160, 130, 120, 110, 100]);
	});

	it('says which column is missing when GSA changes its file', () => {
		expect(() => parseZipFile([{ ZIP: '00501', Name: 'x' }])).toThrow(
			/no column named "DestinationID"/,
		);
	});

	it('reads headers whatever their case, as in FY2026 ("Zip")', async () => {
		const [row] = withHeaders(await readXlsx(zipSample));
		const { ZIP, ...rest } = row as Record<string, string>;

		expect(parseZipFile([{ ...rest, Zip: ZIP as string }])[0]?.zip).toBe('00501');
	});

	it('refuses a rate that isn’t a number', async () => {
		const [row] = withHeaders(await readXlsx(zipSample));

		expect(() => parseZipFile([{ ...row, Jun: 'call' } as Record<string, string>])).toThrow(
			/"call" for lodging in Jun in ZIP 00501/,
		);
	});

	it('reads the file in one step', async () => {
		expect((await readZipFile(zipSample)).map((row) => row.zip)).toEqual([
			'00501',
			'01011',
			'01011',
			'01054',
			'36542',
		]);
	});
});

describe('mealsTable', () => {
	it('reads the lunch for each meals rate', async () => {
		expect(await readMealsTable(mealsSample)).toEqual(
			new Map([
				[68, 19],
				[74, 20],
			]),
		);
	});

	it('refuses a document that isn’t the breakdown', () => {
		expect(() => mealsTable([['Something else']])).toThrow(/no "M&IE Total" row/);
		expect(() => mealsTable([['M&IE Total', 'Lunch']])).toThrow(/has no rates/);
	});
});

describe('toRows', () => {
	/** A destination with the fields these tests care about. */
	const dest = (
		zip: string,
		destinationId: number,
		name: string,
		county: string | null,
		state: string,
		lodging: number[],
		meals: number,
	): Destination => ({ zip, destinationId, name, county, state, fiscalYear: 2027, lodging, meals });
	const flat = (rate: number) => Array(12).fill(rate) as number[];

	it('makes one row per ZIP code, in ZIP order, with the lunch added and the year dropped', async () => {
		const rows = toRows(await readZipFile(zipSample), lunch);

		expect(rows.map((row) => row.zip)).toEqual(['00501', '01011', '01054', '36542']);
		expect(JSON.stringify(rows[0])).toBe(
			'{"zip":"00501","destinationIds":[271],"name":"Riverhead / Ronkonkoma / Melville","county":"Suffolk County, NY","state":"NY","lodging":[163,163,163,163,163,163,163,163,163,163,163,163],"meals":86,"lunch":23}',
		);
	});

	it('averages a ZIP code that GSA lists in two counties', async () => {
		const [, row] = toRows(await readZipFile(zipSample), lunch);

		// Northampton ($157, meals $80, lunch $22) and Springfield ($131, $74, $20).
		expect(row).toEqual({
			zip: '01011',
			destinationIds: [154, 158],
			name: 'Northampton / Springfield',
			county: 'Hampshire County, MA / Hampden County, MA',
			state: 'MA',
			lodging: flat(144),
			meals: 77,
			lunch: 21,
		});
	});

	it('averages month by month, counts every row equally, and keeps cents', () => {
		const seasonal = [100, 100, 100, 100, 100, 100, 200, 100, 100, 100, 100, 100];
		const [row] = toRows(
			[
				dest('02110', 7, 'Boston', 'Suffolk County, MA', 'MA', seasonal, 92),
				dest('02110', 3, 'Burlington', 'Middlesex County, MA', 'MA', flat(110), 86),
				dest('02110', 5, 'Standard Rate', null, 'MA', flat(130), 68),
			],
			lunch,
		);

		expect(row?.destinationIds).toEqual([3, 5, 7]); // in destination order
		expect(row?.lodging[0]).toBe(113.33); // (110 + 130 + 100) / 3
		expect(row?.lodging[6]).toBe(146.67); // July: (110 + 130 + 200) / 3
		expect(row?.county).toBe('Middlesex County, MA / Suffolk County, MA'); // the standard rate has none
		expect(row?.meals).toBe(82); // (86 + 68 + 92) / 3
	});

	it('lists both states for a ZIP code that crosses a state line', () => {
		const [row] = toRows(
			[
				dest('06820', 1, 'Bridgeport', 'Fairfield County, CT', 'CT', flat(156), 86),
				dest('06820', 2, 'Tarrytown', 'Westchester County, NY', 'NY', flat(168), 86),
			],
			lunch,
		);

		expect(row?.state).toBe('CT / NY');
		expect(row?.lodging[0]).toBe(162);
	});

	it('writes the same bytes every time, one row per line', async () => {
		const rows = toRows(await readZipFile(zipSample), lunch);

		expect(formatRows(rows)).toBe(
			formatRows(toRows([...(await readZipFile(zipSample))].reverse(), lunch)),
		);
		expect(formatRows(rows).split('\n')).toHaveLength(4 + 3);
	});
});

describe('runChecks', () => {
	/** A year's worth of made-up destinations that should pass every check. */
	const big = (): Destination[] => [
		...Array.from({ length: 41_000 }, (_, i) => ({
			zip: String(i).padStart(5, '0'),
			destinationId: i % 500,
			name: 'Somewhere',
			county: 'A County, TX',
			state: 'TX',
			fiscalYear: 2027,
			lodging: Array(12).fill(120),
			meals: 68,
		})),
		{
			zip: '99999',
			destinationId: 0,
			name: 'Standard Rate',
			county: null,
			state: 'MA',
			fiscalYear: 2027,
			lodging: Array(12).fill(113),
			meals: 68,
		},
	];
	const failed = (rows: Destination[], year = 2027) =>
		runChecks(year, rows, lunch)
			.filter((check) => !check.passed)
			.map((check) => check.name);

	it('passes for a full year', () => {
		expect(failed(big())).toEqual([]);
	});

	it('fails on a file that is far too small', async () => {
		// The five sample rows are fine in every other way, so only the two counts fail.
		expect(failed(await readZipFile(zipSample))).toEqual([
			expect.stringContaining('number of rows'),
			expect.stringContaining('number of ZIP codes'),
		]);
	});

	it('catches the wrong year, a bad ZIP, a state outside the launch area, and a doubled row', () => {
		const rows = big();

		expect(failed(rows, 2028)).toEqual([expect.stringContaining('FY2028')]);
		expect(failed([...rows.slice(1), { ...(rows[0] as Destination), zip: '123' }])).toEqual(
			expect.arrayContaining([expect.stringContaining('five digits')]),
		);
		expect(LAUNCH_STATES.has('AK')).toBe(false);
		expect(failed([...rows.slice(1), { ...(rows[0] as Destination), state: 'AK' }])).toEqual([
			expect.stringContaining('Lower 48'),
		]);
		expect(failed([...rows, rows[5] as Destination])).toEqual([expect.stringContaining('twice')]);
	});

	it('names the rows that fail, such as the blank states GSA left in its FY2026 file', () => {
		const rows = big();
		const blank = {
			...(rows[0] as Destination),
			zip: '01470',
			name: 'Burlington / Woburn',
			state: '',
		};
		const result = runChecks(2027, [...rows.slice(1), blank], lunch).find((check) => !check.passed);

		expect(result?.name).toContain('Lower 48');
		expect(result?.detail).toBe('1 rows, such as 01470 Burlington / Woburn');
		expect(runChecks(2027, rows, lunch).every((check) => check.detail === undefined)).toBe(true);
	});

	it('catches rates in cents, a meals rate with no lunch, and a missing standard rate', () => {
		const rows = big();

		expect(
			failed([...rows.slice(1), { ...(rows[0] as Destination), lodging: Array(12).fill(12000) }]),
		).toEqual([expect.stringContaining('plausible ($50')]);
		expect(failed([...rows.slice(1), { ...(rows[0] as Destination), meals: 150 }])).toEqual([
			expect.stringContaining('lunch'),
		]);
		expect(
			failed(
				rows
					.filter((row) => row.name !== 'Standard Rate')
					.concat({ ...(rows[0] as Destination), zip: '99998' }),
			),
		).toEqual([expect.stringContaining('standard rate')]);
	});
});

describe('nextYear and yearsOnHand', () => {
	const available = ['FY2026', 'FY2027'];

	it('says to make the first year by hand when the repo has none', () => {
		expect(nextYear([], available)).toEqual({
			next: null,
			note: expect.stringContaining('No years in the repo yet'),
		});
	});

	it('offers the year after the newest one on hand, and knows when it is up to date', () => {
		expect(nextYear(['FY2025'], available).next).toBe('FY2026');
		expect(nextYear(['FY2027'], available)).toEqual({
			next: null,
			note: expect.stringContaining('Up to date: FY2027'),
		});
	});

	it('lists only fiscal-year files, and nothing for a folder that isn’t there', async () => {
		expect(await yearsOnHand(join(here, 'nowhere'))).toEqual([]);
		expect(await yearsOnHand(here)).toEqual([]);
	});
});

describe('summarize', () => {
	it('describes the year, the averaged ZIP codes, the standard rate, and the priciest place', async () => {
		const destinations = await readZipFile(zipSample);
		const text = summarize(2027, destinations, toRows(destinations, lunch), lunch, [], null);

		expect(text).toContain('## Per diem rates for FY2027');
		expect(text).toContain("5 rows in GSA's file became 4 ZIP codes");
		expect(text).toContain('1 ZIP codes are listed under more than one destination');
		expect(text).toContain('0 cross a state line');
		expect(text).toContain('the average of its rows');
		expect(text).toContain('standard rate, for places it lists no rate for: $113 a night and $68');
		expect(text).toContain('| $74 | $20 | 2 |'); // Springfield and Gulf Shores
		expect(text).toContain('| Gulf Shores, AL | $190 | July |');
		expect(text).toContain('The year before is not in the repo.');
	});

	it('compares with the year before when it is there', async () => {
		const destinations = await readZipFile(zipSample);
		const rows = toRows(destinations, lunch);
		const before = rows.map((row) => ({ ...row, lodging: row.lodging.map((rate) => rate - 10) }));
		const text = summarize(2027, destinations, rows, lunch, [], before);

		expect(text).toContain('(+');
		expect(text).toContain('Standard lodging: $113, against $103.');
	});
});
