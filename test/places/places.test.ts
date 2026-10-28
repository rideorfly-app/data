import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAUNCH_STATES } from '../../src/flight-history/aggregate.ts';
import { readTableFile, readZippedTable } from '../../src/lib/csv.ts';
import { STATE_FIPS } from '../../src/lib/states.ts';
import { formatRows } from '../../src/lib/write.ts';
import { runChecks } from '../../src/places/checks.ts';
import {
	nextYear,
	placesUrl,
	populationUrl,
	yearsOnHand,
	ZIP_COUNTY_URL,
	zipsUrl,
} from '../../src/places/index.ts';
import {
	buildRows,
	type Place,
	type PlaceRow,
	placeName,
	readPlaces,
	readPopulation,
	readZipStates,
	readZips,
	type ZipRow,
} from '../../src/places/read.ts';
import { summarize } from '../../src/places/summary.ts';

// The fixtures are the Census files in miniature. gazetteer-places-2025.zip
// is the 2025 layout (separated by "|"); gazetteer-places-2024.zip is the
// 2024 layout (tabs, padded). Among the places: Washington, DC (flagged
// nonfunctioning, but a city), two "balance" names, an accented name, a CDP,
// an inactive town, a place in Alaska, a leftover "Louisville city" with no
// population, and Gothenburg, Nebraska, which has two ZIP centers almost the
// same distance away. The ZIP-to-county file has a ZIP code across two states,
// a tie in land, and land in no ZIP code area.
const here = import.meta.dirname;
const places2025 = join(here, 'gazetteer-places-2025.zip');
const places2024 = join(here, 'gazetteer-places-2024.zip');
const zips2025 = join(here, 'gazetteer-zcta-2025.zip');
const populationFile = join(here, 'sub-est-sample.csv');
const countyFile = join(here, 'zcta-county-sample.txt');

const load = async () => {
	const population = await readPopulation(populationFile, 2025);

	return buildRows(
		await readPlaces(places2025, population),
		await readZips(zips2025),
		population,
		await readZipStates(countyFile),
	);
};

describe('table readers', () => {
	it('read the separator from the header: "|" in the 2025 files, tabs in the 2024 ones, with padding trimmed', async () => {
		const pipes: Record<string, string>[] = [];
		const tabs: Record<string, string>[] = [];

		for await (const row of readZippedTable(places2025, '*.txt')) {
			pipes.push(row);
		}

		for await (const row of readZippedTable(places2024, '*.txt')) {
			tabs.push(row);
		}

		expect(pipes[0]).toMatchObject({
			USPS: 'AL',
			GEOID: '0100124',
			NAME: 'Abbeville city',
			INTPTLAT: '31.564706',
		});
		expect(tabs[0]).toMatchObject({
			USPS: 'AL',
			GEOID: '0100124',
			NAME: 'Abbeville city',
			INTPTLONG: '-85.259121',
		});
		expect(Object.keys(tabs[0] ?? {}).at(-1)).toBe('INTPTLONG'); // the header's trailing spaces are gone
	});

	it('read a plain file, ignoring a byte order mark', async () => {
		const rows: Record<string, string>[] = [];

		for await (const row of readTableFile(countyFile)) {
			rows.push(row);
		}

		expect(Object.keys(rows[0] ?? {})[0]).toBe('OID_ZCTA5_20');
	});
});

