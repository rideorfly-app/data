import type { CheckResult } from '../flight-history/checks.ts';
import type { Deaths, RoadSafetyRow } from './read.ts';

const count = (n: number) => n.toLocaleString('en-US');
const nationOf = (rows: readonly RoadSafetyRow[]) => rows.find((row) => row.state === 'US');

/**
 * The pull request's description: the nation's rate and how it compares with
 * the year before when that is in the repo, the five highest and lowest
 * states, and whether the checks passed.
 */
export function summarize(
	year: number,
	rows: readonly RoadSafetyRow[],
	deaths: Deaths,
	checks: readonly CheckResult[],
	previous: readonly RoadSafetyRow[] | null,
): string {
	const nation = nationOf(rows);
	const states = rows
		.filter((row) => row.state !== 'US')
		.sort((a, b) => b.ratePer100MillionMiles - a.ratePer100MillionMiles);
	const before = previous ? nationOf(previous) : undefined;
	const table = (list: readonly RoadSafetyRow[]) => [
		'| State | Deaths | Vehicle miles (millions) | Deaths per 100 million miles |',
		'| --- | ---: | ---: | ---: |',
		...list.map(
			(row) =>
				`| ${row.state} | ${count(row.deaths)} | ${count(row.vehicleMilesMillions)} | ${row.ratePer100MillionMiles.toFixed(2)} |`,
		),
	];

	const lines = [
		`## Road deaths for ${year}`,
		'',
		"Deaths from NHTSA's FARS crash file, divided by vehicle miles from FHWA's table VM-2, for the 50 states and DC.",
		'',
	];

	if (nation) {
		lines.push(
			`**The nation: ${nation.ratePer100MillionMiles.toFixed(2)} deaths per 100 million vehicle miles** (${count(nation.deaths)} deaths over ${count(nation.vehicleMilesMillions)} million miles).`,
			'',
		);
	}

	lines.push('### Against the year before', '');

	if (nation && before) {
		lines.push(
			`${before.year}: ${before.ratePer100MillionMiles.toFixed(2)} (${count(before.deaths)} deaths). That is ${nation.ratePer100MillionMiles >= before.ratePer100MillionMiles ? 'up' : 'down'} ${Math.abs(nation.ratePer100MillionMiles - before.ratePer100MillionMiles).toFixed(2)}.`,
		);
	} else {
		lines.push('The year before is not in the repo.');
	}

	lines.push(
		'',
		'### Highest five',
		'',
		...table(states.slice(0, 5)),
		'',
		'### Lowest five',
		'',
		...table(states.slice(-5).reverse()),
	);

	if (deaths.elsewhere > 0) {
		lines.push(
			'',
			`${count(deaths.elsewhere)} crashes in places that are not a state or DC (Puerto Rico, say) were left out.`,
		);
	}

	lines.push('', '### Checks', '');

	for (const check of checks) {
		lines.push(
			`- ${check.passed ? '✅' : '❌'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`,
		);
	}

	return `${lines.join('\n')}\n`;
}
