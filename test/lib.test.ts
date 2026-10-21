import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readZippedCsv, splitCsvLine } from '../src/lib/csv.ts';
import { download, exists } from '../src/lib/download.ts';
import { addMonths, monthsBetween, parseMonth } from '../src/lib/months.ts';
import { formatRows } from '../src/lib/write.ts';

// A made-up month of eight flights, with a comma inside a quoted field. See
// on-time-sample.csv for the same rows in plain text.
const sample = join(import.meta.dirname, 'flight-history', 'on-time-sample.zip');

async function readAll(path: string): Promise<Record<string, string>[]> {
	const rows: Record<string, string>[] = [];

	for await (const row of readZippedCsv(path)) {
		rows.push(row);
	}

	return rows;
}

describe('splitCsvLine', () => {
	it('splits plain fields', () => {
		expect(splitCsvLine('a,b,,d')).toEqual(['a', 'b', '', 'd']);
	});

	it('keeps a comma inside quotes', () => {
		expect(splitCsvLine('1,"Dallas, TX",2')).toEqual(['1', 'Dallas, TX', '2']);
	});

	it('reads a doubled quote as one quote', () => {
		expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
	});
});

describe('readZippedCsv', () => {
	it('reads each row as an object keyed by the header', async () => {
		const rows = await readAll(sample);

		expect(rows).toHaveLength(8);
		expect(rows[0]).toMatchObject({
			OriginCityName: 'Aville, TX',
			Origin: 'AAA',
			ArrDelay: '10.00',
		});
		expect(rows[3]?.ArrDelay).toBe('');
	});

	it('fails loudly on a file that is not a zip', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'data-'));
		const bad = join(directory, 'bad.zip');
		await writeFile(bad, 'not a zip');

		await expect(readAll(bad)).rejects.toThrow(/unzip failed/);
		await rm(directory, { recursive: true, force: true });
	});
});

describe('months', () => {
	it('accepts YYYY-MM and rejects everything else', () => {
		expect(parseMonth('2026-08')).toBe('2026-08');
		expect(() => parseMonth('2026-13')).toThrow();
		expect(() => parseMonth('2026-8')).toThrow();
	});

	it('adds months across year ends, forward and back', () => {
		expect(addMonths('2026-12', 1)).toBe('2027-01');
		expect(addMonths('2026-01', -1)).toBe('2025-12');
		expect(addMonths('2026-08', -12)).toBe('2025-08');
	});

	it('lists every month in a range', () => {
		expect(monthsBetween('2025-11', '2026-02')).toEqual([
			'2025-11',
			'2025-12',
			'2026-01',
			'2026-02',
		]);
	});
});

describe('formatRows', () => {
	it('puts one row on each line, in the order the keys were built', () => {
		expect(
			formatRows([
				{ b: 1, a: 2 },
				{ b: 3, a: 4 },
			]),
		).toBe('[\n{"b":1,"a":2},\n{"b":3,"a":4}\n]\n');
	});

	it('gives the same bytes every time', () => {
		const rows = [{ route: 'AAA-BBB', flights: 5 }];

		expect(formatRows(rows)).toBe(formatRows(structuredClone(rows)));
	});
});

describe('download', () => {
	let directory: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'data-'));
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await rm(directory, { recursive: true, force: true });
	});

	it('exists reflects the HEAD response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 404 })),
		);
		expect(await exists('https://example.test/x.zip')).toBe(false);

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 200 })),
		);
		expect(await exists('https://example.test/x.zip')).toBe(true);
	});

	it('saves the file, and does not fetch it again once it is there', async () => {
		const fetchMock = vi.fn(async () => new Response('hello'));
		vi.stubGlobal('fetch', fetchMock);

		const path = join(directory, 'nested', 'x.zip');
		await download('https://example.test/x.zip', path);
		await download('https://example.test/x.zip', path);

		expect(await readFile(path, 'utf8')).toBe('hello');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('leaves nothing behind when the download fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 500 })),
		);
		const path = join(directory, 'x.zip');

		await expect(download('https://example.test/x.zip', path)).rejects.toThrow(/500/);
		await expect(stat(path)).rejects.toThrow();
		await expect(stat(`${path}.part`)).rejects.toThrow();
	});
});
