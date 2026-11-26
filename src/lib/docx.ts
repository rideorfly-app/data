import { decodeEntities } from './xml.ts';
import { readZippedText } from './zip.ts';

/** The text of each cell of every table in a Word document's XML, row by row. */
export function tableRows(xml: string): string[][] {
	return [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((row) =>
		[...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) => {
			const paragraphs = [...cell[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((paragraph) => {
				let text = '';

				for (const part of paragraph[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
					text += part[1] ?? '';
				}

				return text;
			});

			return decodeEntities(paragraphs.join(' ')).trim();
		}),
	);
}

/** Reads every table in a `.docx` file. */
export async function readDocxTables(path: string): Promise<string[][]> {
	return tableRows(await readZippedText(path, 'word/document.xml'));
}
