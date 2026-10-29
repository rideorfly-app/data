import { LAUNCH_STATES } from '../flight-history/aggregate.ts';
import { readCsvFile } from '../lib/csv.ts';
import { readXlsx, withHeaders } from '../lib/xlsx.ts';

/** The FAA's hub categories, simplified. Nonhub airports, and commercial airports with no hub class, count as small. */
export type Size = 'large' | 'medium' | 'small';

/** One airport in the FAA's enplanement spreadsheet. */
export interface FaaAirport {
	/** The FAA's three-character identifier, which is the IATA code for nearly all of them. */
	code: string;
	name: string;
	city: string;
	state: string;
	size: Size;

	/** Passengers who boarded a plane there in the year. */
	enplanements: number;
}

const SIZE: Record<string, Size> = { L: 'large', M: 'medium' };

/**
 * Reads the FAA's spreadsheet: one row per commercial-service airport, in the
 * 50 states and the territories. Only the Lower 48 and DC are kept. Rows that
 * aren't airports (the totals at the bottom) are skipped. The year is in the
 * column heading, `CY 25 Enplanements`.
 */
export function parseFaa(records: readonly Record<string, string>[]): {
	year: number;
	airports: FaaAirport[];
} {
	const columns = Object.keys(records[0] ?? {})
		.map((name) => ({ name, year: /^CY\s*(\d{2,4})\s*Enplanements$/i.exec(name)?.[1] }))
		.filter((column): column is { name: string; year: string } => column.year !== undefined);
	const newest = columns.sort((a, b) => Number(b.year) - Number(a.year))[0];
	const missing = ['Locid', 'ST', 'City', 'Airport Name', 'Hub'].filter(
		(name) => !(name in (records[0] ?? {})),
	);

	if (!newest || missing.length > 0) {
		throw new Error(
			`The FAA's spreadsheet has no ${!newest ? '"CY nn Enplanements" column' : `column named ${missing.map((name) => `"${name}"`).join(', ')}`}. Did it change?`,
		);
	}

	const airports = records
		.filter((row) => /^[A-Z0-9]{3}$/.test(row.Locid ?? '') && LAUNCH_STATES.has(row.ST ?? ''))
		.map((row) => ({
			code: row.Locid as string,
			name: row['Airport Name'] ?? '',
			city: row.City ?? '',
			state: row.ST as string,
			size: SIZE[row.Hub ?? ''] ?? 'small',
			enplanements: Number(row[newest.name]),
		}));
	const year = Number(newest.year);

	return { year: year < 100 ? 2000 + year : year, airports };
}

/** Reads the FAA's spreadsheet. */
export async function readFaa(path: string): Promise<{ year: number; airports: FaaAirport[] }> {
	return parseFaa(withHeaders(await readXlsx(path)));
}

/** An airport in OurAirports' list, which has the coordinates the FAA's lacks. Public domain. */
export interface OurAirport {
	ident: string;
	type: string;
	lat: number;
	lon: number;

	/** Like `US-NV`. */
	region: string;
	scheduledService: boolean;
	iata: string;

	/** The FAA's identifier, for airports with no IATA code or a different one. */
	local: string;
}

/** Reads OurAirports' list, keeping the US airports that aren't closed. */
export async function readOurAirports(path: string): Promise<OurAirport[]> {
	const airports: OurAirport[] = [];

	for await (const row of readCsvFile(path)) {
		if (row.iso_country === 'US' && row.type !== 'closed') {
			airports.push({
				ident: row.ident ?? '',
				type: row.type ?? '',
				lat: Number(row.latitude_deg),
				lon: Number(row.longitude_deg),
				region: row.iso_region ?? '',
				scheduledService: row.scheduled_service === 'yes',
				iata: row.iata_code ?? '',
				local: row.local_code ?? '',
			});
		}
	}

	return airports;
}

/** One line of the file this job publishes. */
export interface AirportRow {
	code: string;
	name: string;
	city: string;
	state: string;
	size: Size;
	lat: number;
	lon: number;
	enplanements: number;
}

/** What matching the FAA's list to OurAirports found. */
export interface Matched {
	rows: AirportRow[];

	/** Airports that couldn't be matched safely. They are left out, not guessed. */
	unmatched: FaaAirport[];

	/** Matches where OurAirports puts the airport in another state, for a person to look at. */
	disagreements: { code: string; faaState: string; ourRegion: string }[];
}

const TYPE_RANK: Record<string, number> = { large_airport: 0, medium_airport: 1, small_airport: 2 };
/** To four places (about 10 meters). `toFixed` rounds the number as stored, and an exact tie goes away from zero. */
const round4 = (value: number) => Number(value.toFixed(4));

/**
 * Finds each FAA airport's coordinates. The FAA's identifier usually equals the
 * IATA code, but not always, and the two can belong to different airports
 * (the FAA's BVU is Boulder City, Nevada; IATA's BVU is Beluga, Alaska). So a
 * match must be an airport OurAirports has under that code, either way, in the
 * Lower 48 or DC, and preferably in the same state. Of several in the same
 * state, the one with scheduled service wins, then the larger type, then an
 * IATA match. A match in another state is accepted only if it is the only
 * candidate, and is reported; with more than one, there is no match.
 */
export function matchAirports(faa: readonly FaaAirport[], ours: readonly OurAirport[]): Matched {
	const byCode = new Map<string, OurAirport[]>();

	for (const airport of ours) {
		for (const code of new Set([airport.iata, airport.local])) {
			if (code !== '') {
				byCode.set(code, [...(byCode.get(code) ?? []), airport]);
			}
		}
	}

	const result: Matched = { rows: [], unmatched: [], disagreements: [] };

	for (const airport of faa) {
		const inArea = [...new Set(byCode.get(airport.code) ?? [])].filter((candidate) =>
			LAUNCH_STATES.has(candidate.region.replace(/^US-/, '')),
		);
		const sameState = inArea.filter((candidate) => candidate.region === `US-${airport.state}`);
		const best = (sameState.length > 0 ? sameState : inArea).sort(
			(a, b) =>
				Number(b.scheduledService) - Number(a.scheduledService) ||
				(TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) ||
				Number(b.iata === airport.code) - Number(a.iata === airport.code) ||
				(a.ident < b.ident ? -1 : 1),
		);
		const first = best[0];

		// None at all, or several and none of them in the airport's state: no match.
		const ambiguous = sameState.length === 0 ? inArea.length !== 1 : false;

		if (!first || ambiguous) {
			result.unmatched.push(airport);
			continue;
		}

		if (sameState.length === 0) {
			result.disagreements.push({
				code: airport.code,
				faaState: airport.state,
				ourRegion: first.region,
			});
		}

		result.rows.push({
			code: airport.code,
			name: airport.name,
			city: airport.city,
			state: airport.state,
			size: airport.size,
			lat: round4(first.lat),
			lon: round4(first.lon),
			enplanements: airport.enplanements,
		});
	}

	result.rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

	return result;
}
