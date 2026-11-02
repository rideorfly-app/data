// State outlines for the Lower 48 and DC, from Census's cartographic boundary file. The app
// uses them to split a driving route's miles by state, which weights the road-risk figure.

import {
	inRing,
	type Point,
	type Polygon,
	type Ring,
	readRings,
	readTable,
	toPolygons,
} from './shapefile.ts';
import { STATE_CODES } from './states.ts';

/** One state's outline. A state can be several polygons (islands, or Michigan's two peninsulas). */
export interface BorderRow {
	state: string;
	name: string;

	/** The Census file this came from. */
	source: string;

	/** Each polygon is its outside ring, then any holes. Points are [longitude, latitude]. */
	polygons: Polygon[];
}

/** The places the app covers: the 50 states and DC, without Alaska and Hawaii. */
export const BORDER_STATES: readonly string[] = [...STATE_CODES.values()]
	.filter((code) => code !== 'AK' && code !== 'HI')
	.sort();

/**
 * Four decimal places is about 11 meters, far finer than the generalized outlines themselves.
 * Census gives five decimals, so exact ties are common; `toFixed` sends them away from zero
 * for longitudes (negative) and latitudes alike, where `Math.round` would not.
 */
const round = (value: number): number => Number(value.toFixed(4));

/** Rounds a ring's points and drops repeats the rounding makes; null when too little is left to be a ring. */
function tidy(ring: Ring): Ring | null {
	const points: Ring = [];

	for (const [x, y] of ring) {
		const point: Point = [round(x), round(y)];
		const before = points.at(-1);

		if (!before || before[0] !== point[0] || before[1] !== point[1]) {
			points.push(point);
		}
	}

	return points.length >= 4 ? points : null;
}

/**
 * Builds the rows from a state boundary file's `.shp` and `.dbf`: one per state in
 * `BORDER_STATES`, sorted by code. Throws if one is missing. `dropped` counts rings that
 * rounding shrank to nothing (specks smaller than the precision), so it can be reported.
 */
export function buildBorders(
	shp: Buffer,
	dbf: Buffer,
	source: string,
): { rows: BorderRow[]; dropped: number } {
	const shapes = readRings(shp);
	const table = readTable(dbf);

	if (shapes.length !== table.length) {
		throw new Error(
			`The shapefile has ${shapes.length} shapes but its table has ${table.length} rows.`,
		);
	}

	const rows: BorderRow[] = [];
	let dropped = 0;

	for (const [i, rings] of shapes.entries()) {
		const state = table[i]?.STUSPS ?? '';

		if (!BORDER_STATES.includes(state)) {
			continue;
		}

		const polygons: Polygon[] = [];

		for (const polygon of toPolygons(rings)) {
			const [outside, ...holes] = polygon.map(tidy);

			if (!outside) {
				dropped += polygon.length;
				continue;
			}

			dropped += holes.filter((hole) => hole === null).length;
			polygons.push([outside, ...holes.filter((hole): hole is Ring => hole !== null)]);
		}

		rows.push({ state, name: table[i]?.NAME ?? '', source, polygons });
	}

	rows.sort((a, b) => (a.state < b.state ? -1 : a.state > b.state ? 1 : 0));

	const missing = BORDER_STATES.filter((code) => !rows.some((row) => row.state === code));

	if (missing.length > 0 || rows.length !== BORDER_STATES.length) {
		throw new Error(`The boundary file is missing ${missing.join(', ') || 'states'}.`);
	}

	return { rows, dropped };
}

/** True when the point is inside the state: in one of its polygons and not in a hole. */
export function inState(row: Pick<BorderRow, 'polygons'>, point: Point): boolean {
	return row.polygons.some(
		([outside, ...holes]) =>
			inRing(outside as Ring, point) && !holes.some((hole) => inRing(hole, point)),
	);
}

/**
 * Checks outlines against places whose state is known: how many of the points fall inside the
 * outline of the state they are listed in. Places on the coast can fall just outside a
 * generalized outline, so a few misses are expected. Misses are returned so they can be read.
 */
export function crossCheck(
	rows: readonly BorderRow[],
	places: readonly { name?: string; zip?: string; state: string; lat: number; lon: number }[],
): { checked: number; inside: number; misses: string[] } {
	const byState = new Map(rows.map((row) => [row.state, row]));
	let checked = 0;
	let inside = 0;
	const misses: string[] = [];

	for (const place of places) {
		const row = byState.get(place.state);

		if (!row) {
			continue;
		}

		checked++;

		if (inState(row, [place.lon, place.lat])) {
			inside++;
		} else {
			misses.push(`${place.name ?? place.zip ?? '?'}, ${place.state}`);
		}
	}

	return { checked, inside, misses };
}
