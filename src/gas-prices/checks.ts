import type { CheckResult } from '../flight-history/checks.ts';
import { REGIONS, type Region } from './series.ts';

/** One line of the file: a region's price for a week. */
export interface GasRow {
	week: string;
	region: Region;
	dollarsPerGallon: number;
}

/**
 * Sanity ranges for a week of regular gasoline. They are wide on purpose: they
 * catch a broken file (a wrong week, a missing region, dollars in cents), not
 * an unusual week.
 */
export const EXPECTED = {
	dollarsPerGallon: [1.5, 8],

	/** The widest a region may sit from the nation. California runs about $1.50 over. */
	fromNational: 2.5,
} as const;

/** Runs every check on a week's rows; the job writes nothing unless all pass. */
export function runChecks(week: string, rows: readonly GasRow[]): CheckResult[] {
	const national = rows.find((row) => row.region === 'national')?.dollarsPerGallon;
	const [low, high] = EXPECTED.dollarsPerGallon;

	return [
		{
			name: 'The week is a Monday, which is when EIA dates its weekly prices',
			passed: new Date(`${week}T00:00:00Z`).getUTCDay() === 1,
		},
		{
			name: `Every row is for ${week}`,
			passed: rows.every((row) => row.week === week),
		},
		{
			name: 'Every region has exactly one price',
			passed:
				rows.length === REGIONS.length &&
				REGIONS.every((region) => rows.filter((row) => row.region === region).length === 1),
		},
		{
			name: `Every price is plausible ($${low} to $${high} a gallon)`,
			passed: rows.every((row) => row.dollarsPerGallon >= low && row.dollarsPerGallon <= high),
		},
		{
			name: `Every region is within $${EXPECTED.fromNational.toFixed(2)} of the national price`,
			passed:
				national !== undefined &&
				rows.every((row) => Math.abs(row.dollarsPerGallon - national) <= EXPECTED.fromNational),
		},
	];
}
