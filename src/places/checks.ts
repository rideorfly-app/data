import { LAUNCH_STATES } from '../flight-history/aggregate.ts';
import type { CheckResult } from '../flight-history/checks.ts';
import type { PlaceRow, ZipRow } from './read.ts';

/**
 * Sanity ranges for a year of places and ZIP codes in the Lower 48 and DC. They
 * are wide on purpose: they catch a broken file (a truncated download, a
 * changed column), not an unusual year. For 2025 there are 19,320 incorporated
 * places holding about 250 million people, and about 33,000 ZIP code areas.
 */
export const EXPECTED = {
	places: [18_500, 20_500],
	zips: [31_500, 34_500],
	population: [150_000_000, 340_000_000],

	/** The most places that may lack a population estimate. */
	noPopulationShare: 0.01,

	/** The Lower 48 and DC, with a little room. */
	lat: [24, 50],
	lon: [-125, -66],
} as const;

/** Up to five of the rows that fail `bad`, as text, or nothing if none do. */
function examples<T extends { state: string }>(
	rows: readonly T[],
	bad: (row: T) => boolean,
	label: (row: T) => string,
): string | undefined {
	const found = rows.filter(bad);

	return found.length === 0
		? undefined
		: `${found.length}, such as ${found.slice(0, 5).map(label).join('; ')}`;
}

/** Runs every check on a year's rows; the job writes nothing unless all pass. */
export function runChecks(places: readonly PlaceRow[], zips: readonly ZipRow[]): CheckResult[] {
	const within = (value: number, [low, high]: readonly [number, number]) =>
		value >= low && value <= high;
	const inBox = (row: { lat: number; lon: number }) =>
		within(row.lat, EXPECTED.lat) && within(row.lon, EXPECTED.lon);
	const noPopulation = places.filter((place) => place.population === null);
	const people = places.reduce((total, place) => total + (place.population ?? 0), 0);
	const states = (rows: readonly { state: string }[]) => new Set(rows.map((row) => row.state));
	const without = (rows: readonly { state: string }[]) =>
		[...LAUNCH_STATES].filter((code) => !states(rows).has(code));

	return [
		{
			name: `The number of incorporated places is plausible (${EXPECTED.places[0].toLocaleString('en-US')} to ${EXPECTED.places[1].toLocaleString('en-US')})`,
			passed: within(places.length, EXPECTED.places),
		},
		{
			name: `The number of ZIP code areas is plausible (${EXPECTED.zips[0].toLocaleString('en-US')} to ${EXPECTED.zips[1].toLocaleString('en-US')})`,
			passed: within(zips.length, EXPECTED.zips),
		},
		{
			name: 'No place ID and no ZIP code appears twice',
			passed:
				new Set(places.map((place) => place.geoid)).size === places.length &&
				new Set(zips.map((zip) => zip.zip)).size === zips.length,
		},
		{
			name: 'Every place has a name, and every ZIP code is five digits',
			passed:
				places.every((place) => place.name !== '') && zips.every((zip) => /^\d{5}$/.test(zip.zip)),
		},
		{
			name: 'Every place has a nearest ZIP code in its own state',
			passed: places.every((place) => /^\d{5}$/.test(place.zip)),
			detail: examples(
				places,
				(place) => !/^\d{5}$/.test(place.zip),
				(place) => `${place.name}, ${place.state}`,
			),
		},
		{
			name: `At least ${100 - EXPECTED.noPopulationShare * 100}% of places have a population estimate`,
			passed:
				places.length > 0 && noPopulation.length / places.length <= EXPECTED.noPopulationShare,
			detail: examples(
				places,
				(place) => place.population === null,
				(place) => `${place.name}, ${place.state}`,
			),
		},
		{
			name: `The people in all the places add up to a plausible number (${(EXPECTED.population[0] / 1e6).toFixed(0)} to ${(EXPECTED.population[1] / 1e6).toFixed(0)} million)`,
			passed: within(people, EXPECTED.population),
		},
		{
			name: 'Every state and DC has places and ZIP codes',
			passed: without(places).length === 0 && without(zips).length === 0,
			detail:
				without(places).length + without(zips).length > 0
					? `no places in ${without(places).join(', ') || 'none'}; no ZIP codes in ${without(zips).join(', ') || 'none'}`
					: undefined,
		},
		{
			name: 'Every coordinate is inside the Lower 48',
			passed: places.every(inBox) && zips.every(inBox),
			detail:
				examples(
					places,
					(place) => !inBox(place),
					(place) => `${place.name} ${place.lat}, ${place.lon}`,
				) ??
				examples(
					zips,
					(zip) => !inBox(zip),
					(zip) => `${zip.zip} ${zip.lat}, ${zip.lon}`,
				),
		},
	];
}
