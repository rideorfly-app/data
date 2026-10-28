import type { CheckResult } from '../flight-history/checks.ts';
import { STATE_CODES } from '../lib/states.ts';

/** One airport's cheapest daily parking rate, as kept by hand. */
export interface ParkingRow {
	code: string;
	dailyRate: number;
	lot: string;

	/** Whether the lot has a shuttle or train to the terminal; null when not confirmed. */
	shuttle: boolean | null;

	/** How far to trust the rate: an airport page or release, an older one, a news report, or a third-party site. */
	basis: 'official' | 'stale' | 'news' | 'third-party';
	source: string;
	reviewed: string;
	note: string;
}

/** A region's average daily rental rate, as kept by hand. */
export interface RentalRow {
	region: string;
	dailyRate: number;
	basis: 'estimate';
	source: string;
	reviewed: string;
	note: string;
}

/** A mountain pass on a major highway where winter weather slows or closes the road. */
export interface PassRow {
	name: string;
	state: string;
	highway: string;
	lat: number;
	lon: number;
	elevationFeet: number;

	/** USGS's id for the feature the location came from; null when the location was set by hand. */
	gnisId: number | null;
	reviewed: string;
	note: string;
}

export const PASS_KEYS = [
	'name',
	'state',
	'highway',
	'lat',
	'lon',
	'elevationFeet',
	'gnisId',
	'reviewed',
	'note',
] as const;

export const PARKING_KEYS = [
	'code',
	'dailyRate',
	'lot',
	'shuttle',
	'basis',
	'source',
	'reviewed',
	'note',
] as const;
export const RENTAL_KEYS = ['region', 'dailyRate', 'basis', 'source', 'reviewed', 'note'] as const;

/** The engine's gas regions, in EIA's order, which the rental table shares. */
export const RENTAL_REGIONS = [
	'new-england',
	'central-atlantic',
	'lower-atlantic',
	'midwest',
	'gulf-coast',
	'rocky-mountain',
	'west-coast',
	'california',
] as const;

const PARKING_BASES = ['official', 'stale', 'news', 'third-party'];

/** A row older than this many days is due for a new look. */
export const REVIEW_DAYS = 400;

/** Sanity ranges, wide enough for any real figure and tight enough to catch a typo. */
export const EXPECTED = {
	parkingDailyRate: [3, 100],
	rentalDailyRate: [20, 150],

	/** Feet. Passes are chosen for winter closures, so a few sit under 4,000. */
	passElevation: [2500, 14000],
} as const;

/** A real calendar date as `YYYY-MM-DD`: JavaScript reads February 30 as March 2, so it has to round-trip. */
const isDate = (value: unknown): boolean => {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}

	const date = new Date(`${value}T00:00:00Z`);

	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isLink = (value: unknown): boolean =>
	typeof value === 'string' && /^https:\/\/\S+$/.test(value);

const hasKeys = (row: object, keys: readonly string[]): boolean =>
	JSON.stringify(Object.keys(row)) === JSON.stringify(keys);

const inRange = (value: unknown, [low, high]: readonly [number, number]): boolean =>
	typeof value === 'number' && value >= low && value <= high;

/** The keys of rows whose review date is more than `REVIEW_DAYS` before `today`. */
export function staleRows<T extends { reviewed: string }>(
	rows: readonly T[],
	keyOf: (row: T) => string,
	today: string,
): string[] {
	const limit = Date.parse(`${today}T00:00:00Z`) - REVIEW_DAYS * 86_400_000;

	return rows.filter((row) => Date.parse(`${row.reviewed}T00:00:00Z`) < limit).map(keyOf);
}

