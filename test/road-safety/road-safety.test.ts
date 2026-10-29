import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readZippedCsv } from '../../src/lib/csv.ts';
import { STATE_CODES } from '../../src/lib/states.ts';
import { formatRows } from '../../src/lib/write.ts';
import { zipMembers } from '../../src/lib/zip.ts';
import { runChecks } from '../../src/road-safety/checks.ts';
import { farsUrl, milesUrl, nextYear, yearsOnHand } from '../../src/road-safety/index.ts';
import {
	type Deaths,
	type Miles,
	parseMiles,
	readDeaths,
	readMiles,
	toRows,
} from '../../src/road-safety/read.ts';
import { summarize } from '../../src/road-safety/summary.ts';

// fars-sample.zip is NHTSA's download in miniature: an accident.csv with eight
// crashes (three in Alabama, two in Wyoming, one in DC, one in Puerto Rico, and
// one Alabama crash dated 2023) and a person.csv that must not be read.
// vm2-sample.xlsx is FHWA's table VM-2 in miniature: a metadata sheet, then the
// table with "Wyoming (2)" (a footnote marker), Puerto Rico, and a U.S. Total.
const here = import.meta.dirname;
const fars = join(here, 'fars-sample.zip');
const vm2 = join(here, 'vm2-sample.xlsx');

describe('zipMembers and readZippedCsv', () => {
	it('lists the files in a zip, not its folders', async () => {
		expect((await zipMembers(fars)).sort()).toEqual([
			'FARS2024NationalCSV/accident.csv',
			'FARS2024NationalCSV/person.csv',
		]);
	});

	it('reads the one file asked for when a zip holds more than one CSV', async () => {
		const rows: Record<string, string>[] = [];

		for await (const row of readZippedCsv(fars, 'FARS2024NationalCSV/person.csv')) {
			rows.push(row);
		}

		expect(rows).toEqual([{ STATE: '1', STATENAME: 'Alabama' }]);
	});
});

describe('readDeaths', () => {
	it('adds up deaths by state for the year asked for, counting the rest apart', async () => {
		const deaths = await readDeaths(fars, 2024);

		expect(Object.fromEntries(deaths.byState)).toEqual({ AL: 1381, WY: 140, DC: 40 });
		expect(deaths.crashes).toBe(6);
		expect(deaths.otherYear).toBe(1); // the 2023 crash is not added
		expect(deaths.elsewhere).toBe(1); // Puerto Rico
	});

	it('says so when the zip has no accident.csv', async () => {
		await expect(
			readDeaths(join(here, '..', 'gas-prices', 'eia-sample.zip'), 2024),
		).rejects.toThrow(/no accident\.csv/);
	});
});

describe('parseMiles', () => {
	it('reads each state’s miles from the table’s second sheet, ignoring footnote markers and non-states', async () => {
		const miles = await readMiles(vm2);

		expect([...miles.keys()].sort()).toEqual(['AL', 'DC', 'WY']); // Wyoming (2) is Wyoming; Puerto Rico and the U.S. Total are out
		expect(miles.get('AL')).toEqual({ rural: 29230.17126, urban: 43058.44091, total: 72288.61217 });
		expect(miles.get('WY')?.total).toBe(9500);
	});

	it('says so when the table has changed shape', () => {
		expect(() => parseMiles([{ A: 'STATE', I: 'TOTAL' }])).toThrow(
			/three TOTAL columns, but has 1/,
		);
		expect(() => parseMiles([{ A: 'Alabama' }])).toThrow(/three TOTAL columns, but has 0/);
	});
});

describe('toRows', () => {
	it('puts the nation first, then each state by code, with rates to three places', async () => {
		const rows = toRows(await readDeaths(fars, 2024), await readMiles(vm2), 2024);

		expect(rows).toEqual([
			{
				state: 'US',
				year: 2024,
				deaths: 1561,
				vehicleMilesMillions: 85388.6,
				ratePer100MillionMiles: 1.828,
			},
			{
				state: 'AL',
				year: 2024,
				deaths: 1381,
				vehicleMilesMillions: 72288.6,
				ratePer100MillionMiles: 1.91,
			},
			{
				state: 'DC',
				year: 2024,
				deaths: 40,
				vehicleMilesMillions: 3600,
				ratePer100MillionMiles: 1.111,
			},
			{
				state: 'WY',
				year: 2024,
				deaths: 140,
				vehicleMilesMillions: 9500,
				ratePer100MillionMiles: 1.474,
			},
		]);
	});

	it('leaves out a state that is missing from either source', async () => {
		const deaths = await readDeaths(fars, 2024);
		const miles = await readMiles(vm2);

		miles.delete('DC');
		deaths.byState.delete('AL');

		expect(toRows(deaths, miles, 2024).map((row) => row.state)).toEqual(['US', 'WY']);
	});

	it('writes one row per line, keys in a fixed order', async () => {
		const text = formatRows(toRows(await readDeaths(fars, 2024), await readMiles(vm2), 2024));

		expect(text.split('\n')[1]).toBe(
			'{"state":"US","year":2024,"deaths":1561,"vehicleMilesMillions":85388.6,"ratePer100MillionMiles":1.828},',
		);
		expect(text.split('\n')).toHaveLength(4 + 3);
	});
});

