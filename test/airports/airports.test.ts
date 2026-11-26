import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../../src/airports/checks.ts';
import { nextYear, yearsOnHand } from '../../src/airports/index.ts';
import { findEnplanementFiles } from '../../src/airports/links.ts';
import {
	type AirportRow,
	type FaaAirport,
	type Matched,
	matchAirports,
	parseFaa,
	readFaa,
	readOurAirports,
} from '../../src/airports/read.ts';
import { summarize } from '../../src/airports/summary.ts';
import { readCsvFile } from '../../src/lib/csv.ts';
import { formatRows } from '../../src/lib/write.ts';

// faa-sample.xlsx is the FAA's spreadsheet in miniature: ATL and DCA (large),
// TIE (medium), AMB, ZZZ (small), BVU and FHR (commercial service with no hub
// class), plus Anchorage (outside the launch area), a totals row, and a row
// with a four-character code. ourairports-sample.csv is OurAirports' list in
// miniature, with the traps: IATA's BVU is Beluga, Alaska, while the FAA's BVU
// is Boulder City, Nevada; DCA is filed under DC while the FAA says Virginia;
// AMB is in two other states and neither is Texas; TIE has two Texas
// candidates; ZZZ's airport is closed; and Vancouver isn't in the US.
const here = import.meta.dirname;
const faaFile = join(here, 'faa-sample.xlsx');
const oursFile = join(here, 'ourairports-sample.csv');
const page = 'https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger';

describe('findEnplanementFiles', () => {
	it('finds the commercial-service spreadsheet of each year, resolving relative links and short years', () => {
		const html = `
			<a href="/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2025-commercial-service-enplanements.xlsx">2025</a>
			<a href="/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2025-all-enplanements.xlsx">all airports</a>
			<a href="https://www.faa.gov/sites/faa.gov/files/cy24-commercial-service-enplanements.xlsx">2024</a>
			<a href="/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2025-commercial-service-enplanements.pdf">pdf</a>`;

		expect([...findEnplanementFiles(html, page)]).toEqual([
			[
				2025,
				'https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2025-commercial-service-enplanements.xlsx',
			],
			[2024, 'https://www.faa.gov/sites/faa.gov/files/cy24-commercial-service-enplanements.xlsx'],
		]);
	});

	it('finds nothing on a page that has changed', () => {
		expect(findEnplanementFiles('<a href="/other.xlsx">x</a>', page).size).toBe(0);
	});
});

describe('parseFaa', () => {
	it('keeps the Lower 48 and DC airports with real codes, and takes the year from the heading', async () => {
		const { year, airports } = await readFaa(faaFile);

		expect(year).toBe(2025);
		expect(airports.map((airport) => airport.code)).toEqual([
			'ATL',
			'DCA',
			'TIE',
			'AMB',
			'ZZZ',
			'BVU',
			'FHR',
		]);
		expect(airports[0]).toEqual({
			code: 'ATL',
			name: 'Hartsfield/Jackson Atlanta International',
			city: 'Atlanta',
			state: 'GA',
			size: 'large',
			enplanements: 51459786,
		});
	});

	it('turns hub classes into sizes, and a blank hub into small', async () => {
		const { airports } = await readFaa(faaFile);
		const size = (code: string) => airports.find((airport) => airport.code === code)?.size;

		expect([size('ATL'), size('TIE'), size('AMB'), size('ZZZ'), size('BVU'), size('FHR')]).toEqual([
			'large',
			'medium',
			'small',
			'small',
			'small',
			'small',
		]);
	});

	it('says what is missing when the FAA changes its spreadsheet', () => {
		expect(() => parseFaa([{ Locid: 'ATL', ST: 'GA' }])).toThrow(/no "CY nn Enplanements" column/);
		expect(() => parseFaa([{ 'CY 25 Enplanements': '1', Locid: 'ATL' }])).toThrow(
			/no column named "ST", "City", "Airport Name", "Hub"/,
		);
	});
});

