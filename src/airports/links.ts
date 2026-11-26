import { decodeEntities } from '../lib/xml.ts';

/**
 * Finds the FAA's commercial-service enplanement spreadsheets on its page, by
 * the year in the file name (`arp-cy2025-commercial-service-enplanements.xlsx`;
 * older ones say `cy24`). Links can be relative. Returns the link for each year.
 */
export function findEnplanementFiles(html: string, base: string): Map<number, string> {
	const files = new Map<number, string>();

	for (const match of html.matchAll(/href="([^"]+\.xlsx)"/gi)) {
		const url = new URL(decodeEntities(match[1] ?? ''), base).href;
		const name = decodeURIComponent(url.split('/').pop() ?? '');
		const cy = /cy[-_ ]?(\d{4}|\d{2})\b/i.exec(name)?.[1];

		if (cy && /commercial[-_ ]service[-_ ]enplanements/i.test(name)) {
			const year = cy.length === 2 ? 2000 + Number(cy) : Number(cy);

			if (!files.has(year)) {
				files.set(year, url);
			}
		}
	}

	return files;
}
