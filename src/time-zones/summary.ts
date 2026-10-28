import type { CheckResult } from '../flight-history/checks.ts';
import { IANA, type Located, type Placed, type TimeZoneRow } from './read.ts';

const count = (n: number) => n.toLocaleString('en-US');

/**
 * The pull request's description: how many rows landed in each zone, the states
 * that are split between zones (for a person to look over), the one known gap,
 * and what changed since the year before when that file is in the repo.
 */
export function summarize(
	year: number,
	located: readonly Located[],
	placed: Placed,
	checks: readonly CheckResult[],
	previous: readonly TimeZoneRow[] | null,
	boundariesAsOf: string,
): string {
	const zoneOf = new Map(
		placed.rows.map((row) => [
			`${row.kind}:${row.kind === 'place' ? row.geoid : row.zip}`,
			row.timeZone,
		]),
	);
	const zonesByState = new Map<string, Set<string>>();

	for (const item of located) {
		const zone = zoneOf.get(`${item.kind}:${item.geoid ?? item.zip}`);

		if (zone) {
			zonesByState.set(item.state, (zonesByState.get(item.state) ?? new Set()).add(zone));
		}
	}

	const split = [...zonesByState]
		.filter(([, zones]) => zones.size > 1)
		.map(
			([state, zones]) => `${state} (${[...zones].map((zone) => zone.split('/')[1]).join(', ')})`,
		)
		.sort();
	const names = [...Object.values(IANA), 'America/Phoenix'];
	const lines = [
		`## Time zones for the ${year} places`,
		'',
		`The time zone of each of ${count(placed.rows.length)} places and ZIP code areas in the \`places/${year}.json\` file, found by testing the center point against DOT's time zone boundaries (National Transportation Atlas Database, boundaries as of ${boundariesAsOf}). The app turns a zone name and a date into the offset from UTC, so daylight saving time follows each zone's own rules.`,
		'',
		'| Time zone | Places | ZIP code areas |',
		'| --- | ---: | ---: |',
		...names.map((name) => {
			const rows = placed.rows.filter((row) => row.timeZone === name);

			return `| ${name} | ${count(rows.filter((row) => row.kind === 'place').length)} | ${count(rows.filter((row) => row.kind === 'zip').length)} |`;
		}),
		'',
		`### States split between zones: ${split.length}`,
		'',
		split.length === 0 ? 'None.' : split.join(', '),
		'',
		'### Known gap',
		'',
		"Every point in Arizona gets `America/Phoenix`, which stays on standard time all year. The Navajo Nation, in the state's northeast corner, does observe daylight saving time, so a place there is an hour off in summer. DOT's file has no Navajo Nation boundary, so it isn't handled yet.",
		'',
		'### Checks',
		'',
		...checks.map(
			(check) =>
				`- ${check.passed ? '✅' : '❌'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`,
		),
	];

	if (previous) {
		const before = new Map(
			previous.map((row) => [
				`${row.kind}:${row.kind === 'place' ? row.geoid : row.zip}`,
				row.timeZone,
			]),
		);
		const changed = placed.rows.filter((row) => {
			const was = before.get(`${row.kind}:${row.kind === 'place' ? row.geoid : row.zip}`);

			return was !== undefined && was !== row.timeZone;
		});

		lines.push(
			'',
			`### Compared with ${year - 1}`,
			'',
			`${count(changed.length)} rows changed zone.`,
		);
	}

	return `${lines.join('\n')}\n`;
}