describe('readCsvFile and readOurAirports', () => {
	it('reads rows by header name, with quoted commas', async () => {
		const rows: Record<string, string>[] = [];

		for await (const row of readCsvFile(oursFile)) {
			rows.push(row);
		}

		expect(rows).toHaveLength(11);
		expect(rows[5]?.name).toBe('Ambiguous, California Field');
		expect(rows[5]?.iso_country).toBe('US'); // the comma did not shift the columns
	});

	it('keeps US airports that are not closed', async () => {
		const ours = await readOurAirports(oursFile);

		expect(ours.map((airport) => airport.ident)).toEqual([
			'KATL',
			'K61B',
			'PABG',
			'KDCA',
			'KFHR',
			'KAMB',
			'KAM2',
			'TX01',
			'KTIE',
		]); // not the closed field or Vancouver
		expect(ours[1]).toEqual({
			ident: 'K61B',
			type: 'small_airport',
			lat: 35.947201,
			lon: -114.858803,
			region: 'US-NV',
			scheduledService: false,
			iata: 'BLD',
			local: 'BVU',
		});
	});

	it('fails when the file isn’t there', async () => {
		await expect(readOurAirports(join(here, 'nowhere.csv'))).rejects.toThrow();
	});
});

describe('matchAirports', () => {
	const match = async () =>
		matchAirports((await readFaa(faaFile)).airports, await readOurAirports(oursFile));

	it('matches by IATA code, with coordinates to four places, in code order', async () => {
		const { rows } = await match();

		expect(rows.map((row) => row.code)).toEqual(['ATL', 'BVU', 'DCA', 'FHR', 'TIE']);
		expect(rows[0]).toEqual({
			code: 'ATL',
			name: 'Hartsfield/Jackson Atlanta International',
			city: 'Atlanta',
			state: 'GA',
			size: 'large',
			lat: 33.6367,
			lon: -84.4281,
			enplanements: 51459786,
		});
	});

	it('does not put the FAA’s BVU (Boulder City, Nevada) at IATA’s BVU (Beluga, Alaska)', async () => {
		const bvu = (await match()).rows.find((row) => row.code === 'BVU');

		expect(bvu).toMatchObject({
			name: 'Boulder City Municipal',
			state: 'NV',
			lat: 35.9472,
			lon: -114.8588,
		});
	});

	it('uses the FAA’s own identifier when the IATA code is different', async () => {
		expect((await match()).rows.find((row) => row.code === 'FHR')).toMatchObject({
			lat: 48.5219,
			lon: -123.0243,
		}); // IATA says FRD
	});

	it('accepts a match filed under another state when it is the only one, and reports it', async () => {
		const { rows, disagreements } = await match();

		expect(rows.some((row) => row.code === 'DCA')).toBe(true);
		expect(disagreements).toEqual([{ code: 'DCA', faaState: 'VA', ourRegion: 'US-DC' }]);
	});

	it('prefers the candidate with scheduled service when two are in the right state', async () => {
		expect((await match()).rows.find((row) => row.code === 'TIE')).toMatchObject({
			lat: 31.5,
			lon: -97.5,
		});
	});

	it('leaves out an airport it can’t match safely: two wrong-state candidates, or only a closed one', async () => {
		expect((await match()).unmatched.map((airport) => airport.code)).toEqual(['AMB', 'ZZZ']);
	});

	it('writes one row per line, keys in a fixed order', async () => {
		const text = formatRows((await match()).rows);

		expect(text.split('\n')[1]).toBe(
			'{"code":"ATL","name":"Hartsfield/Jackson Atlanta International","city":"Atlanta","state":"GA","size":"large","lat":33.6367,"lon":-84.4281,"enplanements":51459786},',
		);
	});
});

