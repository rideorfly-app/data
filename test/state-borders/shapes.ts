// Builds tiny shapefiles in memory, following the format's published layout, so the reader is
// tested against bytes it did not make. Also makes made-up state outlines for the checks.

import { BORDER_STATES, type BorderRow } from '../../src/lib/borders.ts';
import type { Point, Ring } from '../../src/lib/shapefile.ts';

/** A `.shp` file holding one polygon record for each list of rings (an empty list is a null shape). */
export function buildShp(records: readonly (readonly Ring[])[]): Buffer {
	const contents = records.map((rings) => {
		if (rings.length === 0) {
			return Buffer.alloc(4); // shape type 0: no shape
		}

		const points = rings.flat();
		const content = Buffer.alloc(44 + rings.length * 4 + points.length * 16);

		content.writeInt32LE(5, 0);
		content.writeInt32LE(rings.length, 36);
		content.writeInt32LE(points.length, 40);

		let first = 0;

		for (const [i, ring] of rings.entries()) {
			content.writeInt32LE(first, 44 + i * 4);
			first += ring.length;
		}

		for (const [i, [x, y]] of points.entries()) {
			content.writeDoubleLE(x, 44 + rings.length * 4 + i * 16);
			content.writeDoubleLE(y, 44 + rings.length * 4 + i * 16 + 8);
		}

		return content;
	});

	const total = 100 + contents.reduce((sum, content) => sum + 8 + content.length, 0);
	const file = Buffer.alloc(total);

	file.writeInt32BE(9994, 0);
	file.writeInt32BE(total / 2, 24);
	file.writeInt32LE(1000, 28);
	file.writeInt32LE(5, 32);

	let at = 100;

	for (const [i, content] of contents.entries()) {
		file.writeInt32BE(i + 1, at);
		file.writeInt32BE(content.length / 2, at + 4);
		content.copy(file, at + 8);
		at += 8 + content.length;
	}

	return file;
}

/** A `.dbf` file with text fields, each as wide as its longest value (at least 2 characters). */
export function buildDbf(rows: readonly Record<string, string>[], deleted: number[] = []): Buffer {
	const names = Object.keys(rows[0] ?? {});
	const widths = names.map((name) => Math.max(2, ...rows.map((row) => (row[name] ?? '').length)));
	const headerLength = 32 + names.length * 32 + 1;
	const recordLength = 1 + widths.reduce((sum, width) => sum + width, 0);
	const file = Buffer.alloc(headerLength + rows.length * recordLength, 0x20);

	file.fill(0, 0, headerLength);
	file[0] = 3;
	file.writeUInt32LE(rows.length, 4);
	file.writeUInt16LE(headerLength, 8);
	file.writeUInt16LE(recordLength, 10);

	for (const [i, name] of names.entries()) {
		file.write(name, 32 + i * 32, 'latin1');
		file[32 + i * 32 + 11] = 'C'.charCodeAt(0);
		file[32 + i * 32 + 16] = widths[i] ?? 0;
	}

	file[headerLength - 1] = 0x0d;

	for (const [r, row] of rows.entries()) {
		let at = headerLength + r * recordLength;

		file[at] = deleted.includes(r) ? 0x2a : 0x20;
		at += 1;

		for (const [i, name] of names.entries()) {
			file.write((row[name] ?? '').padEnd(widths[i] ?? 0), at, 'latin1');
			at += widths[i] ?? 0;
		}
	}

	return file;
}

/** A square drawn clockwise, the way a shapefile draws an outside. */
export const square = (west: number, south: number, size: number): Ring => [
	[west, south],
	[west, south + size],
	[west + size, south + size],
	[west + size, south],
	[west, south],
];

/** The same square drawn counterclockwise, the way a shapefile draws a hole. */
export const hole = (west: number, south: number, size: number): Ring =>
	square(west, south, size).reverse();

/** Where the checker expects well-known cities, so a made-up state can be drawn around one. */
const ANCHORS: Record<string, Point> = {
	CA: [-119.79, 36.74],
	CO: [-104.99, 39.74],
	DC: [-77.0091, 38.8899],
	FL: [-81.38, 28.54],
	GA: [-84.39, 33.75],
	IL: [-87.63, 41.88],
	KY: [-84.5, 38.04],
	MA: [-72.59, 42.1],
	MD: [-77.41, 39.41],
	MI: [-84.56, 42.73],
	MN: [-93.27, 44.98],
	MT: [-108.5, 45.78],
	NV: [-115.14, 36.17],
	NY: [-76.15, 43.05],
	OK: [-97.52, 35.47],
	TX: [-95.37, 29.76],
	UT: [-111.89, 40.76],
	VA: [-77.44, 37.54],
	WA: [-117.43, 47.66],
	WV: [-81.63, 38.35],
};

/**
 * Made-up outlines that pass every check: a box around the anchor city for states that have
 * one, and a small box in a row along the south for the rest.
 */
export function madeUpStates(): BorderRow[] {
	let spare = 0;

	return BORDER_STATES.map((state) => {
		const anchor = ANCHORS[state];
		const ring = anchor
			? square(anchor[0] - 0.3, anchor[1] - 0.3, 0.6)
			: square(-123 + spare++ * 1.2, 24.5, 0.5);

		return {
			state,
			name: `State ${state}`,
			source: 'https://example.test/states.zip',
			polygons: [[ring]],
		};
	});
}
