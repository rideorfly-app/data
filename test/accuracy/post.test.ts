import { describe, expect, it } from 'vitest';
import { buildPost } from '../../src/accuracy/post.ts';
import type { ReportRow } from '../../src/accuracy/report.ts';

const delay = (method: string, lead: number, mae: number, group = 'all') =>
	({
		kind: 'delay',
		month: '2025-12',
		leadMonths: lead,
		method,
		group,
		routes: 10,
		flights: 100,
		maeDelayMinutes: mae,
		biasDelayMinutes: 0,
		maeDelayShare: 0.0831,
		biasDelayShare: 0,
		maeDisruptShare: 0.0181,
		biasDisruptShare: 0,
	}) as unknown as ReportRow;

const time = (method: string, lead: number, within10: number, median: number) =>
	({
		kind: 'flight-time',
		month: '2025-12',
		leadMonths: lead,
		method,
		group: 'all',
		routeDays: 50,
		medianErrorMinutes: median,
		medianAbsErrorMinutes: 10,
		within10Minutes: within10,
		within15Percent: 0.659,
		withinSpread: 0.4,
		medianErrorVsAverageMinutes: 0,
		within10MinutesOfAverage: 0.3,
	}) as unknown as ReportRow;

const report: ReportRow[] = [
	{ kind: 'report', month: '2025-12', engine: '020adef', minDayFlights: 3 },
	{
		kind: 'coverage',
		month: '2025-12',
		leadMonths: 3,
		routes: 4914,
		flights: 546675,
		unknownRoutes: 5,
		unknownFlights: 50,
	},
	// Out of order on purpose, with rows from other groups that must be ignored.
	delay('newest', 3, 13.43),
	delay('last-year', 3, 11.16),
	delay('average', 3, 10.13),
	delay('average', 3, 99, 'thin'),
	time('last-year', 3, 0.364, -1),
	time('average', 3, 0.362, 6.9),
];

describe('buildPost', () => {
	const post = buildPost(report, '2026-10-14');

	it('names the month and the engine, and says which way is better', () => {
		expect(post.title).toBe('Accuracy report: December 2025');
		expect(post.body).toContain('in December 2025, using only the data published before then');
		expect(post.body).toContain('The engine was `020adef`.');
		expect(post.body).toContain('smaller numbers are better');
	});

	it('copies the figures from the file, the method the engine uses first', () => {
		const lines = post.body.split('\n');
		const rows = lines.filter(
			(line) => line.startsWith('| ') && !line.startsWith('| Method') && !line.startsWith('| ---'),
		);

		expect(rows[0]).toBe(
			'| Average of the same month over five years (used) | 10.1 minutes | 8.3 points | 1.8 points |',
		);
		expect(rows[1]).toContain('The same month last year | 11.2 minutes');
		expect(rows[2]).toContain('The newest month alone | 13.4 minutes');
		expect(rows[3]).toBe(
			'| Average of the same month over five years (used) | 36% | 66% | +6.9 minutes |',
		);
		expect(rows[4]).toBe('| The same month last year | 36% | 66% | -1.0 minutes |');
	});

	it('puts the method the engine uses first even when another sorts before it', () => {
		const rows = [...report, delay('alpha', 3, 5)];
		const first = buildPost(rows, '2026-10-14')
			.body.split('\n')
			.find((line) => line.includes('minutes |'));

		expect(first).toContain('(used)');
	});

	it('uses only the figures for all routes, never another group’s', () => {
		expect(post.body).not.toContain('99.0 minutes');
	});

	it('says how many routes and flights each lead covers', () => {
		expect(post.body).toContain('### Estimates made 3 months ahead');
		expect(post.body).toContain('4,914 routes and 546,675 flights.');
	});

	it('links to the report file at the release', () => {
		expect(post.body).toContain(
			'[datasets/accuracy/2025-12.json](https://github.com/rideorfly-app/data/blob/2026-10-14/datasets/accuracy/2025-12.json), in data release 2026-10-14',
		);
	});

	it('refuses a file with no report line, or a lead with no delay figures', () => {
		expect(() => buildPost([], '2026-10-14')).toThrow(/no 'report' line/);
		expect(() =>
			buildPost(
				report.filter((row) => row.kind !== 'delay'),
				'2026-10-14',
			),
		).toThrow(/3-month part of the report is incomplete/);
	});
});
