import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	checkParking,
	checkRental,
	type ParkingRow,
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
		});

		expect(await inspect('2026-10-28', directory)).toEqual({
			problems: [],
			due: ['ATL'],
			counts: '2 airports, 8 rental regions',
		});
	});

	it('names a table that is missing and the checks a table fails', async () => {
		const directory = await folder({ [FILES.parking]: [parking('ATL', { dailyRate: 1400 })] });
		const { problems } = await inspect('2026-10-28', directory);

		expect(problems).toEqual([
			expect.stringContaining('airport-parking.json: Every daily rate is plausible'),
			`${FILES.rental} is missing.`,
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