describe('placeName', () => {
	it('drops the ending Census adds for the kind of government', () => {
		const names: [string, string][] = [
			['Abbeville city', 'Abbeville'],
			['Adamsville town', 'Adamsville'],
			['Alden village', 'Alden'],
			['Aliquippa borough', 'Aliquippa'],
			['Bethel Park municipality', 'Bethel Park'],
			['Ranson corporation', 'Ranson'],
			['Lexington-Fayette urban county', 'Lexington-Fayette'],
			['Echols County consolidated government', 'Echols County'],
			['Lynchburg, Moore County metropolitan government', 'Lynchburg, Moore County'],
			['Fredonia (Biscoe) town', 'Fredonia (Biscoe)'],
		];

		for (const [full, plain] of names) {
			expect(placeName(full), full).toBe(plain);
		}
	});

	it('also drops "(balance)", the part of a consolidated city that is not a town of its own', () => {
		expect(placeName('Indianapolis city (balance)')).toBe('Indianapolis');
		expect(placeName('Nashville-Davidson metropolitan government (balance)')).toBe(
			'Nashville-Davidson',
		);
		expect(placeName('Louisville/Jefferson County metro government (balance)')).toBe(
			'Louisville/Jefferson County',
		);
		expect(placeName('Butte-Silver Bow (balance)')).toBe('Butte-Silver Bow');
	});

	it('keeps a name that has no ending', () => {
		expect(placeName('Carson City')).toBe('Carson City');
		expect(placeName('Macon-Bibb County')).toBe('Macon-Bibb County');
		expect(placeName('Princeton')).toBe('Princeton');
	});
});

describe('readPopulation', () => {
	it('reads people by place ID for the year, from places and consolidated cities only', async () => {
		const population = await readPopulation(populationFile, 2025);

		expect(population.size).toBe(10); // not the state or the county, and not Lonely town, which has no estimate
		expect(population.get('0100124')).toBe(2378);
		expect(population.get('1150000')).toBe(693645);
		expect(population.get('1836000')).toBe(910638); // Indianapolis as a whole: its own ID
		expect(population.get('5600100')).toBeUndefined();
	});

	it('says so when the year isn’t in the file', async () => {
		await expect(readPopulation(populationFile, 2031)).rejects.toThrow(
			/no column named "POPESTIMATE2031"/,
		);
	});
});

describe('readPlaces', () => {
	it('keeps the places Census estimates a population for, in the Lower 48 and DC', async () => {
		const places = await readPlaces(places2025, await readPopulation(populationFile, 2025));

		expect(places.map((place) => place.name)).toEqual([
			'Abbeville',
			'Adamsville',
			'Washington', // flagged nonfunctioning, but it is the capital
			'Indianapolis',
			'Louisville/Jefferson County',
			'Carson City',
			'La Cañada Flintridge', // read as UTF-8
			'Gothenburg',
		]);
		// Left out: Abanda (a CDP), Louisville city and Ghost town (no estimate), Anchorage (Alaska), Lonely town (no estimate this year).
		expect(places[0]).toEqual({
			geoid: '0100124',
			name: 'Abbeville',
			state: 'AL',
			lat: 31.564706,
			lon: -85.259121,
		});
	});

	it('reads the 2024 layout the same way', async () => {
		const places = await readPlaces(places2024, new Map([['0100124', 1]]));

		expect(places).toEqual([
			{ geoid: '0100124', name: 'Abbeville', state: 'AL', lat: 31.564706, lon: -85.259121 },
		]);
	});

	it('says so when the Census changes the columns', async () => {
		await expect(readPlaces(zips2025, new Map())).rejects.toThrow(/no column named "USPS", "NAME"/);
	});
});

describe('readZips and readZipStates', () => {
	it('reads each ZIP code area and its center', async () => {
		const zips = await readZips(zips2025);

		expect(zips).toHaveLength(14);
		expect(zips[0]).toEqual({ zip: '36310', lat: 31.5, lon: -85.3 });
	});

	it('puts a ZIP code area in the state where most of its land is, and leaves out other places', async () => {
		const states = await readZipStates(countyFile);

		expect(states.size).toBe(12);
		expect(states.get('36310')).toBe('AL');
		expect(states.get('42223')).toBe('TN'); // 30 of its land in Kentucky and 70 in Tennessee
		expect(states.get('12345')).toBe('NJ'); // a tie: the state code that sorts first
		expect(states.has('00601')).toBe(false); // Puerto Rico
		expect(states.has('99501')).toBe(false); // Alaska
	});

	it('knows the Census code of every state it can use', () => {
		expect(STATE_FIPS.size).toBe(51);
		expect([...LAUNCH_STATES].every((state) => [...STATE_FIPS.values()].includes(state))).toBe(
			true,
		);
	});
});