describe('runChecks', () => {
	/** A made-up year that should pass every check: 29 large, 32 medium, 351 small. */
	function full(): { faa: FaaAirport[]; matched: Matched } {
		const big = ['ATL', 'LAX', 'ORD', 'DFW', 'DEN', 'JFK'];
		const codes = [
			...big.map((code) => [code, 'large'] as const),
			...Array.from({ length: 23 }, (_, i) => [`L${String(i).padStart(2, '0')}`, 'large'] as const),
			...Array.from(
				{ length: 32 },
				(_, i) => [`M${String(i).padStart(2, '0')}`, 'medium'] as const,
			),
			...Array.from({ length: 351 }, (_, i) => [String(100 + i), 'small'] as const),
		];
		const faa = codes.map(([code, size]) => ({
			code,
			name: code,
			city: 'Town',
			state: 'TX',
			size,
			enplanements: 1000,
		}));
		const rows: AirportRow[] = faa.map((airport) => ({ ...airport, lat: 40, lon: -100 }));

		return { faa, matched: { rows, unmatched: [], disagreements: [] } };
	}
	const failed = (year: number, faa: FaaAirport[], matched: Matched) =>
		runChecks(year, 2025, faa, matched)
			.filter((check) => !check.passed)
			.map((check) => `${check.name} ${check.detail ?? ''}`);

	it('passes for a full year', () => {
		const { faa, matched } = full();

		expect(failed(2025, faa, matched)).toEqual([]);
	});

	it('catches the wrong year, too few airports, a missing hub, and a doubled code', () => {
		const { faa, matched } = full();

		expect(failed(2024, faa, matched)).toEqual([expect.stringContaining('is for 2025')]);
		expect(failed(2025, faa.slice(100), matched).join('|')).toContain('number of airports');
		expect(
			failed(
				2025,
				faa.map((a) => (a.code === 'ATL' ? { ...a, size: 'medium' as const } : a)),
				matched,
			).join('|'),
		).toContain('big airports');
		expect(failed(2025, [...faa, faa[0] as FaaAirport], matched).join('|')).toContain('twice');
		expect(
			failed(
				2025,
				faa.map((a) => ({ ...a, enplanements: 0 })),
				matched,
			).join('|'),
		).toContain('enplanements');
	});

	it('names the airports it could not match when too many are missing', () => {
		const { faa, matched } = full();
		const lost = faa.slice(-10);

		const result = runChecks(2025, 2025, faa, { ...matched, unmatched: lost }).find(
			(check) => !check.passed,
		);

		expect(result?.name).toContain('matched to coordinates');
		expect(result?.detail).toContain('10 not matched');
	});

	it('allows a few to go unmatched', () => {
		const { faa, matched } = full();

		expect(failed(2025, faa, { ...matched, unmatched: faa.slice(-3) })).toEqual([]);
	});

	it('catches a coordinate outside the Lower 48, such as one in Alaska', () => {
		const { faa, matched } = full();
		const rows = matched.rows.map((row) =>
			row.code === 'DEN' ? { ...row, lat: 61.17, lon: -151.04 } : row,
		);
		const result = runChecks(2025, 2025, faa, { ...matched, rows }).find((check) => !check.passed);

		expect(result?.name).toContain('inside the Lower 48');
		expect(result?.detail).toBe('DEN 61.17, -151.04');
	});
});

describe('years', () => {
	it('offers the year after the newest one on hand, and knows when it is up to date', () => {
		expect(nextYear([], ['2025'])).toEqual({
			next: null,
			note: expect.stringContaining('No years in the repo yet'),
		});
		expect(nextYear(['2024'], ['2025', '2024']).next).toBe('2025');
		expect(nextYear(['2025'], ['2025'])).toEqual({
			next: null,
			note: expect.stringContaining('Up to date: 2025'),
		});
	});

	it('lists only year files, and nothing for a folder that isn’t there', async () => {
		expect(await yearsOnHand(join(here, 'nowhere'))).toEqual([]);
		expect(await yearsOnHand(here)).toEqual([]);
	});
});

describe('summarize', () => {
	it('gives the sizes, the busiest airports, what was left out, the cross-state match, and the comparison', async () => {
		const { airports } = await readFaa(faaFile);
		const matched = matchAirports(airports, await readOurAirports(oursFile));
		const before: AirportRow[] = [
			...matched.rows.filter((row) => row.code !== 'FHR'),
			{ ...(matched.rows[0] as AirportRow), code: 'OLD' },
		];
		const text = summarize(2025, airports, matched, [], before, '2026-10-28');

		expect(text).toContain('## Airports for 2025');
		expect(text).toContain('7 commercial-service airports in the Lower 48 and DC');
		expect(text).toContain('as of 2026-10-28');
		expect(text).toContain('| large | 2 |');
		expect(text).toContain('5 of 7 got coordinates.');
		expect(text).toContain('- AMB Ambiguous Field, Ambiguous, TX');
		expect(text).toContain('- DCA: the FAA says VA, OurAirports says US-DC.');
		expect(text).toContain('Added: FHR. Dropped: OLD.');
	});

	it('says when the year before is not there', async () => {
		const { airports } = await readFaa(faaFile);
		const matched = matchAirports(airports, await readOurAirports(oursFile));

		expect(summarize(2025, airports, matched, [], null, '2026-10-28')).toContain(
			'The year before is not in the repo.',
		);
	});
});
