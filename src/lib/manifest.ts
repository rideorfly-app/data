import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One data file in a release. */
export interface ManifestEntry {
	/** The dataset it belongs to: its folder (`gas-prices`), or its own name for a single-file table (`rental-rates`). */
	dataset: string;

	/** What it covers, from the file's name (`2026-10-26`, `FY2027`); null for a single-file table, which is edited in place. */
	covers: string | null;
	path: string;
	sha256: string;
	rows: number;
	bytes: number;
}

/** The list the app's loader reads to see what a release holds. Its layout is versioned so the loader can tell if it changes. */
export interface Manifest {
	formatVersion: 1;
	release: string;
	datasets: ManifestEntry[];
}

/** A release is named for the day it's cut, with `.2`, `.3` for more on the same day. */
export const RELEASE_NAME = /^\d{4}-\d{2}-\d{2}(\.[2-9]|\.[1-9]\d+)?$/;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

async function describe(
	root: string,
	path: string,
	dataset: string,
	covers: string | null,
): Promise<ManifestEntry> {
	const bytes = await readFile(join(root, path));
	const rows: unknown = JSON.parse(bytes.toString('utf8'));

	if (!Array.isArray(rows)) {
		throw new Error(`${path} isn't a list of rows.`);
	}

	return {
		dataset,
		covers,
		path,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		rows: rows.length,
		bytes: bytes.length,
	};
}

/**
 * Lists every data file under `datasets/` with its checksum and row count.
 * A folder is a dataset with one file per update; a `.json` file beside the
 * folders is a hand-kept table. Anything else is ignored. The same files give
 * the same manifest, entries sorted by dataset and then by what they cover.
 */
export async function buildManifest(root: string, release: string): Promise<Manifest> {
	if (!RELEASE_NAME.test(release)) {
		throw new Error(
			`"${release}" isn't a release name. Use the date, such as 2026-10-14 (or 2026-10-14.2 for a second one that day).`,
		);
	}

	const folder = join(root, 'datasets');
	const entries: ManifestEntry[] = [];

	for (const item of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
		byText(a.name, b.name),
	)) {
		if (item.isDirectory()) {
			for (const name of (await readdir(join(folder, item.name))).sort(byText)) {
				if (name.endsWith('.json')) {
					entries.push(
						await describe(
							root,
							`datasets/${item.name}/${name}`,
							item.name,
							name.slice(0, -'.json'.length),
						),
					);
				}
			}
		} else if (item.name.endsWith('.json')) {
			entries.push(
				await describe(root, `datasets/${item.name}`, item.name.slice(0, -'.json'.length), null),
			);
		}
	}

	return { formatVersion: 1, release, datasets: entries };
}

/** The manifest as text: one file per line, like the data files, so a change shows only the files that changed. */
export function formatManifest(manifest: Manifest): string {
	return `{\n"formatVersion":${manifest.formatVersion},\n"release":${JSON.stringify(manifest.release)},\n"datasets":[\n${manifest.datasets.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n}\n`;
}
