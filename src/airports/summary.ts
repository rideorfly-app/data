import type { CheckResult } from '../flight-history/checks.ts';
import type { AirportRow, FaaAirport, Matched } from './read.ts';

const count = (n: number) => n.toLocaleString('en-US');

/**
 * The pull request's description: how many airports of each size, the busiest,
 * what could not be matched or was matched across a state line (for a person to
 * look at), and what changed since the year before when that is in the repo.
 */
export function summarize(
	year: number,
	faa: readonly FaaAirport[],
	matched: Matched,
	checks: readonly CheckResult[],
	previous: readonly AirportRow[] | null,
	coordinatesAsOf: string,
): string {
	const sizes = ['large', 'medium', 'small'] as const;
	const lines = [
		`## Airports for ${year}`,
		'',
		`${count(faa.length)} commercial-service airports in the Lower 48 and DC, from the FAA's ${year} enplanement spreadsheet. Coordinates are from OurAirports (public domain), as of ${coordinatesAsOf}.`,
		'',
		'| Size | Airports |',
		'| --- | ---: |',
		...sizes.map(
			(size) => `| ${size} | ${count(faa.filter((airport) => airport.size === size).length)} |`,
		),
		'',
		`${count(matched.rows.length)} of ${count(faa.length)} got coordinates.`,
		'',
		'### Busiest five',
		'',
		'| Airport | City | Passengers boarding |',
		'| --- | --- | ---: |',
		...[...matched.rows]
			.sort((a, b) => b.enplanements - a.enplanements)
			.slice(0, 5)
			.map(
				(row) =>
					`| ${row.code} ${row.name} | ${row.city}, ${row.state} | ${count(row.enplanements)} |`,
			),
	];

	lines.push('', '### Left out: no safe match for coordinates', '');
	lines.push(
		matched.unmatched.length === 0
			? 'None.'
			: matched.unmatched
					.map((airport) => `- ${airport.code} ${airport.name}, ${airport.city}, ${airport.state}`)
					.join('\n'),
	);

	lines.push('', '### Matched across a state line', '');
	lines.push(
		matched.disagreements.length === 0
			? 'None.'
			: matched.disagreements
					.map(
						(match) =>
							`- ${match.code}: the FAA says ${match.faaState}, OurAirports says ${match.ourRegion}. The only candidate, so it was used.`,
					)
					.join('\n'),
	);

	lines.push('', '### Against the year before', '');

	if (previous && previous.length > 0) {
		const before = new Set(previous.map((row) => row.code));
		const now = new Set(matched.rows.map((row) => row.code));
		const added = matched.rows.filter((row) => !before.has(row.code)).map((row) => row.code);
		const dropped = previous.filter((row) => !now.has(row.code)).map((row) => row.code);

		lines.push(
			`${count(previous.length)} airports before, ${count(matched.rows.length)} now. Added: ${added.join(', ') || 'none'}. Dropped: ${dropped.join(', ') || 'none'}.`,
		);
	} else {
		lines.push('The year before is not in the repo.');
	}

	lines.push('', '### Checks', '');

	for (const check of checks) {
		lines.push(
			`- ${check.passed ? '✅' : '❌'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`,
		);
	}

	return `${lines.join('\n')}\n`;
}
