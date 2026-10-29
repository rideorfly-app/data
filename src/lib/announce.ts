import type { Manifest, ManifestEntry } from './manifest.ts';

/**
 * The newest accuracy report in a release that the release before it did not
 * have, or null. One post per release: a release that carries several new
 * reports (the first, or a catch-up) gets a post for the newest only.
 */
export function newestNewReport(
	manifest: Manifest,
	previous: Manifest | null,
): ManifestEntry | null {
	const before = new Set((previous?.datasets ?? []).map((entry) => entry.path));
	const fresh = manifest.datasets.filter(
		(entry) => entry.dataset === 'accuracy' && entry.covers !== null && !before.has(entry.path),
	);

	return fresh.reduce<ManifestEntry | null>(
		(newest, entry) => (!newest || (entry.covers ?? '') > (newest.covers ?? '') ? entry : newest),
		null,
	);
}
