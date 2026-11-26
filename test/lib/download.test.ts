import { describe, expect, it } from 'vitest';
import { cacheName } from '../../src/lib/download.ts';

describe('cacheName', () => {
	it('keeps a link’s file name, decoded, and ignores a query string', () => {
		expect(
			cacheName('https://www.gsa.gov/system/files/FY2027PerDiemZipCode_Validated090126.xlsx'),
		).toBe('FY2027PerDiemZipCode_Validated090126.xlsx');
		expect(cacheName('https://www.gsa.gov/system/files/FY%202025%20MIE%20Breakdown.docx')).toBe(
			'FY 2025 MIE Breakdown.docx',
		);
		expect(cacheName('https://www.gsa.gov/system/files/a.xlsx?download=1#top')).toBe('a.xlsx');
	});

	it('refuses a name that could point outside the cache', () => {
		const refused = [
			'https://www.gsa.gov/system/files/..%2F..%2Fpwned', // encoded slashes
			'https://www.gsa.gov/system/files/%2e%2e%2f%2e%2e%2fpwned',
			'https://www.gsa.gov/system/files/..%5Cpwned', // an encoded backslash
			'https://www.gsa.gov/system/files/a%00.xlsx', // an encoded NUL
			'https://www.gsa.gov/system/files/', // no file name at all
			'https://www.gsa.gov/system/files/%E0%A4%A', // not valid encoding
			'not a link',
		];

		for (const url of refused) {
			expect(() => cacheName(url), url).toThrow(/won't be saved|Refusing to save/);
		}
	});
});
