import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	checkParking,
	checkPasses,
	checkRental,
	type ParkingRow,
	type PassRow,
	RENTAL_REGIONS,
	type RentalRow,
	staleRows,
} from '../../src/hand-kept/checks.ts';
import job, { FILES, inspect } from '../../src/hand-kept/index.ts';
import { formatRows } from '../../src/lib/write.ts';

const parking = (code: string, over: Partial<ParkingRow> = {}): ParkingRow => ({
	code,
	dailyRate: 14,
	lot: 'Economy',
	shuttle: true,
	basis: 'official',
	source: `https://example.test/${code}`,
	reviewed: '2026-10-28',
	note: '',
	...over,
});

const rental = (region: string, over: Partial<RentalRow> = {}): RentalRow => ({
	region,
	dailyRate: 57,
	basis: 'estimate',
	source: 'https://example.test/rates',
	reviewed: '2026-10-28',
	note: 'A placeholder.',
	...over,
});

const pass = (name: string, over: Partial<PassRow> = {}): PassRow => ({
	name,
	state: 'CO',
	highway: 'I-70',
	lat: 39.53,
	lon: -106.22,
	elevationFeet: 10612,
	gnisId: 183,
	reviewed: '2026-10-28',
	note: '',
	...over,
});

const rentals = RENTAL_REGIONS.map((region) => rental(region));
const failed = (results: { name: string; passed: boolean }[]) =>
	results.filter((result) => !result.passed).map((result) => result.name);

describe('checkParking', () => {
	it('passes for well-formed rows, whether or not a shuttle is known', () => {
		const rows = [
			parking('ATL'),
			parking('BOS', { shuttle: null }),
			parking('DAL', { shuttle: false }),
		];

		expect(failed(checkParking(rows))).toEqual([]);
	});

	it('catches a rate that is a typo ($1,400 for $14.00) or in cents', () => {
		expect(failed(checkParking([parking('ATL', { dailyRate: 1400 })]))).toEqual([
			expect.stringContaining('plausible'),
		]);
		expect(failed(checkParking([parking('ATL', { dailyRate: 0 })]))).toEqual([
			expect.stringContaining('plausible'),
		]);
	});

	it('catches a bad code, a repeat, and rows out of order', () => {
		const message = expect.stringContaining('three capital letters');

		expect(failed(checkParking([parking('atl')]))).toEqual([message]);
		expect(failed(checkParking([parking('ATL'), parking('ATL')]))).toEqual([message]);
		expect(failed(checkParking([parking('BOS'), parking('ATL')]))).toEqual([message]);
	});

	it('catches an unknown basis, a missing lot, and a shuttle that is neither yes, no, nor unknown', () => {
		const message = expect.stringContaining('basis');

		expect(failed(checkParking([parking('ATL', { basis: 'rumor' as never })]))).toEqual([message]);
		expect(failed(checkParking([parking('ATL', { lot: '' })]))).toEqual([message]);
		expect(failed(checkParking([parking('ATL', { shuttle: 'yes' as never })]))).toEqual([message]);
	});

	it('catches a source that isn’t a secure link, a date that doesn’t exist, and a missing note', () => {
		const message = expect.stringContaining('source link');

		expect(failed(checkParking([parking('ATL', { source: 'see the website' })]))).toEqual([
			message,
		]);
		expect(failed(checkParking([parking('ATL', { source: 'http://example.test/a' })]))).toEqual([
			message,
		]);
		expect(failed(checkParking([parking('ATL', { reviewed: '2026-02-30' })]))).toEqual([message]);
		expect(failed(checkParking([parking('ATL', { reviewed: '2026-13-45' })]))).toEqual([message]);
		expect(failed(checkParking([parking('ATL', { note: undefined as never })]))).toEqual([message]);
	});

	it('catches a row with keys in another order or an extra key', () => {
		const shuffled = { ...parking('ATL') };
		const { code, ...rest } = shuffled;

		expect(failed(checkParking([{ ...rest, code } as ParkingRow]))).toEqual([
			expect.stringContaining('expected keys'),
		]);
		expect(failed(checkParking([{ ...parking('ATL'), extra: 1 } as ParkingRow]))).toEqual([
			expect.stringContaining('expected keys'),
		]);
	});
});

describe('checkRental', () => {
	it('passes for the eight regions', () => {
		expect(failed(checkRental(rentals))).toEqual([]);
	});

	it('catches a missing, repeated, unknown, or misordered region', () => {
		const message = expect.stringContaining('eight regions');

		expect(failed(checkRental(rentals.slice(1)))).toEqual([message]);
		expect(failed(checkRental([...rentals.slice(0, 7), rental('midwest')]))).toEqual([message]);
		expect(failed(checkRental([...rentals.slice(0, 7), rental('texas')]))).toEqual([message]);
		expect(failed(checkRental([...rentals].reverse()))).toEqual([message]);
	});

	it('catches an implausible rate and a row not tagged an estimate', () => {
		expect(failed(checkRental(rentals.map((row) => ({ ...row, dailyRate: 5700 }))))).toEqual([
			expect.stringContaining('plausible'),
		]);
		expect(
			failed(checkRental(rentals.map((row) => ({ ...row, basis: 'official' as never })))),
		).toEqual([expect.stringContaining('estimate')]);
	});
});

