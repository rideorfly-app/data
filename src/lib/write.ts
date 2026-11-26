/**
 * Formats rows as a JSON array with one row per line, so a new file reads row
 * by row and a changed one shows only the rows that changed. The same rows
 * always give the same bytes: keys keep the order the job built them in.
 */
export function formatRows(rows: readonly object[]): string {
	return `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`;
}
