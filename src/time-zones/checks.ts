import type { CheckResult } from '../flight-history/checks.ts';
import type { Region } from '../lib/geometry.ts';
import { ARIZONA, IANA, type Located, type Placed, type TimeZoneRow, timeZoneAt } from './read.ts';

/**
 * Places that must come out in a known zone. They are chosen for being awkward:
 * a state split in two (Indiana, Michigan's Upper Peninsula), a state on the
 * line (Nevada's one Mountain town, Idaho's Pacific panhandle), a city whose
 * zone surprises people (Pensacola, El Paso), and Arizona. If a boundary file
 * is truncated or shifted, these fail before anything is written.
 */
export const PROBES: readonly {
	name: string;
	state: string;
	lat: number;
	lon: number;
	expect: string;
}[] = [
	{ name: 'New York', state: 'NY', lat: 40.71, lon: -74.0, expect: IANA.Eastern },
	{ name: 'Indianapolis', state: 'IN', lat: 39.77, lon: -86.16, expect: IANA.Eastern },
	{ name: 'Evansville', state: 'IN', lat: 37.97, lon: -87.57, expect: IANA.Central },
	{ name: 'Marquette', state: 'MI', lat: 46.54, lon: -87.4, expect: IANA.Eastern },
	{ name: 'Iron Mountain', state: 'MI', lat: 45.82, lon: -88.07, expect: IANA.Central },
	{ name: 'Chicago', state: 'IL', lat: 41.88, lon: -87.63, expect: IANA.Central },
	{ name: 'Pensacola', state: 'FL', lat: 30.42, lon: -87.22, expect: IANA.Central },
	{ name: 'Miami', state: 'FL', lat: 25.76, lon: -80.19, expect: IANA.Eastern },
	{ name: 'Texarkana', state: 'TX', lat: 33.43, lon: -94.05, expect: IANA.Central },
	{ name: 'El Paso', state: 'TX', lat: 31.76, lon: -106.49, expect: IANA.Mountain },
	{ name: 'Denver', state: 'CO', lat: 39.74, lon: -104.99, expect: IANA.Mountain },
	{ name: 'Rapid City', state: 'SD', lat: 44.08, lon: -103.23, expect: IANA.Mountain },
	{ name: 'Pierre', state: 'SD', lat: 44.37, lon: -100.35, expect: IANA.Central },
	{ name: 'Boise', state: 'ID', lat: 43.62, lon: -116.2, expect: IANA.Mountain },
	{ name: 'Lewiston', state: 'ID', lat: 46.42, lon: -117.02, expect: IANA.Pacific },
	{ name: 'West Wendover', state: 'NV', lat: 40.74, lon: -114.07, expect: IANA.Mountain },
	{ name: 'Elko', state: 'NV', lat: 40.83, lon: -115.76, expect: IANA.Pacific },
	{ name: 'Los Angeles', state: 'CA', lat: 34.05, lon: -118.24, expect: IANA.Pacific },
	{ name: 'Phoenix', state: 'AZ', lat: 33.45, lon: -112.07, expect: ARIZONA },
];

/** The fewest rows each zone should hold, for the 2025 places file (22,833 Central, 21,781 Eastern, 3,853 Mountain, 4,166 Pacific), with plenty of room. */
export const EXPECTED_AT_LEAST = {
	Eastern: 15_000,
	Central: 15_000,
	Mountain: 2_000,
	Pacific: 2_500,
} as const;

/** A row's identity: its kind and its Census id or ZIP code. */
const rowKey = (row: TimeZoneRow): string =>
	`${row.kind}:${row.kind === 'place' ? row.geoid : row.zip}`;

const examples = (rows: readonly Located[]): string =>
	rows
		.slice(0, 5)
		.map((row) => `${row.geoid ?? row.zip} (${row.state} ${row.lat}, ${row.lon})`)
		.join('; ');

/** Runs every check; the job writes nothing unless all pass. */
export function runChecks(
	regions: readonly Region[],
	located: readonly Located[],
	placed: Placed,
): CheckResult[] {
	const keys = placed.rows.map(rowKey);
	const stateOf = new Map(
		located.map((item) => [`${item.kind}:${item.geoid ?? item.zip}`, item.state]),
	);
	const wrong = PROBES.filter(
		(probe) => timeZoneAt(regions, probe.state, probe.lon, probe.lat) !== probe.expect,
	);
	const counts = (zone: string) => placed.rows.filter((row) => row.timeZone === zone).length;
	const short = (Object.entries(EXPECTED_AT_LEAST) as [keyof typeof IANA, number][]).filter(
		([zone, least]) => counts(IANA[zone]) < least,
	);

	return [
		{
			name: 'The boundary file has the four zones of the Lower 48',
			passed: Object.keys(IANA).every((zone) => regions.some((region) => region.name === zone)),
		},
		{
			name: 'Every place and ZIP code area is in exactly one zone',
			passed: placed.unplaced.length === 0,
			detail:
				placed.unplaced.length > 0
					? `${placed.unplaced.length}: ${examples(placed.unplaced)}`
					: undefined,
		},
		{
			name: 'Every place and ZIP code area has one row, with no repeats',
			passed: placed.rows.length === located.length && new Set(keys).size === keys.length,
		},
		{
			name: 'Known cities come out in the right zone',
			passed: wrong.length === 0,
			detail: wrong.length > 0 ? wrong.map((probe) => probe.name).join(', ') : undefined,
		},
		{
			name: 'Each zone holds a plausible number of rows',
			passed: short.length === 0,
			detail: short.length > 0 ? short.map(([zone]) => zone).join(', ') : undefined,
		},
		{
			name: 'Arizona is the only state on Phoenix time, and all of it is',
			passed: placed.rows.every(
				(row) => (row.timeZone === ARIZONA) === (stateOf.get(rowKey(row)) === 'AZ'),
			),
		},
	];
}
