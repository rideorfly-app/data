import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { download } from '../lib/download.ts';
import type { Build, Job } from '../lib/job.ts';
import { formatRows } from '../lib/write.ts';
import { runChecks } from './checks.ts';
import { type Located, parseZones, placeRows, type TimeZoneRow } from './read.ts';
import { summarize } from './summary.ts';

const root = join(import.meta.dirname, '..', '..');
const folder = 'datasets/time-zones';

/** DOT's time zone boundaries, from the Bureau of Transportation Statistics' National Transportation Atlas Database. */
const SERVICE =
	'https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Time_Zones/FeatureServer/0';
export const BOUNDARIES_URL = `${SERVICE}/query?where=1%3D1&outFields=zone&returnGeometry=true&f=geojson`;
export const METADATA_URL = `${SERVICE}?f=json`;

const years = async (directory: string): Promise<string[]> =>
	(await readdir(directory).catch(() => []))
		.filter((name) => /^\d{4}\.json$/.test(name))
		.map((name) => name.slice(0, 4))
		.sort();

/**
 * The first year of places that has no time zone file yet, after the newest one
 * on hand. Years come one at a time, so a gap is never skipped.
 */
export function nextYear(
	have: readonly string[],
	places: readonly string[],
): { next: string | null; note: string } {
	const newest = have.at(-1);

	if (!newest) {
		return {
			next: null,
			note: 'No years in the repo yet. Make one with --update YYYY, such as 2025.',
		};
	}

	const next = [...places].sort().find((year) => year > newest);

	return next
		? { next, note: `The places file for ${next} has no time zones yet.` }
		: { next: null, note: `Up to date: ${newest} is the newest year of places.` };
}

/** When DOT's layer last changed, as a date, or "unknown". */
async function boundariesAsOf(): Promise<string> {
	const response = await fetch(METADATA_URL);
	const layer = (await response.json().catch(() => null)) as {
		editingInfo?: { dataLastEditDate?: number };
	} | null;
	const edited = layer?.editingInfo?.dataLastEditDate;

	return edited ? new Date(edited).toISOString().slice(0, 10) : 'unknown';
}

/** The places file for a year, reduced to what the time zone needs. */
async function loadPlaces(year: string): Promise<Located[]> {
	const text = await readFile(join(root, 'datasets/places', `${year}.json`), 'utf8').catch(
		() => null,
	);

	if (text === null) {
		throw new Error(
			`There is no datasets/places/${year}.json to work from. Make it first: npm run job -- places --update ${year}`,
		);
	}

	return JSON.parse(text) as Located[];
}

async function load(year: number): Promise<TimeZoneRow[] | null> {
	const text = await readFile(join(root, folder, `${year}.json`), 'utf8').catch(() => null);

	return text ? (JSON.parse(text) as TimeZoneRow[]) : null;
}

const job: Job = {
	name: 'time-zones',

	async check() {
		return nextYear(await years(join(root, folder)), await years(join(root, 'datasets/places')));
	},

	async build(update): Promise<Build> {
		if (!/^\d{4}$/.test(update)) {
			throw new Error(`"${update}" isn't a year. Use four digits, such as 2025.`);
		}

		const year = Number(update);
		const located = await loadPlaces(update);
		const regions = parseZones(
			await readFile(
				await download(
					BOUNDARIES_URL,
					join(root, '.cache', 'time-zones', 'ntad-time-zones.geojson'),
				),
				'utf8',
			),
		);
		const placed = placeRows(regions, located);
		const checks = runChecks(regions, located, placed);
		const failed = checks.filter((check) => !check.passed);

		if (failed.length > 0) {
			throw new Error(
				`${update} failed its checks, so nothing was written:\n${failed.map((check) => `  - ${check.name}${check.detail ? ` (${check.detail})` : ''}`).join('\n')}`,
			);
		}

		return {
			path: `${folder}/${update}.json`,
			contents: formatRows(placed.rows),
			summary: summarize(
				year,
				located,
				placed,
				checks,
				await load(year - 1),
				await boundariesAsOf(),
			),
		};
	},
};

export default job;
