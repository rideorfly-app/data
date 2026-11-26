import { describe, expect, it } from 'vitest';
import { newestNewReport } from '../../src/lib/announce.ts';
import type { Manifest, ManifestEntry } from '../../src/lib/manifest.ts';

const entry = (dataset: string, covers: string | null): ManifestEntry => ({
	dataset,
	covers,
	path: covers ? `datasets/${dataset}/${covers}.json` : `datasets/${dataset}.json`,
	sha256: 'x',
	rows: 1,
	bytes: 1,
});
const manifest = (...entries: ManifestEntry[]): Manifest => ({
	formatVersion: 1,
	release: '2026-10-14',
	datasets: entries,
});

describe('newestNewReport', () => {
	const old = manifest(entry('accuracy', '2025-11'), entry('gas-prices', '2026-10-19'));

	it('finds the report this release has that the one before did not', () => {
		const now = manifest(
			entry('accuracy', '2025-11'),
			entry('accuracy', '2025-12'),
			entry('gas-prices', '2026-10-26'),
		);

		expect(newestNewReport(now, old)?.covers).toBe('2025-12');
	});

	it('picks the newest month when several are new, in any order', () => {
		const now = manifest(
			entry('accuracy', '2025-12'),
			entry('accuracy', '2025-11'),
			entry('accuracy', '2026-01'),
		);

		expect(newestNewReport(now, null)?.covers).toBe('2026-01');
	});

	it('finds nothing when no report is new, however much else is', () => {
		const now = manifest(
			entry('accuracy', '2025-11'),
			entry('gas-prices', '2026-10-26'),
			entry('rental-rates', null),
		);

		expect(newestNewReport(now, old)).toBeNull();
		expect(newestNewReport(manifest(entry('gas-prices', '2026-10-26')), null)).toBeNull();
	});

	it('counts every report as new when there is no earlier release', () => {
		expect(newestNewReport(old, null)?.covers).toBe('2025-11');
	});
});