describe('checkPasses', () => {
	it('passes for well-formed rows, with or without a USGS id', () => {
		const rows = [
			pass('Donner Pass', { state: 'CA', highway: 'I-80' }),
			pass('Vail Pass'),
			pass('Togwotee Pass', { state: 'WY', highway: 'US-26/US-287', gnisId: null }),
		];

		expect(failed(checkPasses(rows))).toEqual([]);
	});

	it('catches a repeat, rows out of order, an unknown state, and a blank name', () => {
		const message = expect.stringContaining('sorted by state then name');

		expect(failed(checkPasses([pass('Vail Pass'), pass('Vail Pass')]))).toEqual([message]);
		expect(failed(checkPasses([pass('Vail Pass'), pass('Berthoud Pass')]))).toEqual([message]);
		expect(failed(checkPasses([pass('Vail Pass', { state: 'XX' })]))).toEqual([message]);
		expect(failed(checkPasses([pass('')]))).toEqual([message]);
	});

	it('wants a numbered interstate or US route', () => {
		const message = expect.stringContaining('interstate or US route');

		expect(failed(checkPasses([pass('Vail Pass', { highway: 'SR-9' })]))).toEqual([message]);
		expect(failed(checkPasses([pass('Vail Pass', { highway: 'I-70 and US-6' })]))).toEqual([
			message,
		]);
		expect(failed(checkPasses([pass('Vail Pass', { highway: '' })]))).toEqual([message]);
	});

	it('catches a location outside the Lower 48, such as latitude and longitude swapped', () => {
		const message = expect.stringContaining('Lower 48');

		expect(failed(checkPasses([pass('Vail Pass', { lat: -106.22, lon: 39.53 })]))).toEqual([
			message,
		]);
		expect(failed(checkPasses([pass('Vail Pass', { lat: 61.1, lon: -149.8 })]))).toEqual([message]);
		expect(failed(checkPasses([pass('Vail Pass', { lon: 10.5 })]))).toEqual([message]);
		expect(failed(checkPasses([pass('Vail Pass', { lon: -130 })]))).toEqual([message]);
	});

	it('catches an elevation in meters, or an impossible one', () => {
		const message = expect.stringContaining('elevation is plausible');

		expect(failed(checkPasses([pass('Vail Pass', { elevationFeet: 1000 })]))).toEqual([message]);
		expect(failed(checkPasses([pass('Vail Pass', { elevationFeet: 106120 })]))).toEqual([message]);
	});

	it('catches a bad USGS id, review date, or note, and keys in another order', () => {
		const message = expect.stringContaining('USGS id');

		expect(failed(checkPasses([pass('Vail Pass', { gnisId: 0 })]))).toEqual([message]);
		expect(failed(checkPasses([pass('Vail Pass', { gnisId: 1.5 })]))).toEqual([message]);
		expect(failed(checkPasses([pass('Vail Pass', { reviewed: 'October' })]))).toEqual([message]);

		const { name, ...rest } = pass('Vail Pass');

		expect(failed(checkPasses([{ ...rest, name } as PassRow]))).toEqual([
			expect.stringContaining('expected keys'),
		]);
	});
});

describe('staleRows', () => {
	it('lists rows reviewed more than 400 days before today', () => {
		const rows = [
			{ code: 'ATL', reviewed: '2025-09-18' }, // 405 days
			{ code: 'BOS', reviewed: '2025-09-23' }, // 400 days: still fresh
			{ code: 'DEN', reviewed: '2026-10-01' },
		];

		expect(staleRows(rows, (row) => row.code, '2026-10-28')).toEqual(['ATL']);
	});
});

describe('inspect and the job', () => {
	async function folder(files: Record<string, object[]>): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), 'hand-kept-'));

		await mkdir(join(directory, 'datasets'));

		for (const [path, rows] of Object.entries(files)) {
			await writeFile(join(directory, path), formatRows(rows));
		}

		return directory;
	}

	it('reports nothing wrong for good tables, and the rows that are due', async () => {
		const directory = await folder({
			[FILES.parking]: [parking('ATL', { reviewed: '2024-01-01' }), parking('BOS')],
			[FILES.rental]: rentals,
			[FILES.passes]: [pass('Vail Pass')],
		});

		expect(await inspect('2026-10-28', directory)).toEqual({
			problems: [],
			due: ['ATL'],
			counts: '2 airports, 8 rental regions, 1 passes',
		});
	});

	it('names a table that is missing and the checks a table fails', async () => {
		const directory = await folder({ [FILES.parking]: [parking('ATL', { dailyRate: 1400 })] });
		const { problems } = await inspect('2026-10-28', directory);

		expect(problems).toEqual([
			expect.stringContaining('airport-parking.json: Every daily rate is plausible'),
			`${FILES.rental} is missing.`,
			`${FILES.passes} is missing.`,
		]);
	});

	it('is not a job that builds a file', async () => {
		await expect(job.build('2026')).rejects.toThrow(/edited by hand/);
	});
});

// The real files are local until the data is committed, so CI doesn't have them.
describe.skipIf(!(await tablesExist()))('the real tables', () => {
	it('pass every check', async () => {
		const { problems } = await inspect(new Date().toISOString().slice(0, 10));

		expect(problems).toEqual([]);
	});
});

async function tablesExist(): Promise<boolean> {
	return access(join(import.meta.dirname, '..', '..', FILES.parking)).then(
		() => true,
		() => false,
	);
}
