import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDocxTables } from '../../src/lib/docx.ts';
import { readXlsx, sharedStrings, withHeaders } from '../../src/lib/xlsx.ts';
import { decodeEntities } from '../../src/lib/xml.ts';
import { readZippedText } from '../../src/lib/zip.ts';

// sample.xlsx has two sheets. The first holds a header row, text with an
// ampersand, rich text with a phonetic guide, an inline string, an empty row, an
// empty cell, a ZIP code kept as text, and character references. sample.docx
// has a paragraph and a table of meals rates.
const xlsx = join(import.meta.dirname, 'sample.xlsx');
const docx = join(import.meta.dirname, 'sample.docx');

describe('decodeEntities', () => {
	it('turns entities and character references back into characters', () => {
		expect(decodeEntities('Fish &amp; Chips &lt;b&gt; &quot;x&quot; &apos;y&apos;')).toBe(
			`Fish & Chips <b> "x" 'y'`,
		);
		expect(decodeEntities('&#233;t&#xE9; &#x1F600;')).toBe('été 😀');
	});

	it('leaves unknown entities alone', () => {
		expect(decodeEntities('&nosuch; &#xZZ;')).toBe('&nosuch; &#xZZ;');
	});
});

describe('readZippedText', () => {
	it('reads a whole part of a zip', async () => {
		expect(await readZippedText(xlsx, 'xl/worksheets/sheet2.xml')).toContain('<v>99</v>');
	});

	it('fails when the part isn’t there', async () => {
		await expect(readZippedText(xlsx, 'nope.xml')).rejects.toThrow(/unzip failed/);
	});
});

describe('sharedStrings', () => {
	it('reads plain, rich, and escaped text, and skips phonetic guides', () => {
		expect(
			sharedStrings(
				`<sst><si><t>a &amp; b</t></si><si><r><t xml:space="preserve">x </t></r><r><t>y</t></r><rPh sb="0" eb="1"><t>zzz</t></rPh></si></sst>`,
			),
		).toEqual(['a & b', 'x y']);
	});
});

describe('readXlsx', () => {
	it('reads rows as the text of each filled cell, by column letter', async () => {
		expect(await readXlsx(xlsx)).toEqual([
			{ A: 'Name', B: 'Count' },
			{ A: 'Fish & Chips', B: '12.5' },
			{ A: 'Rich text', C: 'inline' }, // the rich text joins up, and B is skipped
			{ A: '00501', D: '7' }, // the empty row and the empty cell are gone; leading zeros stay
			{ A: 'été' },
		]);
	});

	it('reads another sheet by number', async () => {
		expect(await readXlsx(xlsx, 2)).toEqual([{ A: '99' }]);
	});

	it('fails when there is no such sheet', async () => {
		await expect(readXlsx(xlsx, 3)).rejects.toThrow(/unzip failed/);
	});
});

describe('withHeaders', () => {
	it('names the cells from the header row and drops cells that have no header', async () => {
		expect(withHeaders(await readXlsx(xlsx))).toEqual([
			{ Name: 'Fish & Chips', Count: '12.5' },
			{ Name: 'Rich text' }, // C and D have no header
			{ Name: '00501' },
			{ Name: 'été' },
		]);
	});

	it('can take the header from a later row', () => {
		expect(withHeaders([{ A: 'title' }, { A: 'x' }, { A: '1' }], 1)).toEqual([{ x: '1' }]);
	});
});

describe('readDocxTables', () => {
	it('reads each row of a table as its cells’ text, with entities decoded and paragraphs joined', async () => {
		expect(await readDocxTables(docx)).toEqual([
			[
				'M&IE Total',
				'Breakfast',
				'Lunch',
				'Dinner',
				'Incidental Expenses',
				'First & Last Day of Travel',
			],
			['$68', '$16', '$19', '$28', '$5', '$51.00'],
			['$74', '$18', '$20', '$31', '$5', '$55.50'],
		]);
	});
});
