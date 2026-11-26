import { LAUNCH_STATES } from '../flight-history/aggregate.ts';
import { readCsvFile, readTableFile, readZippedTable } from '../lib/csv.ts';
import { STATE_FIPS } from '../lib/states.ts';

/** An incorporated place: a city, town, village, or borough, or a consolidated city. */
export interface Place {
	/** Census's seven-digit place ID (two for the state, five for the place). Unique, unlike names. */
	geoid: string;
	name: string;
	state: string;
	lat: number;
	lon: number;
}

/** A ZIP code area (Census calls it a ZCTA) and its center. */
export interface Zip {
	zip: string;
	lat: number;
	lon: number;
}

/**
 * The words Census adds to a place's name for its kind of government
 * ("Abbeville city", "Lexington-Fayette urban county"), longest first so
 * "metropolitan government" is tried before "government"-like shorter ones. A
 * name with none ("Carson City", "Macon-Bibb County") is kept whole.
 */
const ENDINGS = [
	' consolidated government',
	' metropolitan government',
	' unified government',
	' metro government',
	' urban county',
	' municipality',
	' corporation',
	' borough',
	' village',
	' town',
	' city',
];

/**
 * A place's name without Census's ending: "Abbeville city" becomes "Abbeville",
 * and "Indianapolis city (balance)" becomes "Indianapolis". "(balance)" marks
 * the part of a consolidated city that is not a separate town of its own.
 */
export function placeName(full: string): string {
	const name = full.replace(/ \(balance\)$/, '');
	const ending = ENDINGS.find((suffix) => name.endsWith(suffix));

	return ending ? name.slice(0, -ending.length) : name;
}

const GAZETTEER = ['USPS', 'GEOID', 'NAME', 'INTPTLAT', 'INTPTLONG'];

function requireColumns(
	row: Record<string, string> | undefined,
	names: readonly string[],
	what: string,
): void {
	const missing = names.filter((name) => !(name in (row ?? {})));

	if (missing.length > 0) {
		throw new Error(
			`The Census ${what} has no column named ${missing.map((name) => `"${name}"`).join(', ')}. Did it change?`,
		);
	}
}

/**
 * Reads Census's Gazetteer of places, keeping the incorporated ones in the
 * Lower 48 and DC. "Incorporated" here means Census publishes a population
 * estimate for the place: its list covers cities, towns, villages, boroughs,
 * and consolidated cities such as Indianapolis and Nashville, and Washington,
 * DC, none of which a flag like "active government" gets all of. It leaves out
 * the unincorporated communities Census calls "CDPs" and the inactive places.
 */
export async function readPlaces(
	zipPath: string,
	population: ReadonlyMap<string, number>,
): Promise<Place[]> {
	const places: Place[] = [];
	let first = true;

	for await (const row of readZippedTable(zipPath, '*.txt')) {
		if (first) {
			requireColumns(row, GAZETTEER, 'places Gazetteer');
			first = false;
		}

		if (population.has(row.GEOID ?? '') && LAUNCH_STATES.has(row.USPS ?? '')) {
			places.push({
				geoid: row.GEOID ?? '',
				name: placeName(row.NAME ?? ''),
				state: row.USPS ?? '',
				lat: Number(row.INTPTLAT),
				lon: Number(row.INTPTLONG),
			});
		}
	}

	return places;
}

/** Reads Census's Gazetteer of ZIP code areas: each one's code and center. */
export async function readZips(zipPath: string): Promise<Zip[]> {
	const zips: Zip[] = [];
	let first = true;

	for await (const row of readZippedTable(zipPath, '*.txt')) {
		if (first) {
			requireColumns(row, ['GEOID', 'INTPTLAT', 'INTPTLONG'], 'ZIP code Gazetteer');
			first = false;
		}

		zips.push({ zip: row.GEOID ?? '', lat: Number(row.INTPTLAT), lon: Number(row.INTPTLONG) });
	}

	return zips;
}

/**
 * Reads Census's population estimates for cities and towns: people by place
 * ID for the year. Summary level 162 is an incorporated place and 170 a
 * consolidated city; the rest (counties, townships) are skipped.
 */
export async function readPopulation(path: string, year: number): Promise<Map<string, number>> {
	const population = new Map<string, number>();
	const column = `POPESTIMATE${year}`;
	let first = true;

	for await (const row of readCsvFile(path)) {
		if (first) {
			requireColumns(row, ['SUMLEV', 'STATE', 'PLACE', column], 'population estimates file');
			first = false;
		}

		// A blank is no estimate, not zero people.
		const people = (row[column] ?? '') === '' ? Number.NaN : Number(row[column]);

		if (
			(row.SUMLEV === '162' || row.SUMLEV === '170') &&
			row.PLACE !== '00000' &&
			Number.isFinite(people)
		) {
			population.set(
				`${(row.STATE ?? '').padStart(2, '0')}${(row.PLACE ?? '').padStart(5, '0')}`,
				people,
			);
		}
	}

	return population;
}

