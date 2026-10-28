import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Build, Job } from '../lib/job.ts';
import { checkParking, checkRental, type ParkingRow, type RentalRow, staleRows } from './checks.ts';

const root = join(import.meta.dirname, '..', '..');

/** The two tables that people keep by hand, and where they live. */
export const FILES = {
	parking: 'datasets/airport-parking.json',
	rental: 'datasets/rental-rates.json',
} as const;

async function load<T>(path: string, directory: string): Promise<T[] | null> {
	const text = await readFile(join(directory, path), 'utf8').catch(() => null);

	return text === null ? null : (JSON.parse(text) as T[]);
}

/**
 * Looks at both hand-kept tables and says what is wrong with them or what is
 * due for a new look. Returns the problems (the checks that failed, or a table
 * that is missing) and the rows past their review date.
 */
export async function inspect(
	today: string,
	directory = root,
): Promise<{ problems: string[]; due: string[]; counts: string }> {
	const parking = await load<ParkingRow>(FILES.parking, directory);
	const rental = await load<RentalRow>(FILES.rental, directory);
	const problems: string[] = [];
	const due: string[] = [];

	if (parking === null) {
		problems.push(`${FILES.parking} is missing.`);
	} else {
		for (const check of checkParking(parking).filter((result) => !result.passed)) {
			problems.push(`${FILES.parking}: ${check.name}`);
		}

		due.push(...staleRows(parking, (row: ParkingRow) => row.code, today));
	}

	if (rental === null) {
		problems.push(`${FILES.rental} is missing.`);
	} else {
		for (const check of checkRental(rental).filter((result) => !result.passed)) {
			problems.push(`${FILES.rental}: ${check.name}`);
		}

		due.push(...staleRows(rental, (row: RentalRow) => row.region, today));
	}

	return {
		problems,
		due,
		counts: `${parking?.length ?? 0} airports, ${rental?.length ?? 0} rental regions`,
	};
}

const job: Job = {
	name: 'hand-kept',

	/** Nothing to fetch: this only reports a broken table or rows due for review. */
	async check() {
		const { problems, due, counts } = await inspect(new Date().toISOString().slice(0, 10));

		if (problems.length > 0) {
			throw new Error(`The hand-kept tables have problems:\n  - ${problems.join('\n  - ')}`);
		}

		return {
			next: null,
			note:
				due.length > 0
					? `${counts}. Due for a new look (reviewed over a year ago): ${due.join(', ')}.`
					: `${counts}, all reviewed within the last year.`,
		};
	},

	async build(): Promise<Build> {
		throw new Error(
			`The hand-kept tables are edited by hand, in a pull request: ${FILES.parking} and ${FILES.rental}. Run "npm run job -- hand-kept --check" to validate them.`,
		);
	},
};

export default job;
