import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheName, download } from '../lib/download.ts';
import type { Build, Job } from '../lib/job.ts';
import { formatRows } from '../lib/write.ts';
import { runChecks } from './checks.ts';
import { findEnplanementFiles } from './links.ts';
import { type AirportRow, matchAirports, readFaa, readOurAirports } from './read.ts';
import { summarize } from './summary.ts';

const root = join(import.meta.dirname, '..', '..');
const folder = 'datasets/airports';

/** The FAA's page of passenger boarding (enplanement) data. The spreadsheet's name changes each year, so the page is the only list. */
export const PAGE_URL =
	'https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger';

/** OurAirports' list of the world's airports, kept in the public domain. It changes most days. */
export const OURAIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

/** The years already in the repo, oldest first, as `2025`. */
export async function yearsOnHand(directory = join(root, folder)): Promise<string[]> {
	const names = await readdir(directory).catch(() => []);

	return names
		.filter((name) => /^\d{4}\.json$/.test(name))
		.map((name) => name.slice(0, 4))
		.sort();
}

/**
 * The first year the FAA has that the repo doesn't, after the newest one on
 * hand. The years come one at a time, so a gap in the repo is never skipped.
 */
export function nextYear(
	have: readonly string[],
	available: readonly string[],
): { next: string | null; note: string } {
	const newest = have.at(-1);

	if (!newest) {
		return {
			next: null,
			note: 'No years in the repo yet. Make one with --update YYYY, such as 2025.',
		};
	}

	const next = [...available].sort().find((year) => year > newest);

	return next
		? { next, note: `The FAA has ${next}.` }
		: { next: null, note: `Up to date: ${newest} is the newest year the FAA has.` };
}

async function listing(): Promise<Map<number, string>> {
	const response = await fetch(PAGE_URL);

	if (!response.ok) {
		throw new Error(
			`Couldn't read the FAA's enplanements page: ${response.status} ${response.statusText}`,
		);
	}

	return findEnplanementFiles(await response.text(), PAGE_URL);
}

/**
 * OurAirports' list, kept in `.cache/` under the date it was last changed, so a
 * new day's list is fetched and an old one is never mistaken for it. Returns the
 * path and that date.
 */
async function ourAirports(): Promise<{ path: string; asOf: string }> {
	const head = await fetch(OURAIRPORTS_URL, { method: 'HEAD' });
	const modified = head.headers.get('last-modified');
	const asOf = (modified ? new Date(modified) : new Date()).toISOString().slice(0, 10);

	return {
		path: await download(
			OURAIRPORTS_URL,
			join(root, '.cache', 'airports', `ourairports-${asOf}.csv`),
		),
		asOf,
	};
}

/** A year already in the repo, for the pull request's comparison, or null. */
async function load(year: number): Promise<AirportRow[] | null> {
	const text = await readFile(join(root, folder, `${year}.json`), 'utf8').catch(() => null);

	return text ? (JSON.parse(text) as AirportRow[]) : null;
}

const job: Job = {
	name: 'airports',

	async check() {
		return nextYear(await yearsOnHand(), [...(await listing()).keys()].map(String));
	},

	async build(update): Promise<Build> {
		if (!/^\d{4}$/.test(update)) {
			throw new Error(`"${update}" isn't a year. Use four digits, such as 2025.`);
		}

		const asked = Number(update);
		const files = await listing();
		const url = files.get(asked);

		if (!url) {
			throw new Error(
				`The FAA's page has no enplanement spreadsheet for ${update}. It lists: ${[...files.keys()].join(', ') || 'none'}.`,
			);
		}

		const { year, airports } = await readFaa(
			await download(url, join(root, '.cache', 'airports', cacheName(url))),
		);
		const ours = await ourAirports();
		const matched = matchAirports(airports, await readOurAirports(ours.path));
		const checks = runChecks(year, asked, airports, matched);
		const failed = checks.filter((check) => !check.passed);

		if (failed.length > 0) {
			throw new Error(
				`${update} failed its checks, so nothing was written:\n${failed.map((check) => `  - ${check.name}${check.detail ? ` (${check.detail})` : ''}`).join('\n')}`,
			);
		}

		return {
			path: `${folder}/${update}.json`,
			contents: formatRows(matched.rows),
			summary: summarize(asked, airports, matched, checks, await load(asked - 1), ours.asOf),
		};
	},
};

export default job;
