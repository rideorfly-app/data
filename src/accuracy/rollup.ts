// Combines monthly accuracy reports into one table, to compare the methods
// over a stretch of months. Delay figures are averaged with each month
// weighted by its flights; flight-time figures are averaged with each month
// weighted by its route-days, so a median here is the average of monthly
// medians.
//
//   node src/accuracy/rollup.ts 2023-01 2025-12

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monthsBetween, parseMonth } from '../lib/months.ts';
import type { ReportRow } from './report.ts';
import { round } from './stats.ts';

const [from, to] = process.argv.slice(2);

if (!from || !to) {
	console.error('Usage: node src/accuracy/rollup.ts FROM TO   (months as YYYY-MM)');
	process.exit(1);
}

const root = join(import.meta.dirname, '..', '..');
const months = monthsBetween(parseMonth(from), parseMonth(to));

const DELAY_FIELDS = [
	'maeDelayMinutes',
	'biasDelayMinutes',
	'maeDelayShare',
	'biasDelayShare',
	'maeDisruptShare',
	'biasDisruptShare',
] as const;

const FLIGHT_TIME_FIELDS = [
	'medianErrorMinutes',
	'medianAbsErrorMinutes',
	'within10Minutes',
	'within15Percent',
	'withinSpread',
	'medianErrorVsAverageMinutes',
	'within10MinutesOfAverage',
] as const;

interface Sum {
	weight: number;
	months: number;
	totals: Record<string, number>;
}

const sums = new Map<string, Sum>();

function add(key: string, weight: number, values: Record<string, number>) {
	const sum = sums.get(key) ?? { weight: 0, months: 0, totals: {} };

	sum.weight += weight;
	sum.months++;

	for (const [name, value] of Object.entries(values)) {
		sum.totals[name] = (sum.totals[name] ?? 0) + value * weight;
	}

	sums.set(key, sum);
}

const missing: string[] = [];

for (const month of months) {
	const text = await readFile(join(root, 'datasets', 'accuracy', `${month}.json`), 'utf8').catch(
		() => null,
	);

	if (!text) {
		missing.push(month);
		continue;
	}

	for (const row of JSON.parse(text) as ReportRow[]) {
		if (row.kind === 'delay') {
			add(
				`delay ${row.leadMonths} ${row.group} ${row.method}`,
				row.flights,
				Object.fromEntries(DELAY_FIELDS.map((field) => [field, row[field]])),
			);
		} else if (row.kind === 'flight-time') {
			add(
				`flight-time ${row.leadMonths} ${row.group} ${row.method}`,
				row.routeDays,
				Object.fromEntries(FLIGHT_TIME_FIELDS.map((field) => [field, row[field]])),
			);
		}
	}
}

const average = (sum: Sum, field: string) => round((sum.totals[field] ?? 0) / sum.weight, 4);
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

console.log(`## Accuracy, ${from} to ${to}`);

if (missing.length > 0) {
	console.log(`\nNo report for ${missing.length} month(s): ${missing.join(', ')}`);
}

for (const lead of [3, 6]) {
	console.log(`\n### Delay figures, ${lead} months ahead\n`);
	console.log(
		'| Group | Method | Months | Average delay off by | Bias | Delayed 15+ off by | Bias | Disrupted off by | Bias |',
	);
	console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');

	for (const [key, sum] of sums) {
		const [kind, thisLead, group, method] = key.split(' ');

		if (kind === 'delay' && Number(thisLead) === lead) {
			console.log(
				`| ${group} | ${method} | ${sum.months} | ${average(sum, 'maeDelayMinutes')} min | ${average(sum, 'biasDelayMinutes')} min | ${percent(average(sum, 'maeDelayShare'))} | ${percent(average(sum, 'biasDelayShare'))} | ${percent(average(sum, 'maeDisruptShare'))} | ${percent(average(sum, 'biasDisruptShare'))} |`,
			);
		}
	}

	console.log(`\n### Flight times, ${lead} months ahead\n`);
	console.log(
		'| Group | Method | Months | Median error | Median absolute error | Within 10 min | Within 15% | Inside the day’s spread | Median error vs the average flight | Within 10 min of the average |',
	);
	console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');

	for (const [key, sum] of sums) {
		const [kind, thisLead, group, method] = key.split(' ');

		if (kind === 'flight-time' && Number(thisLead) === lead) {
			console.log(
				`| ${group} | ${method} | ${sum.months} | ${average(sum, 'medianErrorMinutes')} min | ${average(sum, 'medianAbsErrorMinutes')} min | ${percent(average(sum, 'within10Minutes'))} | ${percent(average(sum, 'within15Percent'))} | ${percent(average(sum, 'withinSpread'))} | ${average(sum, 'medianErrorVsAverageMinutes')} min | ${percent(average(sum, 'within10MinutesOfAverage'))} |`,
			);
		}
	}
}
