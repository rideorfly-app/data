import { decodeEntities } from './xml.ts';
import { readZippedText } from './zip.ts';

/** One spreadsheet row: the text of each filled cell, keyed by its column letters (`A`, `B`, ... `AA`). */
export type Row = Record<string, string>;

/** The text of every `<t>` in `xml`, joined. Phonetic guides (`<rPh>`) are left out. */
function textOf(xml: string): string {
	let text = '';

	for (const part of xml
		.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
		.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
		text += part[1] ?? '';
	}

	return decodeEntities(text);
}

/** The shared-strings part of a workbook: the text cells point into, in order. */
export function sharedStrings(xml: string): string[] {
	return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((item) => textOf(item[1] ?? ''));
}

/**
 * Turns a worksheet's XML into rows. Text cells are looked up in `strings`;
 * numbers come back as the digits Excel stored (such as `163` or
 * `0.30000000000000004`), so the caller decides how to read them. Empty cells
 * and empty rows are left out.
 */
export function sheetRows(xml: string, strings: readonly string[]): Row[] {
	const rows: Row[] = [];

	for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
		const cells: Row = {};

		for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const attributes = cell[1] ?? '';
			const column = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
			const type = /\bt="([^"]*)"/.exec(attributes)?.[1];
			const inner = cell[2] ?? '';

			if (!column) {
				continue;
			}

			let value: string;

			if (type === 'inlineStr') {
				value = textOf(inner);
			} else {
				const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';

				value = type === 's' ? (strings[Number(raw)] ?? '') : decodeEntities(raw);
			}

			if (value !== '') {
				cells[column] = value;
			}
		}

		if (Object.keys(cells).length > 0) {
			rows.push(cells);
		}
	}

	return rows;
}

/** Reads one worksheet (numbered from 1, in the order the file stores them) of an `.xlsx` file. */
export async function readXlsx(path: string, sheet = 1): Promise<Row[]> {
	const strings = sharedStrings(await readZippedText(path, 'xl/sharedStrings.xml').catch(() => ''));

	return sheetRows(await readZippedText(path, `xl/worksheets/sheet${sheet}.xml`), strings);
}

/**
 * Names the columns from a header row: each later row becomes an object keyed
 * by the header text. Cells with no header are dropped.
 */
export function withHeaders(rows: readonly Row[], headerIndex = 0): Record<string, string>[] {
	const header = rows[headerIndex] ?? {};

	return rows.slice(headerIndex + 1).map((row) =>
		Object.fromEntries(
			Object.entries(row)
				.filter(([column]) => header[column] !== undefined)
				.map(([column, value]) => [header[column] as string, value]),
		),
	);
}