describe('buildRows', () => {
	it('lists the places by state, then name, then the ZIP codes', async () => {
		const { places, zips } = await load();

		expect(places.map((place) => `${place.state} ${place.name}`)).toEqual([
			'AL Abbeville',
			'AL Adamsville',
			'CA La Cañada Flintridge',
			'DC Washington',
			'IN Indianapolis',
			'KY Louisville/Jefferson County',
			'NE Gothenburg',
			'NV Carson City',
		]);
		expect(zips.map((zip) => zip.zip)).toEqual([
			'07110',
			'12345',
			'20001',
			'35005',
			'36310',
			'40218',
			'42223',
			'46204',
			'69138',
			'69171',
			'89701',
			'91011',
		]);
	});

	it('gives each place the nearest ZIP center in its own state, and its population', async () => {
		const { places } = await load();
		const row = (name: string) => places.find((place) => place.name === name);

		expect(row('Abbeville')).toEqual({
			kind: 'place',
			geoid: '0100124',
			name: 'Abbeville',
			state: 'AL',
			lat: 31.5647,
			lon: -85.2591,
			population: 2378,
			zip: '36310',
		});
		expect(row('Adamsville')?.zip).toBe('35005');
		expect(row('Washington')).toMatchObject({ state: 'DC', population: 693645, zip: '20001' });
		expect(row('Indianapolis')?.population).toBe(901116);
	});

	it('finds the nearest ZIP from the centers as given, not rounded: Gothenburg is nearer 69138 by 0.0000004 of a square degree', async () => {
		// Rounded to four places, the other ZIP code (69171) comes out nearer.
		expect((await load()).places.find((place) => place.name === 'Gothenburg')?.zip).toBe('69138');
	});

	it('rounds coordinates to four places, an exact tie going away from zero', async () => {
		const zip = (await load()).zips.find((row) => row.zip === '07110');

		expect(zip?.lon).toBe(-74.1563); // exactly -74.15625
	});

	it('leaves a state with no ZIP codes without one, and a place with no estimate without a population', async () => {
		const lonely: Place = { geoid: '5600100', name: 'Lonely', state: 'WY', lat: 43, lon: -108 };
		const { places } = buildRows(
			[lonely],
			await readZips(zips2025),
			new Map(),
			await readZipStates(countyFile),
		);

		expect(places[0]).toMatchObject({ zip: '', population: null });
	});

	it('writes one row per line, the same bytes every time', async () => {
		const { places, zips } = await load();
		const text = formatRows([...places, ...zips]);

		expect(text.split('\n')).toHaveLength(8 + 12 + 3);
		expect(text.split('\n')[1]).toBe(
			'{"kind":"place","geoid":"0100124","name":"Abbeville","state":"AL","lat":31.5647,"lon":-85.2591,"population":2378,"zip":"36310"},',
		);
		expect(formatRows([...(await load()).places, ...(await load()).zips])).toBe(text);
	});
});

