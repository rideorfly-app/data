// A small reader for ESRI shapefiles, enough for Census's boundary files: polygons in the
// `.shp` file and their attributes in the `.dbf` file. Nothing here fetches anything.
// The format is public: https://www.esri.com/content/dam/esrisites/sitecore-archive/Files/Pdfs/library/whitepapers/pdfs/shapefile.pdf

/** A point as [longitude, latitude]. */
export type Point = [number, number];

/** A closed line of points. */
export type Ring = Point[];

/** An outline with any holes in it: the first ring is the outside, the rest are holes. */
export type Polygon = Ring[];

const FILE_CODE = 9994;
const NULL_SHAPE = 0;
const POLYGON = 5;

/**
 * The rings of each record in a `.shp` file, in file order (a record with no shape has no
 * rings). Only polygon files are read; anything else is refused, not guessed at.
 */
export function readRings(shp: Buffer): Ring[][] {
	if (shp.length < 100 || shp.readInt32BE(0) !== FILE_CODE) {
		throw new Error("That isn't a shapefile (the file code is wrong).");
	}

	if (shp.readInt32BE(24) * 2 !== shp.length) {
		throw new Error(
			`The shapefile says it is ${shp.readInt32BE(24) * 2} bytes but has ${shp.length}. Is the download complete?`,
		);
	}

	if (shp.readInt32LE(32) !== POLYGON) {
		throw new Error(`The shapefile holds shape type ${shp.readInt32LE(32)}, not polygons (5).`);
	}

	const records: Ring[][] = [];
	let offset = 100;

	while (offset < shp.length) {
		const length = shp.readInt32BE(offset + 4) * 2;
		const start = offset + 8;
		const end = start + length;

		if (end > shp.length) {
			throw new Error('A shapefile record runs past the end of the file.');
		}

		const type = shp.readInt32LE(start);

		if (type === NULL_SHAPE) {
			records.push([]);
		} else if (type === POLYGON) {
			records.push(readPolygonRecord(shp, start, end));
		} else {
			throw new Error(`A shapefile record has shape type ${type}, not a polygon.`);
		}

		offset = end;
	}

	return records;
}

function readPolygonRecord(shp: Buffer, start: number, end: number): Ring[] {
	// Type (4), bounding box (32), part count (4), point count (4), then the parts and points.
	const parts = shp.readInt32LE(start + 36);
	const points = shp.readInt32LE(start + 40);
	const partsAt = start + 44;
	const pointsAt = partsAt + parts * 4;

	if (parts < 0 || points < 0 || pointsAt + points * 16 > end) {
		throw new Error('A shapefile record has more points than it has room for.');
	}

	const firsts = Array.from({ length: parts }, (_, i) => shp.readInt32LE(partsAt + i * 4));
	const rings: Ring[] = [];

	for (const [i, first] of firsts.entries()) {
		const last = i + 1 < parts ? (firsts[i + 1] ?? points) : points;

		if (first < 0 || last > points || first >= last) {
			throw new Error('A shapefile part points outside its record.');
		}

		const ring: Ring = [];

		for (let p = first; p < last; p++) {
			ring.push([shp.readDoubleLE(pointsAt + p * 16), shp.readDoubleLE(pointsAt + p * 16 + 8)]);
		}

		rings.push(ring);
	}

	return rings;
}

/**
 * The attribute table of a `.dbf` file: one object per record, field names to their text
 * (trimmed). Records line up with the `.shp` records by position.
 */
export function readTable(dbf: Buffer): Record<string, string>[] {
	const count = dbf.readUInt32LE(4);
	const headerLength = dbf.readUInt16LE(8);
	const recordLength = dbf.readUInt16LE(10);
	const fields: { name: string; length: number }[] = [];

	for (let at = 32; at < headerLength - 1 && dbf[at] !== 0x0d; at += 32) {
		const name = dbf.toString('latin1', at, at + 11).split('\0')[0] ?? '';

		fields.push({ name, length: dbf[at + 16] ?? 0 });
	}

	if (headerLength + count * recordLength > dbf.length) {
		throw new Error('The attribute table is shorter than it says. Is the download complete?');
	}

	const rows: Record<string, string>[] = [];

	for (let i = 0; i < count; i++) {
		const row: Record<string, string> = {};
		let at = headerLength + i * recordLength;

		if (dbf[at] === 0x2a) {
			throw new Error('The attribute table has a deleted record, which would shift the shapes.');
		}

		at += 1;

		for (const field of fields) {
			row[field.name] = dbf.toString('latin1', at, at + field.length).trim();
			at += field.length;
		}

		rows.push(row);
	}

	return rows;
}

/** Twice a ring's area by the shoelace formula; positive when the points run counterclockwise. */
export function signedArea(ring: Ring): number {
	let sum = 0;

	for (let i = 0; i + 1 < ring.length; i++) {
		const [x1, y1] = ring[i] as Point;
		const [x2, y2] = ring[i + 1] as Point;

		sum += x1 * y2 - x2 * y1;
	}

	return sum;
}

/** True when the point is inside the ring (the even-odd rule). */
export function inRing(ring: Ring, [x, y]: Point): boolean {
	let inside = false;

	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i] as Point;
		const [xj, yj] = ring[j] as Point;

		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}

	return inside;
}

/**
 * Sorts a record's rings into polygons. A shapefile draws outsides clockwise and holes
 * counterclockwise, so each clockwise ring starts a polygon and each counterclockwise ring is
 * a hole in the polygon that contains it.
 */
export function toPolygons(rings: readonly Ring[]): Polygon[] {
	const polygons: Polygon[] = [];
	const holes: Ring[] = [];

	for (const ring of rings) {
		if (signedArea(ring) < 0) {
			polygons.push([ring]);
		} else {
			holes.push(ring);
		}
	}

	for (const hole of holes) {
		const polygon = polygons.find((candidate) => inRing(candidate[0] as Ring, hole[0] as Point));

		if (!polygon) {
			throw new Error('A hole in a shape has no outline around it.');
		}

		polygon.push(hole);
	}

	return polygons;
}
