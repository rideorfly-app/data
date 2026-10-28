import { readZippedCsv } from '../lib/csv.ts';
import { STATE_CODES } from '../lib/states.ts';
import { type Row, readXlsx } from '../lib/xlsx.ts';
import { zipMembers } from '../lib/zip.ts';

/** What the crash file says about one year. */
export interface Deaths {
	/** Deaths by state code (the 50 states and DC). */
	byState: Map<string, number>;

	/** Crashes in the year asked for, in the 50 states and DC. */
	crashes: number;

	/** Crashes dated another year, which a clean file doesn't have. */
	otherYear: number;

	/** Crashes in a place that isn't a state or DC (Puerto Rico, say), left out. */
	elsewhere: number;
}

/**
 * Adds up the deaths in NHTSA's FARS crash file (`accident.csv` in the zip).
 * Each row is one fatal crash; `FATALS` is how many people died in it.
 */
export async function readDeaths(zipPath: string, year: number): Promise<Deaths> {
	const member = (await zipMembers(zipPath)).find((name) => /(^|\/)accident\.csv$/i.test(name));

	if (!member) {
		throw new Error(`${zipPath} has no accident.csv. Did NHTSA change the file?`);
	}

	const deaths: Deaths = { byState: new Map(), crashes: 0, otherYear: 0, elsewhere: 0 };

	for await (const row of readZippedCsv(zipPath, member)) {
		const state = STATE_CODES.get((row.STATENAME ?? '').trim());
		const fatals = Number(row.FATALS);

		if (row.STATENAME === undefined || row.FATALS === undefined || row.YEAR === undefined) {
			throw new Error(
				"NHTSA's accident.csv has no STATENAME, FATALS, or YEAR column. Did it change?",
			);
		}

		if (Number(row.YEAR) !== year) {
			deaths.otherYear++;
		} else if (!state) {
			deaths.elsewhere++;
		} else if (Number.isFinite(fatals)) {
			deaths.crashes++;
			deaths.byState.set(state, (deaths.byState.get(state) ?? 0) + fatals);
		}
	}

	return deaths;
}

/** A state's vehicle miles of travel, in millions, as FHWA's table gives them. */
export interface Miles {
	rural: number;
	urban: number;

	/** FHWA's own total, which should be the rural and urban miles added up. */
	total: number;
}

/** A state's name without a footnote marker, such as the "(2)" in FHWA's "Tennessee (2)". */
const withoutFootnote = (name: string) => name.replace(/\s*\(\d+\)\s*$/, '').trim();

/**
 * Reads FHWA's table VM-2, "Functional System Travel, Annual Vehicle-Miles"
 * (the data is on the workbook's second sheet). The header row names three
 * `TOTAL` columns: the rural total, the urban total, and the grand total.
 */
export function parseMiles(rows: readonly Row[]): Map<string, Miles> {
	const header = rows.find((row) => row.A?.trim().toUpperCase() === 'STATE');
	const totals = Object.entries(header ?? {})
		.filter(([, text]) => text.trim().toUpperCase() === 'TOTAL')
		.map(([column]) => column)
		.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
	const [rural, urban, total] = totals;

	if (!header || totals.length !== 3 || !rural || !urban || !total) {
		throw new Error(
			`FHWA's table VM-2 should have a STATE row with three TOTAL columns, but has ${totals.length}. Did it change?`,
		);
	}

	const miles = new Map<string, Miles>();

	for (const row of rows) {
		const state = STATE_CODES.get(withoutFootnote(row.A ?? ''));

		if (state) {
			miles.set(state, {
				rural: Number(row[rural]),
				urban: Number(row[urban]),
				total: Number(row[total]),
			});
		}
	}

	return miles;
}

/** Reads FHWA's table VM-2 spreadsheet. */
export async function readMiles(path: string): Promise<Map<string, Miles>> {
	return parseMiles(await readXlsx(path, 2));
}

/** One line of the published file: a state's road deaths for a year, and the rate. */
export interface RoadSafetyRow {
	/** The state code, or `US` for the 50 states and DC together. */
	state: string;
	year: number;
	deaths: number;

	/** Vehicle miles of travel, in millions. */
	vehicleMilesMillions: number;

	/** Deaths per 100 million vehicle miles, the way NHTSA reports it. */
	ratePer100MillionMiles: number;
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** The rate from the unrounded numbers, to three places. */
const rate = (deaths: number, miles: number) => round((deaths / miles) * 100, 3);

/**
 * The published rows: `US` first, then each state by code. A state missing from
 * either source is left out, and the checks catch that. The national row adds
 * up the states and DC only, as NHTSA's does.
 */
export function toRows(
	deaths: Deaths,
	miles: ReadonlyMap<string, Miles>,
	year: number,
): RoadSafetyRow[] {
	const states = [...STATE_CODES.values()]
		.sort()
		.filter((state) => deaths.byState.has(state) && miles.has(state))
		.map((state) => {
			const died = deaths.byState.get(state) ?? 0;
			const driven = miles.get(state)?.total ?? Number.NaN;

			return {
				state,
				year,
				deaths: died,
				vehicleMilesMillions: round(driven, 1),
				ratePer100MillionMiles: rate(died, driven),
			};
		});

	const totalDeaths = states.reduce((total, row) => total + row.deaths, 0);
	const totalMiles = states.reduce((total, row) => total + (miles.get(row.state)?.total ?? 0), 0);

	return [
		{
			state: 'US',
			year,
			deaths: totalDeaths,
			vehicleMilesMillions: round(totalMiles, 1),
			ratePer100MillionMiles: rate(totalDeaths, totalMiles),
		},
		...states,
	];
}
