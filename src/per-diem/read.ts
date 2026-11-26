import { readDocxTables } from '../lib/docx.ts';
import { readXlsx, withHeaders } from '../lib/xlsx.ts';

/** January first: `lodging[month - 1]` is a destination's nightly rate for that month. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const REQUIRED = ['DestinationID', 'Name', 'State', 'ZIP', 'FiscalYear', 'Meals', ...MONTHS];

/** The header spellings the job uses. GSA has changed their case between years (`Zip` in FY2026, `ZIP` in FY2027). */
const SPELLING = new Map([...REQUIRED, 'County'].map((name) => [name.toLowerCase(), name]));

/** A ZIP code and the per diem rates of the destination GSA puts it in. */
export interface Destination {
	zip: string;
	destinationId: number;
	name: string;

	/** Null for the standard rate, which GSA gives no county. */
	county: string | null;
	state: string;
	fiscalYear: number;

	/** Lodging per night in each calendar month, January first. */
	lodging: number[];

	/** The meals and incidentals rate for a full day. */
	meals: number;
}

/**
 * One line of the file this job publishes: a ZIP code and its rates. A ZIP code
 * GSA lists under more than one destination (it spans counties) gets the
 * average of them, each counting equally, because there is no way to know where
 * in the ZIP code a trip starts. Then `name`, `county`, and `state` list each
 * of the destinations, joined with " / ".
 */
export interface PerDiemRow {
	zip: string;

	/** The GSA destinations averaged into this row: one, or more when the ZIP code spans counties. */
	destinationIds: number[];
	name: string;
	county: string | null;
	state: string;

	/** Lodging per night in each calendar month, January first. */
	lodging: number[];

	/** The meals and incidentals rate for a full day. */
	meals: number;

	/** The lunch part of the meals rate, from GSA's breakdown. It stands in for a quick-serve meal. */
	lunch: number;
}

function number(value: string | undefined, what: string, row: Record<string, string>): number {
	const parsed = Number(value);

	if (value === undefined || value === '' || !Number.isFinite(parsed)) {
		throw new Error(
			`GSA's file has "${value}" for ${what} in ZIP ${row.ZIP ?? '?'}, which isn't a number.`,
		);
	}

	return parsed;
}

/**
 * Reads GSA's ZIP-code file: one row per ZIP code and destination, with the
 * lodging rate for each month (October to September) and the meals rate. A ZIP
 * code that spans two counties appears twice, once for each.
 */
export function parseZipFile(raw: readonly Record<string, string>[]): Destination[] {
	const records = raw.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([name, value]) => [SPELLING.get(name.toLowerCase()) ?? name, value]),
		),
	);
	const first = records[0] ?? {};
	const missing = REQUIRED.filter((name) => !(name in first));

	if (missing.length > 0) {
		throw new Error(
			`GSA's ZIP-code file has no column named ${missing.map((name) => `"${name}"`).join(', ')}. Did it change?`,
		);
	}

	return records.map((row) => ({
		zip: row.ZIP ?? '',
		destinationId: number(row.DestinationID, 'DestinationID', row),
		name: row.Name ?? '',
		county: row.County ?? null,
		state: row.State ?? '',
		fiscalYear: number(row.FiscalYear, 'FiscalYear', row),
		lodging: MONTHS.map((month) => number(row[month], `lodging in ${month}`, row)),
		meals: number(row.Meals, 'Meals', row),
	}));
}

/** Reads GSA's ZIP-code spreadsheet. */
export async function readZipFile(path: string): Promise<Destination[]> {
	return parseZipFile(withHeaders(await readXlsx(path)));
}

/**
 * Reads the lunch part of each meals rate out of GSA's breakdown table, which
 * has a row for each meals rate: the total, then breakfast, lunch, dinner, and
 * incidentals. Returns the lunch for each total.
 */
export function mealsTable(rows: readonly string[][]): Map<number, number> {
	const headerAt = rows.findIndex((row) => /M&IE\s*Total/i.test(row[0] ?? ''));
	const lunchColumn = rows[headerAt]?.findIndex((cell) => /^lunch$/i.test(cell)) ?? -1;

	if (headerAt < 0 || lunchColumn < 0) {
		throw new Error(
			'GSA\'s meals breakdown has no "M&IE Total" row with a "Lunch" column. Did it change?',
		);
	}

	const dollars = (cell: string | undefined) => Number(/^\$?\s*([\d.]+)$/.exec(cell ?? '')?.[1]);
	const lunchByTotal = new Map<number, number>();

	for (const row of rows.slice(headerAt + 1)) {
		const total = dollars(row[0]);
		const lunch = dollars(row[lunchColumn]);

		if (Number.isFinite(total) && Number.isFinite(lunch)) {
			lunchByTotal.set(total, lunch);
		}
	}

	if (lunchByTotal.size === 0) {
		throw new Error("GSA's meals breakdown has no rates in it.");
	}

	return lunchByTotal;
}

/** Reads GSA's meals breakdown document. */
export async function readMealsTable(path: string): Promise<Map<number, number>> {
	return mealsTable(await readDocxTables(path));
}

/** Cents, since an average of three rates is not a whole dollar. */
const mean = (values: readonly number[]) =>
	Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;

/** The distinct values, in order, joined for display. */
const joined = (values: readonly string[]) => [...new Set(values)].join(' / ');

/**
 * The lines of the published file, one per ZIP code, in ZIP order. A ZIP code in
 * more than one destination is averaged (see `PerDiemRow`). Run the checks
 * first: a meals rate with no lunch becomes NaN.
 */
export function toRows(
	destinations: readonly Destination[],
	lunchByTotal: ReadonlyMap<number, number>,
): PerDiemRow[] {
	const groups = new Map<string, Destination[]>();

	for (const destination of destinations) {
		const group = groups.get(destination.zip) ?? [];

		group.push(destination);
		groups.set(destination.zip, group);
	}

	return [...groups]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([zip, group]) => {
			const listed = [...group].sort((a, b) => a.destinationId - b.destinationId);
			const counties = listed.flatMap((destination) =>
				destination.county ? [destination.county] : [],
			);

			return {
				zip,
				destinationIds: listed.map((destination) => destination.destinationId),
				name: joined(listed.map((destination) => destination.name)),
				county: counties.length > 0 ? joined(counties) : null,
				state: joined(listed.map((destination) => destination.state)),
				lodging: MONTHS.map((_, month) =>
					mean(listed.map((destination) => destination.lodging[month] ?? Number.NaN)),
				),
				meals: mean(listed.map((destination) => destination.meals)),
				lunch: mean(listed.map((destination) => lunchByTotal.get(destination.meals) ?? Number.NaN)),
			};
		});
}