describe('runChecks', () => {
	/** A made-up year that should pass every check: about 395 places and 680 ZIP codes in each of the 49 states. */
	function full(): { places: PlaceRow[]; zips: ZipRow[] } {
		const places: PlaceRow[] = [];
		const zips: ZipRow[] = [];
		let n = 0;

		for (const state of LAUNCH_STATES) {
			for (let i = 0; i < 395; i++) {
				places.push({
					kind: 'place',
					geoid: `${state}${i}`,
					name: `Town ${i}`,
					state,
					lat: 40,
					lon: -100,
					population: 11_000,
					zip: '12345',
				});
			}

			for (let i = 0; i < 680; i++) {
				zips.push({ kind: 'zip', zip: String(10_000 + n++), state, lat: 40, lon: -100 });
			}
		}

		return { places, zips };
	}
	const failed = (places: PlaceRow[], zips: ZipRow[]) =>
		runChecks(places, zips)
			.filter((check) => !check.passed)
			.map((check) => `${check.name} ${check.detail ?? ''}`);

	it('passes for a full year', () => {
		const { places, zips } = full();

		expect(failed(places, zips)).toEqual([]);
	});

	it('catches too few places, and a place ID that appears twice', () => {
		const { places, zips } = full();

		expect(failed(places.slice(0, 1000), zips).join('|')).toContain(
			'number of incorporated places',
		);
		expect(failed([...places, places[0] as PlaceRow], zips).join('|')).toContain('appears twice');
	});

	it('names a place with no nearest ZIP code, and places with no population', () => {
		const { places, zips } = full();
		const noZip = places.map((place, i) =>
			i === 7 ? { ...place, name: 'Nowhere', zip: '' } : place,
		);

		expect(failed(noZip, zips).join('|')).toContain('Nowhere');

		const noPopulation = places.map((place, i) =>
			i < 300 ? { ...place, population: null } : place,
		); // 1.5%

		expect(failed(noPopulation, zips).join('|')).toMatch(
			/99% of places have a population estimate.*300, such as/,
		);
		expect(
			failed(
				places.map((place, i) => (i < 100 ? { ...place, population: null } : place)),
				zips,
			),
		).toEqual([]); // 0.5%
	});

	it('names a state that has no places', () => {
		const { places, zips } = full();

		expect(
			failed(
				places.filter((place) => place.state !== 'WY'),
				zips,
			).join('|'),
		).toContain('no places in WY');
	});

	it('catches a total population that is far off and a coordinate outside the Lower 48', () => {
		const { places, zips } = full();

		expect(
			failed(
				places.map((place) => ({ ...place, population: 1 })),
				zips,
			).join('|'),
		).toContain('add up to a plausible number');
		expect(
			failed(
				places.map((place, i) =>
					i === 3 ? { ...place, name: 'Anchorage', lat: 61.2, lon: -149.9 } : place,
				),
				zips,
			).join('|'),
		).toContain('Anchorage 61.2, -149.9');
	});
});

describe('years and links', () => {
	it('builds the links for a year', () => {
		expect(placesUrl(2025)).toBe(
			'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip',
		);
		expect(zipsUrl(2025)).toContain('2025_Gaz_zcta_national.zip');
		expect(populationUrl(2025)).toBe(
			'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv',
		);
		expect(ZIP_COUNTY_URL).toContain('rel2020/zcta520/tab20_zcta520_county20_natl.txt');
	});

	it('offers the year after the newest one on hand once Census has it, and never skips a gap', async () => {
		expect(await nextYear(['2025'], async (year) => year <= 2026)).toEqual({
			next: '2026',
			note: expect.stringContaining('Census has 2026'),
		});
		expect(await nextYear(['2025'], async () => false)).toEqual({
			next: null,
			note: expect.stringContaining('Up to date: 2025'),
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
	it('gives the counts, the largest places, and what was left out', async () => {
		const { places, zips } = await load();
		const text = summarize(2025, places, zips, 2, [], null);

		expect(text).toContain('## Places and ZIP codes for 2025');
		expect(text).toContain('8 incorporated places');
		expect(text).toContain('12 ZIP code areas in the Lower 48 and DC');
		expect(text).toContain('2 ZIP code areas whose main state is elsewhere were left out');
		expect(text).toContain('| Indianapolis, IN | 901,116 | 46204 |');
		expect(text).toContain('The year before is not in the repo.');
	});

	it('says which places were added or dropped since the year before', async () => {
		const { places, zips } = await load();
		const before = [
			...places.filter((place) => place.name !== 'Abbeville'),
			{ ...(places[0] as PlaceRow), geoid: '9999999', name: 'Gone', state: 'AL' },
		];
		const text = summarize(2025, places, zips, 0, [], before);

		expect(text).toContain('Added: Abbeville, AL. Dropped: Gone, AL.');
	});
});
