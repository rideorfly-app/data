import type { Month } from '../lib/months.ts';
import { LEADS, type ReportRow } from './report.ts';

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);

/**
 * The pull request's description: for each lead time, which method guessed the
 * delay figures best and how close the flight times were.
 */
export function summarize(month: Month, rows: readonly ReportRow[]): string {
	const report = rows.find((row) => row.kind === 'report');
	const lines = [
		`## Accuracy report for ${month}`,
		'',
		`The estimates were made by engine ${report?.kind === 'report' ? report.engine : 'unknown'}, seeing only the months DOT would have published by then. A positive error means the estimate was too gloomy.`,
	];

	for (const lead of LEADS) {
		const coverage = rows.find((row) => row.kind === 'coverage' && row.leadMonths === lead);

		lines.push('', `### ${lead} months ahead`, '');

		if (coverage?.kind === 'coverage') {
			lines.push(
				`${coverage.routes.toLocaleString('en-US')} routes had a record to start from. ${coverage.unknownRoutes.toLocaleString('en-US')} more (${coverage.unknownFlights.toLocaleString('en-US')} flights) did not, so the engine would have used typical figures.`,
				'',
			);
		}

		lines.push(
			'**Delay figures** (routes weighted by their flights)',
			'',
			'| Method | Average delay off by | Bias | Delayed 15+ min off by | Cancelled or diverted off by |',
			'| --- | ---: | ---: | ---: | ---: |',
		);

		for (const row of rows) {
			if (row.kind === 'delay' && row.leadMonths === lead && row.group === 'all') {
				lines.push(
					`| ${row.method} | ${row.maeDelayMinutes} min | ${signed(row.biasDelayMinutes)} min | ${percent(row.maeDelayShare)} | ${percent(row.maeDisruptShare)} |`,
				);
			}
		}

		lines.push(
			'',
			"**Flight times** (each route-day with three or more flights, against that day's typical flight, and on the right against its average flight)",
			'',
			'| Method | Route-days | Median error | Within 10 min | Within 15% | Inside the day’s spread | Median error vs the average | Within 10 min of the average |',
			'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		);

		for (const row of rows) {
			if (row.kind === 'flight-time' && row.leadMonths === lead && row.group === 'all') {
				lines.push(
					`| ${row.method} | ${row.routeDays.toLocaleString('en-US')} | ${signed(row.medianErrorMinutes)} min | ${percent(row.within10Minutes)} | ${percent(row.within15Percent)} | ${percent(row.withinSpread)} | ${signed(row.medianErrorVsAverageMinutes)} min | ${percent(row.within10MinutesOfAverage)} |`,
				);
			}
		}
	}

	return `${lines.join('\n')}\n`;
}
