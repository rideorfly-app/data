import type { CheckResult } from '../flight-history/checks.ts';
import type { GasRow } from './checks.ts';
import { priceFor, type Weekly, weeksBefore } from './series.ts';

const dollars = (price: number | undefined) =>
	price === undefined ? 'n/a' : `$${price.toFixed(3)}`;

const change = (now: number, before: number | undefined) =>
	before === undefined
		? 'n/a'
		: `${now >= before ? '+' : '−'}$${Math.abs(now - before).toFixed(3)}`;

/**
 * The pull request's description: each region's price, and how it compares
 * with the week before and the same week a year earlier (both taken from
 * EIA's own history, so they don't depend on what's in the repo).
 */
export function summarize(
	week: string,
	rows: readonly GasRow[],
	checks: readonly CheckResult[],
	weekly: Weekly,
): string {
	const lines = [
		`## Gas prices for the week of ${week}`,
		'',
		'Regular gasoline, all formulations, in dollars per gallon, from EIA.',
		'',
		'| Region | Price | Week before | A year earlier |',
		'| --- | ---: | ---: | ---: |',
	];

	for (const row of rows) {
		const before = priceFor(weekly, row.region, weeksBefore(week, 1));
		const yearAgo = priceFor(weekly, row.region, weeksBefore(week, 52));

		lines.push(
			`| ${row.region} | ${dollars(row.dollarsPerGallon)} | ${change(row.dollarsPerGallon, before)} | ${change(row.dollarsPerGallon, yearAgo)} |`,
		);
	}

	lines.push('', '### Checks', '');

	for (const check of checks) {
		lines.push(`- ${check.passed ? '✅' : '❌'} ${check.name}`);
	}

	return `${lines.join('\n')}\n`;
}
