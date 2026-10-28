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

/** One line of the file this job publishes. */
export interface PerDiemRow {
	zip: string;
	destinationId: number;
	name: string;
	county: string | null;
	state: string;
	lodging: number[];
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

/** The lines of the published file, in ZIP order. Run the checks first: a meals rate with no lunch becomes NaN. */
export function toRows(
	destinations: readonly Destination[],
	lunchByTotal: ReadonlyMap<number, number>,
): PerDiemRow[] {
	return destinations
		.map(({ fiscalYear: _year, ...destination }) => ({
			...destination,
			lunch: lunchByTotal.get(destination.meals) ?? Number.NaN,
		}))
		.sort((a, b) => (a.zip < b.zip ? -1 : a.zip > b.zip ? 1 : a.destinationId - b.destinationId));
}
