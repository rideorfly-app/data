import { buildRegion, type Polygon, type Region, regionsAt } from '../lib/geometry.ts';

/** One place or ZIP code area from the places file: only what the time zone needs. */
export interface Located {
	kind: 'place' | 'zip';

	/** Census's place id for a place. */
	geoid?: string;

	/** The ZIP code for a ZIP code area. */
	zip?: string;
	state: string;
	lat: number;
	lon: number;
}

/** One line of the file: a place or ZIP code area and the time zone its center is in. */
export type TimeZoneRow =
	| { kind: 'place'; geoid: string; timeZone: string }
	| { kind: 'zip'; zip: string; timeZone: string };

/** DOT's four zones in the Lower 48 and the standard time zone name each one is. */
export const IANA = {
	Eastern: 'America/New_York',
	Central: 'America/Chicago',
	Mountain: 'America/Denver',
	Pacific: 'America/Los_Angeles',
} as const;

/** Arizona stays on standard time all year, the one state in the Lower 48 that does (apart from the Navajo Nation). */
export const ARIZONA = 'America/Phoenix';

interface Feature {
	properties?: { zone?: unknown };
	geometry?: { type?: string; coordinates?: unknown };
}

/** Reads DOT's time-zone boundaries (GeoJSON) into areas named by zone. */
export function parseZones(text: string): Region[] {
	const collection = JSON.parse(text) as { type?: string; features?: Feature[] };

	if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
		throw new Error("The time-zone file isn't a GeoJSON feature collection.");
	}

	return collection.features.map((feature, i) => {
		const name = feature.properties?.zone;
		const geometry = feature.geometry;

		if (typeof name !== 'string' || name === '') {
			throw new Error(`Time zone feature ${i + 1} has no zone name.`);
		}

		if (geometry?.type === 'Polygon') {
			return buildRegion(name, [geometry.coordinates as Polygon]);
		}

		if (geometry?.type === 'MultiPolygon') {
			return buildRegion(name, geometry.coordinates as Polygon[]);
		}

		throw new Error(`The ${name} time zone has no polygon shape.`);
	});
}

/**
 * The time zone name for a point, or null when no zone holds it or more than one
 * does (the file's job is to say which, so either is a problem for the checks).
 */
export function timeZoneAt(
	regions: readonly Region[],
	state: string,
	lon: number,
	lat: number,
): string | null {
	const [zone, ...others] = regionsAt(regions, lon, lat);
	const name = zone ? (IANA as Readonly<Record<string, string>>)[zone] : undefined;

	if (!name || others.length > 0) {
		return null;
	}

	return state === 'AZ' && name === IANA.Mountain ? ARIZONA : name;
}

/** Problems found while placing rows, kept so the checks can name them. */
export interface Placed {
	rows: TimeZoneRow[];

	/** Rows no zone (or an unknown one) holds, or more than one holds. */
	unplaced: Located[];
}

/** Finds the time zone of every place and ZIP code area, in the places file's order. */
export function placeRows(regions: readonly Region[], located: readonly Located[]): Placed {
	const rows: TimeZoneRow[] = [];
	const unplaced: Located[] = [];

	for (const item of located) {
		const timeZone = timeZoneAt(regions, item.state, item.lon, item.lat);

		if (!timeZone) {
			unplaced.push(item);
		} else if (item.kind === 'place' && item.geoid !== undefined) {
			rows.push({ kind: 'place', geoid: item.geoid, timeZone });
		} else if (item.kind === 'zip' && item.zip !== undefined) {
			rows.push({ kind: 'zip', zip: item.zip, timeZone });
		} else {
			unplaced.push(item);
		}
	}

	return { rows, unplaced };
}
