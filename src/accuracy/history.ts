import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FlightRow } from '../flight-history/aggregate.ts';
import type { Month } from '../lib/months.ts';

/** Every month of flight history, found by month and then by key (`route:AAA-BBB`, `airport:AAA`, or `nation`). */
export type Index = Map<Month, Map<string, FlightRow>>;

export function keyOf(row: FlightRow): string {
	if ('route' in row) {
		return `route:${row.route}`;
	}

	return 'airport' in row ? `airport:${row.airport}` : 'nation';
}

/** Reads every month of flight history in `directory`, oldest first. */
export async function loadIndex(directory: string): Promise<Index> {
	const names = (await readdir(directory).catch(() => []))
		.filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
		.sort();
	const index: Index = new Map();

	for (const name of names) {
		const rows = JSON.parse(await readFile(join(directory, name), 'utf8')) as FlightRow[];

		index.set(name.slice(0, 7), new Map(rows.map((row) => [keyOf(row), row])));
	}

	return index;
}

/**
 * A key's rows from `newest` and earlier, oldest first. Later months are left
 * out on purpose: at the time of the estimate they weren't published yet, and
 * the backtest must not see them.
 */
export function seriesUpTo(index: Index, key: string, newest: Month): FlightRow[] {
	const rows: FlightRow[] = [];

	for (const [month, found] of index) {
		if (month > newest) {
			break;
		}

		const row = found.get(key);

		if (row) {
			rows.push(row);
		}
	}

	return rows;
}
