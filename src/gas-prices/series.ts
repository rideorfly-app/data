import type { GasRegion } from '@rideorfly/engine';

/** A row's region: the nation, or one of the engine's EIA gas regions. */
export type Region = 'national' | GasRegion;

/** The regions in the order the file lists them. */
export const REGIONS: readonly Region[] = [
	'national',
	'new-england',
	'central-atlantic',
	'lower-atlantic',
	'midwest',
	'gulf-coast',
	'rocky-mountain',
	'west-coast',
	'california',
];

/**
 * EIA's weekly "Regular, All Formulations" retail gasoline series for each
 * region. The engine puts Arizona, Nevada, Oregon, and Washington in
 * `west-coast` and California in `california`, so `west-coast` is the series
 * for the West Coast *except* California.
 */
export const SERIES: Readonly<Record<string, Region>> = {
	'PET.EMM_EPMR_PTE_NUS_DPG.W': 'national',
	'PET.EMM_EPMR_PTE_R1X_DPG.W': 'new-england',
	'PET.EMM_EPMR_PTE_R1Y_DPG.W': 'central-atlantic',
	'PET.EMM_EPMR_PTE_R1Z_DPG.W': 'lower-atlantic',
	'PET.EMM_EPMR_PTE_R20_DPG.W': 'midwest',
	'PET.EMM_EPMR_PTE_R30_DPG.W': 'gulf-coast',
	'PET.EMM_EPMR_PTE_R40_DPG.W': 'rocky-mountain',
	'PET.EMM_EPMR_PTE_R5XCA_DPG.W': 'west-coast',
	'PET.EMM_EPMR_PTE_SCA_DPG.W': 'california',
};

/** Each region's weekly prices, newest week first: the Monday as `YYYY-MM-DD`, and dollars per gallon. */
export type Weekly = Map<Region, [week: string, price: number][]>;

/** Every series in EIA's file starts like this, so most lines can be skipped without parsing. */
const PREFIX = '{"series_id":"PET.EMM_EPMR_PTE_';

/**
 * Reads the weekly prices for the nine regions out of EIA's bulk petroleum
 * file, which holds one JSON line for each of its thousands of series. A week
 * with no price (EIA leaves a null) is skipped.
 */
export async function readSeries(lines: AsyncIterable<string> | Iterable<string>): Promise<Weekly> {
	const weekly: Weekly = new Map();

	for await (const line of lines) {
		if (!line.startsWith(PREFIX)) {
			continue;
		}

		const series = JSON.parse(line) as { series_id: string; data?: [string, number | null][] };
		const region = SERIES[series.series_id];

		if (!region) {
			continue;
		}

		weekly.set(
			region,
			(series.data ?? [])
				.filter((entry): entry is [string, number] => typeof entry[1] === 'number')
				.map(([day, price]) => [`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`, price]),
		);
	}

	return weekly;
}

/** A region's price for one week, or undefined when EIA has none. */
export function priceFor(weekly: Weekly, region: Region, week: string): number | undefined {
	return weekly.get(region)?.find(([day]) => day === week)?.[1];
}

/** The week `count` weeks before `week`. */
export function weeksBefore(week: string, count: number): string {
	const day = new Date(`${week}T00:00:00Z`);

	day.setUTCDate(day.getUTCDate() - 7 * count);

	return day.toISOString().slice(0, 10);
}