describe('runChecks', () => {
	/** A full set of made-up states that should pass every check: 700 deaths over 50,000 million miles each. */
	function full(): { deaths: Deaths; miles: Map<string, Miles> } {
		const deaths: Deaths = { byState: new Map(), crashes: 0, otherYear: 0, elsewhere: 0 };
		const miles = new Map<string, Miles>();

		for (const code of STATE_CODES.values()) {
			deaths.byState.set(code, 700);
			miles.set(code, { rural: 20_000, urban: 30_000, total: 50_000 });
		}

		return { deaths, miles };
	}
	const failed = (deaths: Deaths, miles: Map<string, Miles>) =>
		runChecks(2024, deaths, miles, toRows(deaths, miles, 2024))
			.filter((check) => !check.passed)
			.map((check) => `${check.name} ${check.detail ?? ''}`);

	it('passes for a full year', () => {
		const { deaths, miles } = full();

		expect(failed(deaths, miles)).toEqual([]);
	});

	it('names a state that is missing from a source', () => {
		const { deaths, miles } = full();

		miles.delete('TN');

		expect(failed(deaths, miles)).toEqual([expect.stringContaining('missing: TN')]);
	});

	it('catches crashes from another year', () => {
		const { deaths, miles } = full();

		deaths.otherYear = 12;

		expect(failed(deaths, miles)).toEqual([
			expect.stringContaining('12 crashes are from another year'),
		]);
	});

	it('catches deaths or miles that are far off, naming the state', () => {
		const a = full();

		a.deaths.byState.set('VT', 3);
		expect(failed(a.deaths, a.miles).join('|')).toContain('VT');

		const b = full();

		b.miles.set('NY', { rural: 40, urban: 60, total: 100 }); // miles in billions, say
		expect(failed(b.deaths, b.miles).join('|')).toMatch(/NY/);
	});

	it('catches rural and urban miles that don’t add up to the total', () => {
		const { deaths, miles } = full();

		miles.set('OH', { rural: 20_000, urban: 30_000, total: 52_000 });

		expect(failed(deaths, miles)).toEqual([expect.stringContaining('add up to its total')]);
	});

	it('catches rates that are out of range, for the states and for the nation', () => {
		const { deaths, miles } = full();

		for (const code of miles.keys()) {
			deaths.byState.set(code, 100); // 0.2 deaths per 100 million miles everywhere
		}

		const problems = failed(deaths, miles);

		// 100 deaths a state is also too few for the nation: 5,100 in all.
		expect(problems).toHaveLength(3);
		expect(problems.join('|')).toContain("The nation's deaths are plausible");
		expect(problems.join('|')).toContain("Every state's rate is plausible");
		expect(problems.join('|')).toContain('The national rate is plausible');
	});
});

describe('years and links', () => {
	it('builds the two download links for a year', () => {
		expect(farsUrl(2024)).toBe(
			'https://static.nhtsa.gov/nhtsa/downloads/FARS/2024/National/FARS2024NationalCSV.zip',
		);
		expect(milesUrl(2024)).toBe(
			'https://www.fhwa.dot.gov/policyinformation/statistics/2024/xls/vm2.xlsx',
		);
	});

	it('offers the year after the newest one on hand once both sources have it, and never skips a gap', async () => {
		expect(await nextYear(['2023'], async (year) => year <= 2024)).toEqual({
			next: '2024',
			note: expect.stringContaining('both have 2024'),
		});
		expect(await nextYear(['2024'], async (year) => year <= 2024)).toEqual({
			next: null,
			note: expect.stringContaining('Up to date: 2024'),
		});
		expect(await nextYear([], async () => true)).toEqual({
			next: null,
			note: expect.stringContaining('No years in the repo yet'),
		});
	});

	it('lists only year files, and nothing for a folder that isn’t there', async () => {
		expect(await yearsOnHand(join(here, 'nowhere'))).toEqual([]);
		expect(await yearsOnHand(here)).toEqual([]);
	});
});

describe('summarize', () => {
	it('gives the nation, the highest and lowest states, and the comparison with the year before', async () => {
		const deaths = await readDeaths(fars, 2024);
		const rows = toRows(deaths, await readMiles(vm2), 2024);
		const before = rows.map((row) => ({
			...row,
			year: 2023,
			ratePer100MillionMiles: row.ratePer100MillionMiles + 0.1,
		}));
		const text = summarize(2024, rows, deaths, [], before);

		expect(text).toContain('## Road deaths for 2024');
		expect(text).toContain(
			'**The nation: 1.83 deaths per 100 million vehicle miles** (1,561 deaths over 85,388.6 million miles)',
		);
		expect(text).toContain('2023: 1.93 (1,561 deaths). That is down 0.10.');
		expect(text).toContain('| AL | 1,381 | 72,288.6 | 1.91 |');
		expect(text).toContain('1 crashes in places that are not a state or DC');
	});

	it('says when the year before is not there', async () => {
		const deaths = await readDeaths(fars, 2024);

		expect(summarize(2024, toRows(deaths, await readMiles(vm2), 2024), deaths, [], null)).toContain(
			'The year before is not in the repo.',
		);
	});
});
