import type { CheckResult } from '../flight-history/checks.ts';
import type { PlaceRow, ZipRow } from './read.ts';

const count = (n: number) => n.toLocaleString('en-US');

/**
 * The pull request's description: what's in the file, the largest places, how
 * many ZIP code areas were left out, and what changed since the year before
 * when that is in the repo.
 */
export function summarize(
	year: number,
	places: readonly PlaceRow[],
	zips: readonly ZipRow[],
	zipsLeftOut: number,
	checks: readonly CheckResult[],
	previous: readonly PlaceRow[] | null,
): string {
	const people = places.reduce((total, place) => total + (place.population ?? 0), 0);
	const lines = [
		`## Places and ZIP codes for ${year}`,
		'',
		`${count(places.length)} incorporated places (cities, towns, villages, and boroughs, plus consolidated cities such as Indianapolis and Nashville and Washington, DC: every place Census publishes a population estimate for) and ${count(zips.length)} ZIP code areas in the Lower 48 and DC, from Census's ${year} Gazetteer. ${count(zipsLeftOut)} ZIP code areas whose main state is elsewhere were left out. Unincorporated communities (Census's "CDPs") are not included. The places hold ${count(people)} people by Census's ${year} estimate. Each place carries its nearest ZIP code area in the same state, for looking up hotel and meal rates.`,
		'',
		'### Largest five',
		'',
		'| Place | Population | Nearest ZIP |',
		'| --- | ---: | --- |',
		...[...places]
			.sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
			.slice(0, 5)
			.map(
				(place) =>
					`| ${place.name}, ${place.state} | ${count(place.population ?? 0)} | ${place.zip} |`,
			),
		'',
		'### Against the year before',
		'',
	];

	if (previous && previous.length > 0) {
		const before = new Set(previous.map((place) => place.geoid));
		const now = new Set(places.map((place) => place.geoid));
		const added = places.filter((place) => !before.has(place.geoid));
		const dropped = previous.filter((place) => !now.has(place.geoid));
		const names = (list: readonly PlaceRow[]) =>
			list.length === 0
				? 'none'
				: list
						.slice(0, 8)
						.map((place) => `${place.name}, ${place.state}`)
						.join('; ') + (list.length > 8 ? `; and ${list.length - 8} more` : '');

		lines.push(
			`${count(previous.length)} places before, ${count(places.length)} now. Added: ${names(added)}. Dropped: ${names(dropped)}.`,
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
