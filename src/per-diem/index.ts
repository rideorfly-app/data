import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { download } from '../lib/download.ts';
import type { Build, Job } from '../lib/job.ts';
import { formatRows } from '../lib/write.ts';
import { runChecks } from './checks.ts';
import { findFiles, type GsaFiles } from './links.ts';
import { type PerDiemRow, readMealsTable, readZipFile, toRows } from './read.ts';
import { summarize } from './summary.ts';

const root = join(import.meta.dirname, '..', '..');
const folder = 'datasets/per-diem';

/** GSA's page of per diem downloads. Its file names carry dates, so the page is the only way to find them. */
export const LISTING_URL = 'https://www.gsa.gov/travel/plan-a-trip/per-diem-rates/per-diem-files';

/** The fiscal years already in the repo, oldest first, as `FY2027`. */
export async function yearsOnHand(directory = join(root, folder)): Promise<string[]> {
	const names = await readdir(directory).catch(() => []);

	return names
		.filter((name) => /^FY\d{4}\.json$/.test(name))
		.map((name) => name.slice(0, 6))
		.sort();
}

/**
 * The first fiscal year GSA has that the repo doesn't, after the newest one on
 * hand. They come one at a time, so a gap in the repo is never skipped over.
 */
export function nextYear(
	have: readonly string[],
	available: readonly string[],
): { next: string | null; note: string } {
	const newest = have.at(-1);

	if (!newest) {
		return { next: null, note: 'No years in the repo yet. Make one with --update FY2027.' };
	}

	const next = [...available].sort().find((year) => year > newest);

	return next
		? { next, note: `GSA has ${next}.` }
		: { next: null, note: `Up to date: ${newest} is the newest year GSA has.` };
}

async function listing(): Promise<GsaFiles> {
	const response = await fetch(LISTING_URL);

	if (!response.ok) {
		throw new Error(
			`Couldn't read GSA's per diem files page: ${response.status} ${response.statusText}`,
		);
	}

	return findFiles(await response.text(), LISTING_URL);
}

/** A GSA file, kept in `.cache/` under its own name so a reissued file (new validation date) is fetched again. */
const fetchFile = (url: string) =>
	download(
		url,
		join(root, '.cache', 'per-diem', decodeURIComponent(url.split('/').pop() ?? 'file')),
	);

/** A year already in the repo, for the pull request's comparison, or null. */
async function load(year: string): Promise<PerDiemRow[] | null> {
	const text = await readFile(join(root, folder, `${year}.json`), 'utf8').catch(() => null);

	return text ? (JSON.parse(text) as PerDiemRow[]) : null;
}

const job: Job = {
	name: 'per-diem',

	async check() {
		const { zipFiles } = await listing();

		return nextYear(
			await yearsOnHand(),
			[...zipFiles.keys()].map((year) => `FY${year}`),
		);
	},

	async build(update): Promise<Build> {
		if (!/^FY\d{4}$/.test(update)) {
			throw new Error(`"${update}" isn't a fiscal year. Use FY and the year, such as FY2027.`);
		}

		const fiscalYear = Number(update.slice(2));
		const { zipFiles, mealsTable } = await listing();
		const zipUrl = zipFiles.get(fiscalYear);

		if (!zipUrl || !mealsTable) {
			throw new Error(
				!zipUrl
					? `GSA's page has no ZIP-code file for ${update}. It lists: ${[...zipFiles.keys()].map((year) => `FY${year}`).join(', ') || 'none'}.`
					: "GSA's page has no meals breakdown document. Did the page change?",
			);
		}

		const destinations = await readZipFile(await fetchFile(zipUrl));
		const lunchByTotal = await readMealsTable(await fetchFile(mealsTable));
		const checks = runChecks(fiscalYear, destinations, lunchByTotal);
		const failed = checks.filter((check) => !check.passed);

		if (failed.length > 0) {
			throw new Error(
				`${update} failed its checks, so nothing was written:\n${failed.map((check) => `  - ${check.name}${check.detail ? ` (${check.detail})` : ''}`).join('\n')}`,
			);
		}

		const rows = toRows(destinations, lunchByTotal);

		return {
			path: `${folder}/${update}.json`,
			contents: formatRows(rows),
			summary: summarize(
				fiscalYear,
				destinations,
				rows,
				lunchByTotal,
				checks,
				await load(`FY${fiscalYear - 1}`),
			),
		};
	},
};

export default job;
