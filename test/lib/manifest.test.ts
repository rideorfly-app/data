import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest, formatManifest, RELEASE_NAME } from '../../src/lib/manifest.ts';
import { formatRows } from '../../src/lib/write.ts';

/** A repo with two weeks of gas prices, a month of flight history, one hand-kept table, and some files to ignore. */
async function repo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'manifest-'));

	await mkdir(join(root, 'datasets', 'gas-prices'), { recursive: true });
	await mkdir(join(root, 'datasets', 'flight-history'));
	await writeFile(
		join(root, 'datasets', 'gas-prices', '2026-10-26.json'),
		formatRows([{ a: 1 }, { a: 2 }]),
	);
	await writeFile(join(root, 'datasets', 'gas-prices', '2026-10-19.json'), formatRows([{ a: 3 }]));
	await writeFile(join(root, 'datasets', 'gas-prices', 'notes.txt'), 'not data');
	await writeFile(
		join(root, 'datasets', 'flight-history', '2026-08.json'),
		formatRows([{ r: 'ATL-BOS' }]),
	);
	await writeFile(join(root, 'datasets', 'rental-rates.json'), formatRows([{ region: 'midwest' }]));
	await writeFile(join(root, 'datasets', 'README.md'), 'not data');

	return root;
}

describe('buildManifest', () => {
	it('lists each data file by dataset and what it covers, sorted, and ignores everything else', async () => {
		const manifest = await buildManifest(await repo(), '2026-10-14');

		expect(manifest.formatVersion).toBe(1);
		expect(manifest.release).toBe('2026-10-14');
		expect(manifest.datasets.map((e) => [e.dataset, e.covers, e.path, e.rows])).toEqual([
			['flight-history', '2026-08', 'datasets/flight-history/2026-08.json', 1],
			['gas-prices', '2026-10-19', 'datasets/gas-prices/2026-10-19.json', 1],
			['gas-prices', '2026-10-26', 'datasets/gas-prices/2026-10-26.json', 2],
			['rental-rates', null, 'datasets/rental-rates.json', 1],
		]);
	});

	it('records the checksum and size of the exact bytes', async () => {
		const [first] = (await buildManifest(await repo(), '2026-10-14')).datasets;

		// sha256 of formatRows([{ r: 'ATL-BOS' }]), computed outside the code under test.
		expect(first?.sha256).toBe('d4fa1d9e8abe0c32f248d9d0829baed732619b8b95ee3bc6237d51ac5f8b9bca');
		expect(first?.bytes).toBe(Buffer.byteLength('[\n{"r":"ATL-BOS"}\n]\n'));
	});

	it('gives the same manifest for the same files', async () => {
		const root = await repo();

		expect(formatManifest(await buildManifest(root, '2026-10-14'))).toBe(
			formatManifest(await buildManifest(root, '2026-10-14')),
		);
	});

	it('refuses a file that is not a list of rows', async () => {
		const root = await repo();

		await writeFile(join(root, 'datasets', 'rental-rates.json'), '{"region":"midwest"}');
		await expect(buildManifest(root, '2026-10-14')).rejects.toThrow(/isn't a list of rows/);
		await writeFile(join(root, 'datasets', 'rental-rates.json'), 'not json');
		await expect(buildManifest(root, '2026-10-14')).rejects.toThrow();
	});

	it('refuses a release name that is not a date', async () => {
		await expect(buildManifest(await repo(), 'latest')).rejects.toThrow(/isn't a release name/);
	});
});

describe('RELEASE_NAME', () => {
	it('takes a date, or a date with .2 and up for more releases that day', () => {
		for (const ok of ['2026-10-14', '2026-10-14.2', '2026-10-14.9', '2026-10-14.10']) {
			expect(RELEASE_NAME.test(ok), ok).toBe(true);
		}

		for (const bad of [
			'2026-10-14.1',
			'2026-10-14.0',
			'2026-10-14.',
			'2026-10',
			'v1',
			' 2026-10-14',
			'2026-10-14\n',
		]) {
			expect(RELEASE_NAME.test(bad), bad).toBe(false);
		}
	});
});

describe('formatManifest', () => {
	it('writes one file per line inside valid JSON', async () => {
		const text = formatManifest(await buildManifest(await repo(), '2026-10-14'));

		expect(JSON.parse(text).datasets).toHaveLength(4);
		expect(text.split('\n')).toHaveLength(4 + 7);
		const [first] = JSON.parse(text).datasets;

		// The first file is on line 5 (after `{`, the version, the release, and `"datasets":[`), with a comma after it.
		expect(text.split('\n')[4]).toBe(`${JSON.stringify(first)},`);
	});
});
