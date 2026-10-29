import { decodeEntities } from '../lib/xml.ts';

/** The GSA downloads this job uses, found on its per diem files page. */
export interface GsaFiles {
	/** The ZIP-code file ("for developers") of each fiscal year on the page, by year. */
	zipFiles: Map<number, string>;

	/** The newest meals breakdown, which splits each meals rate into breakfast, lunch, dinner, and incidentals. */
	mealsTable: string | null;
}

/**
 * Finds the files on GSA's listing page. Their names carry validation dates
 * (`FY2027PerDiemZipCode_Validated090126.xlsx`), so they can't be guessed;
 * the page is the only list. Links can be relative.
 */
export function findFiles(html: string, base: string): GsaFiles {
	const zipFiles = new Map<number, string>();
	let mealsTable: { year: number; url: string } | null = null;

	for (const match of html.matchAll(/href="([^"]+\.(?:xlsx|docx))"/gi)) {
		const url = new URL(decodeEntities(match[1] ?? ''), base).href;
		const name = decodeURIComponent(url.split('/').pop() ?? '');
		const year = Number(/^FY\s*(\d{4})/i.exec(name)?.[1]);

		if (/\.xlsx$/i.test(name) && /zip\s*code/i.test(name) && year && !zipFiles.has(year)) {
			zipFiles.set(year, url);
		}

		if (/\.docx$/i.test(name) && /MIE/i.test(name) && /breakdown/i.test(name) && year) {
			if (!mealsTable || year > mealsTable.year) {
				mealsTable = { year, url };
			}
		}
	}

	return { zipFiles, mealsTable: mealsTable?.url ?? null };
}