/** Checks the airport-parking table. Nothing here fetches anything: it only reads the file. */
export function checkParking(rows: readonly ParkingRow[]): CheckResult[] {
	const codes = rows.map((row) => row.code);

	return [
		{
			name: 'Every row has exactly the expected keys, in order',
			passed: rows.every((row) => hasKeys(row, PARKING_KEYS)),
		},
		{
			name: 'Every code is three capital letters, with no repeats, in order',
			passed:
				codes.every((code) => /^[A-Z]{3}$/.test(code)) &&
				new Set(codes).size === codes.length &&
				codes.every((code, i) => i === 0 || (codes[i - 1] ?? '') < code),
		},
		{
			name: `Every daily rate is plausible ($${EXPECTED.parkingDailyRate[0]} to $${EXPECTED.parkingDailyRate[1]})`,
			passed: rows.every((row) => inRange(row.dailyRate, EXPECTED.parkingDailyRate)),
		},
		{
			name: 'Every row names its lot and its basis, and says whether a shuttle is known',
			passed: rows.every(
				(row) =>
					typeof row.lot === 'string' &&
					row.lot !== '' &&
					PARKING_BASES.includes(row.basis) &&
					(row.shuttle === true || row.shuttle === false || row.shuttle === null),
			),
		},
		{
			name: 'Every row has a source link, a real review date, and a note (which may be empty)',
			passed: rows.every(
				(row) => isLink(row.source) && isDate(row.reviewed) && typeof row.note === 'string',
			),
		},
	];
}

/** Checks the rental-rates table: one row for each of the engine's eight regions. */
export function checkRental(rows: readonly RentalRow[]): CheckResult[] {
	return [
		{
			name: 'Every row has exactly the expected keys, in order',
			passed: rows.every((row) => hasKeys(row, RENTAL_KEYS)),
		},
		{
			name: 'There is exactly one row for each of the eight regions, in order',
			passed:
				rows.length === RENTAL_REGIONS.length &&
				rows.every((row, i) => row.region === RENTAL_REGIONS[i]),
		},
		{
			name: `Every daily rate is plausible ($${EXPECTED.rentalDailyRate[0]} to $${EXPECTED.rentalDailyRate[1]})`,
			passed: rows.every((row) => inRange(row.dailyRate, EXPECTED.rentalDailyRate)),
		},
		{
			name: 'Every row is tagged an estimate, with a source link, a real review date, and a note',
			passed: rows.every(
				(row) =>
					row.basis === 'estimate' &&
					isLink(row.source) &&
					isDate(row.reviewed) &&
					typeof row.note === 'string',
			),
		},
	];
}

/** Checks the winter-passes table: sorted by state then name, on a numbered interstate or US highway, inside the Lower 48. */
export function checkPasses(rows: readonly PassRow[]): CheckResult[] {
	const states = new Set<string>(STATE_CODES.values());

	return [
		{
			name: 'Every row has exactly the expected keys, in order',
			passed: rows.every((row) => hasKeys(row, PASS_KEYS)),
		},
		{
			name: 'Every pass has a name and a state, sorted by state then name with no repeats',
			passed:
				rows.every((row) => row.name !== '' && states.has(row.state)) &&
				rows.every(
					(row, i) =>
						i === 0 ||
						`${rows[i - 1]?.state}\u0000${rows[i - 1]?.name}` < `${row.state}\u0000${row.name}`,
				),
		},
		{
			name: 'Every highway is an interstate or US route, such as I-80 or US-26/US-287',
			passed: rows.every((row) => /^(I|US)-\d{1,3}(\/(I|US)-\d{1,3})*$/.test(row.highway)),
		},
		{
			name: 'Every location is inside the Lower 48',
			passed: rows.every(
				(row) =>
					typeof row.lat === 'number' &&
					typeof row.lon === 'number' &&
					row.lat >= 24 &&
					row.lat <= 50 &&
					row.lon >= -125 &&
					row.lon <= -66,
			),
		},
		{
			name: `Every elevation is plausible (${EXPECTED.passElevation[0].toLocaleString('en-US')} to ${EXPECTED.passElevation[1].toLocaleString('en-US')} feet)`,
			passed: rows.every((row) => inRange(row.elevationFeet, EXPECTED.passElevation)),
		},
		{
			name: 'Every row has a USGS id (or null), a real review date, and a note (which may be empty)',
			passed: rows.every(
				(row) =>
					(row.gnisId === null || (Number.isInteger(row.gnisId) && row.gnisId > 0)) &&
					isDate(row.reviewed) &&
					typeof row.note === 'string',
			),
		},
	];
}
