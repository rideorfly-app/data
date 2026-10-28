import { readZippedLines } from './zip.ts';

/**
 * Splits one CSV line into its fields. BTS quotes text fields, which can hold
 * commas ("Dallas, TX"), and doubles a quote inside one.
 */
export function splitCsvLine(line: string): string[] {
	const fields: string[] = [];
	let field = '';
	let quoted = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (quoted) {
			if (char === '"' && line[i + 1] === '"') {
				field += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ',') {
			fields.push(field);
			field = '';
		} else {
			field += char;
		}
	}

	fields.push(field);

	return fields;
}

/**
 * Reads the CSV inside a zip file one row at a time, as an object keyed by the
 * header names. Streams through `unzip`, so a 30 MB download never sits in memory.
 */
export async function* readZippedCsv(zipPath: string): AsyncGenerator<Record<string, string>> {
	let columns: string[] | null = null;

	for await (const line of readZippedLines(zipPath, '*.csv')) {
		if (line === '') {
			continue;
		}

		const fields = splitCsvLine(line);

		if (!columns) {
			columns = fields;
			continue;
		}

		yield Object.fromEntries(columns.map((name, i) => [name, fields[i] ?? '']));
	}
}
