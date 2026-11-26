import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { download, exists } from '../lib/download.ts';
import type { Build, Job } from '../lib/job.ts';
import { formatRows } from '../lib/write.ts';
import { runChecks } from './checks.ts';
import {
	buildRows,
	type PlaceRow,
	readPlaces,
	readPopulation,
	readZipStates,
	readZips,
} from './read.ts';
import { summarize } from './summary.ts';

const root = join(import.meta.dirname, '..', '..');
const folder = 'datasets/places';
const census = 'https://www2.census.gov';

/** Census's Gazetteers of places and of ZIP code areas for a year. No key is needed. */
export const placesUrl = (year: number) =>
	`${census}/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_Gaz_place_national.zip`;
export const zipsUrl = (year: number) =>
	`${census}/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_Gaz_zcta_national.zip`;

/** Census's population estimates for cities and towns, in the vintage of that year. */
export const populationUrl = (year: number) =>
	`${census}/programs-surveys/popest/datasets/2020-${year}/cities/totals/sub-est${year}.csv`;

/** Which county each ZIP code area lies in, from the 2020 Census. ZIP code areas are redrawn only with each Census, so this stays good until 2030. */
export const ZIP_COUNTY_URL = `${census}/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt`;

/** The years already in the repo, oldest first, as `2025`. */
export async function yearsOnHand(directory = join(root, folder)): Promise<string[]> {
	const names = await readdir(directory).catch(() => []);

	return names
		.filter((name) => /^\d{4}\.json$/.test(name))
		.map((name) => name.slice(0, 4))
		.sort();
}

/**
 * The year after the newest one on hand, if Census has published all three
 * files for it. The years come one at a time, so a gap in the repo is never
 * skipped over.
 */
export async function nextYear(
	have: readonly string[],
	published: (year: number) => Promise<boolean>,
): Promise<{ next: string | null; note: string }> {
	const newest = have.at(-1);

	if (!newest) {
		return {
			next: null,
			note: 'No years in the repo yet. Make one with --update YYYY, such as 2025.',
		};
	}

	const next = Number(newest) + 1;

	return (await published(next))
		? { next: String(next), note: `Census has ${next}.` }
		: {
				next: null,
				note: `Up to date: ${newest} is the newest year Census has all three files for, and ${next} isn't out yet.`,
			};
}

/** A year already in the repo, for the pull request's comparison, or null. */
async function load(year: number): Promise<PlaceRow[] | null> {
	const text = await readFile(join(root, folder, `${year}.json`), 'utf8').catch(() => null);

	return text ? (JSON.parse(text) as PlaceRow[]).filter((row) => row.kind === 'place') : null;
}

const job: Job = {
	name: 'places',

	async check() {
		return nextYear(
			await yearsOnHand(),
			async (year) =>
				(await exists(placesUrl(year))) &&
				(await exists(zipsUrl(year))) &&
				(await exists(populationUrl(year))),
		);
	},

	async build(update): Promise<Build> {
		if (!/^\d{4}$/.test(update)) {
			throw new Error(`"${update}" isn't a year. Use four digits, such as 2025.`);
		}

		const year = Number(update);
		const cache = join(root, '.cache', 'places');
		const population = await readPopulation(
			await download(populationUrl(year), join(cache, `sub-est${year}.csv`)),
			year,
		);
		const places = await readPlaces(
			await download(placesUrl(year), join(cache, `${year}_Gaz_place_national.zip`)),
			population,
		);
		const zips = await readZips(
			await download(zipsUrl(year), join(cache, `${year}_Gaz_zcta_national.zip`)),
		);
		const zipStates = await readZipStates(
			await download(ZIP_COUNTY_URL, join(cache, 'tab20_zcta520_county20_natl.txt')),
		);
		const rows = buildRows(places, zips, population, zipStates);
		const checks = runChecks(rows.places, rows.zips);
		const failed = checks.filter((check) => !check.passed);

		if (failed.length > 0) {
			throw new Error(
				`${year} failed its checks, so nothing was written:\n${failed.map((check) => `  - ${check.name}${check.detail ? ` (${check.detail})` : ''}`).join('\n')}`,
			);
		}

		return {
			path: `${folder}/${year}.json`,
			contents: formatRows([...rows.places, ...rows.zips]),
			summary: summarize(
				year,
				rows.places,
				rows.zips,
				zips.length - rows.zips.length,
				checks,
				await load(year - 1),
			),
		};
	},
};

export default job;