/**
 * Reads Census's ZIP-code-to-county file to say which state each ZIP code area
 * is in: the state where most of its land lies. Gazetteer ZIP areas have no
 * state. Areas whose main state isn't in the Lower 48 or DC are left out.
 */
export async function readZipStates(path: string): Promise<Map<string, string>> {
	const area = new Map<string, Map<string, number>>();
	let first = true;

	for await (const row of readTableFile(path)) {
		if (first) {
			requireColumns(
				row,
				['GEOID_ZCTA5_20', 'GEOID_COUNTY_20', 'AREALAND_PART'],
				'ZIP-to-county file',
			);
			first = false;
		}

		const zip = row.GEOID_ZCTA5_20;
		const state = STATE_FIPS.get((row.GEOID_COUNTY_20 ?? '').slice(0, 2)) ?? '(other)';

		if (zip) {
			const states = area.get(zip) ?? new Map<string, number>();

			states.set(state, (states.get(state) ?? 0) + Number(row.AREALAND_PART));
			area.set(zip, states);
		}
	}

	const states = new Map<string, string>();

	for (const [zip, shares] of area) {
		const [main] = [...shares].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));

		if (main && LAUNCH_STATES.has(main[0])) {
			states.set(zip, main[0]);
		}
	}

	return states;
}

/** One place line of the published file. */
export interface PlaceRow {
	kind: 'place';
	geoid: string;
	name: string;
	state: string;
	lat: number;
	lon: number;

	/** People living there, from Census's estimate for the year; null if it has none. */
	population: number | null;

	/** The ZIP code area, in the same state, whose center is nearest. It stands in for the city when the app looks up hotel and meal rates. */
	zip: string;
}

/** One ZIP code line of the published file. */
export interface ZipRow {
	kind: 'zip';
	zip: string;
	state: string;
	lat: number;
	lon: number;
}

/** To four places (about 10 meters). `toFixed` rounds the number as stored, and an exact tie goes away from zero. */
const round4 = (value: number) => Number(value.toFixed(4));

/**
 * The ZIP center nearest a point: flat-earth distance, which is plenty over a
 * few miles. It works from the centers as Census gives them, not rounded, since
 * two ZIP codes can be almost the same distance away and rounding to ten meters
 * can change which is nearer. A tie goes to the lower ZIP code.
 */
function nearest(lat: number, lon: number, zips: readonly Zip[]): Zip | undefined {
	const scale = Math.cos((lat * Math.PI) / 180);
	let best: Zip | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const zip of zips) {
		const distance = (zip.lat - lat) ** 2 + ((zip.lon - lon) * scale) ** 2;

		if (distance < bestDistance || (distance === bestDistance && best && zip.zip < best.zip)) {
			best = zip;
			bestDistance = distance;
		}
	}

	return best;
}

/**
 * The published rows: every place (by state, then name, then ID), then every
 * ZIP code area in the Lower 48 and DC (by code). Each place gets the nearest
 * ZIP center in its own state, so a city on a border isn't paired with a ZIP
 * code across it.
 */
export function buildRows(
	places: readonly Place[],
	zips: readonly Zip[],
	population: ReadonlyMap<string, number>,
	zipStates: ReadonlyMap<string, string>,
): { places: PlaceRow[]; zips: ZipRow[] } {
	const inArea = zips
		.filter((zip) => zipStates.has(zip.zip))
		.sort((a, b) => (a.zip < b.zip ? -1 : a.zip > b.zip ? 1 : 0));
	const zipRows: ZipRow[] = inArea.map((zip) => ({
		kind: 'zip' as const,
		zip: zip.zip,
		state: zipStates.get(zip.zip) ?? '',
		lat: round4(zip.lat),
		lon: round4(zip.lon),
	}));
	const byState = new Map<string, Zip[]>();

	for (const zip of inArea) {
		const state = zipStates.get(zip.zip) ?? '';

		byState.set(state, [...(byState.get(state) ?? []), zip]);
	}

	const placeRows: PlaceRow[] = places
		.map((place) => ({
			kind: 'place' as const,
			geoid: place.geoid,
			name: place.name,
			state: place.state,
			lat: round4(place.lat),
			lon: round4(place.lon),
			population: population.get(place.geoid) ?? null,
			zip: nearest(place.lat, place.lon, byState.get(place.state) ?? [])?.zip ?? '',
		}))
		.sort((a, b) =>
			a.state < b.state
				? -1
				: a.state > b.state
					? 1
					: a.name < b.name
						? -1
						: a.name > b.name
							? 1
							: a.geoid < b.geoid
								? -1
								: 1,
		);

	return { places: placeRows, zips: zipRows };
}
