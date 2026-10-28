/** A point or vertex as `[longitude, latitude]`, the order GeoJSON uses. */
export type Position = readonly [number, number];

/** A polygon is an outer ring followed by any holes, as GeoJSON lays it out. */
export type Polygon = readonly (readonly Position[])[];

/** The latitude band each edge is filed under, in degrees: a lookup only checks the edges in its own band. */
const BAND = 0.1;

type Edge = readonly [number, number, number, number];

/** A named area made of polygons, ready to answer "is this point inside?" quickly. */
export interface Region {
	name: string;
	bounds: readonly [west: number, south: number, east: number, north: number];
	bands: ReadonlyMap<number, readonly Edge[]>;
}

/**
 * Indexes an area for point-in-area tests. A zone like the Central time zone has
 * tens of thousands of boundary points, so each edge is filed by latitude and a
 * test looks only at the edges at its own latitude, not all of them.
 */
export function buildRegion(name: string, polygons: readonly Polygon[]): Region {
	const bands = new Map<number, Edge[]>();
	let west = 180;
	let south = 90;
	let east = -180;
	let north = -90;

	for (const polygon of polygons) {
		for (const ring of polygon) {
			for (let i = 0; i < ring.length - 1; i++) {
				const [x1, y1] = ring[i] as Position;
				const [x2, y2] = ring[i + 1] as Position;

				west = Math.min(west, x1);
				east = Math.max(east, x1);
				south = Math.min(south, y1);
				north = Math.max(north, y1);

				const low = Math.floor(Math.min(y1, y2) / BAND);
				const high = Math.floor(Math.max(y1, y2) / BAND);

				for (let band = low; band <= high; band++) {
					const edges = bands.get(band) ?? [];

					edges.push([x1, y1, x2, y2]);
					bands.set(band, edges);
				}
			}
		}
	}

	return { name, bounds: [west, south, east, north], bands };
}

/**
 * Whether a point is inside the area. Casts a ray east from the point and counts
 * the edges it crosses: an odd count is inside. Holes work without any special
 * handling, since a ray that enters a hole crosses its edge too. A point exactly
 * on a boundary can go either way.
 */
export function contains(region: Region, lon: number, lat: number): boolean {
	const [west, south, east, north] = region.bounds;

	if (lon < west || lon > east || lat < south || lat > north) {
		return false;
	}

	let inside = false;

	for (const [x1, y1, x2, y2] of region.bands.get(Math.floor(lat / BAND)) ?? []) {
		if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) {
			inside = !inside;
		}
	}

	return inside;
}

/** The names of every area that holds the point. Usually one; none means open water, more than one means overlapping areas. */
export function regionsAt(regions: readonly Region[], lon: number, lat: number): string[] {
	return regions.filter((region) => contains(region, lon, lat)).map((region) => region.name);
}
