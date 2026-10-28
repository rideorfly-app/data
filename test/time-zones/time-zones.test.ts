import { describe, expect, it } from 'vitest';
import { formatRows } from '../../src/lib/write.ts';
import { PROBES, runChecks } from '../../src/time-zones/checks.ts';
import { nextYear } from '../../src/time-zones/index.ts';
import {
	ARIZONA,
	IANA,
	type Located,
	parseZones,
	placeRows,
	timeZoneAt,
} from '../../src/time-zones/read.ts';
import { summarize } from '../../src/time-zones/summary.ts';

const ring = (west: number, south: number, east: number, north: number) => [
	[west, south],
	[east, south],
	[east, north],
	[west, north],
	[west, south],
];

/** Four made-up zones side by side: Eastern 0 to 10 degrees east, Central 10 to 20, Mountain 20 to 30, Pacific 30 to 40, plus a hole in Central. */
const geojson = JSON.stringify({
	type: 'FeatureCollection',
	features: [
		{
			properties: { zone: 'Eastern' },
			geometry: { type: 'Polygon', coordinates: [ring(0, 0, 10, 10)] },
		},
		{
			properties: { zone: 'Central' },
			geometry: { type: 'Polygon', coordinates: [ring(10, 0, 20, 10), ring(14, 4, 16, 6)] },
		},
		{
			properties: { zone: 'Mountain' },
			geometry: {
				type: 'MultiPolygon',
				coordinates: [[ring(20, 0, 30, 5)], [ring(20, 6, 30, 10)]],
			},
		},
		{
			properties: { zone: 'Pacific' },
			geometry: { type: 'Polygon', coordinates: [ring(30, 0, 40, 10)] },
		},
		{
			properties: { zone: 'Alaska' },
			geometry: { type: 'Polygon', coordinates: [ring(50, 0, 60, 10)] },
		},
	],
});

const regions = parseZones(geojson);
const point = (
	kind: 'place' | 'zip',
	id: string,
	state: string,
	lon: number,
	lat: number,
): Located =>
	kind === 'place' ? { kind, geoid: id, state, lat, lon } : { kind, zip: id, state, lat, lon };

describe('parseZones', () => {
	it('reads polygons and multipolygons, named by zone', () => {
		expect(regions.map((region) => region.name)).toEqual([
			'Eastern',
			'Central',
			'Mountain',
			'Pacific',
			'Alaska',
		]);
	});

	it('refuses a file that is not a feature collection, a feature with no zone, or one with no shape', () => {
		expect(() => parseZones('{"type":"Feature"}')).toThrow(/feature collection/);
		expect(() =>
			parseZones('{"type":"FeatureCollection","features":[{"properties":{},"geometry":null}]}'),
		).toThrow(/no zone name/);
		expect(() =>
			parseZones(
				'{"type":"FeatureCollection","features":[{"properties":{"zone":"Central"},"geometry":{"type":"Point","coordinates":[0,0]}}]}',
			),
		).toThrow(/Central time zone has no polygon/);
	});
});

describe('timeZoneAt', () => {
	it('names the standard time zone of the zone that holds the point', () => {
		expect(timeZoneAt(regions, 'NY', 5, 5)).toBe(IANA.Eastern);
		expect(timeZoneAt(regions, 'IL', 12, 5)).toBe(IANA.Central);
		expect(timeZoneAt(regions, 'CO', 25, 2)).toBe(IANA.Mountain);
		expect(timeZoneAt(regions, 'CO', 25, 8)).toBe(IANA.Mountain);
		expect(timeZoneAt(regions, 'CA', 35, 5)).toBe(IANA.Pacific);
	});

	it('puts a hole in a zone outside it', () => {
		expect(timeZoneAt(regions, 'IL', 15, 5)).toBeNull();
	});

	it('gives Arizona standard time all year, and nowhere else', () => {
		expect(timeZoneAt(regions, 'AZ', 25, 2)).toBe(ARIZONA);
		expect(timeZoneAt(regions, 'NM', 25, 2)).toBe(IANA.Mountain);
		expect(timeZoneAt(regions, 'AZ', 35, 5)).toBe(IANA.Pacific);
	});

	it('gives nothing for open water, a zone outside the Lower 48, or two overlapping zones', () => {
		expect(timeZoneAt(regions, 'FL', 45, 5)).toBeNull();
		expect(timeZoneAt(regions, 'AK', 55, 5)).toBeNull();

		const overlapping = parseZones(
			JSON.stringify({
				type: 'FeatureCollection',
				features: [
					{
						properties: { zone: 'Eastern' },
						geometry: { type: 'Polygon', coordinates: [ring(0, 0, 10, 10)] },
					},
					{
						properties: { zone: 'Central' },
						geometry: { type: 'Polygon', coordinates: [ring(5, 0, 15, 10)] },
					},
				],
			}),
		);

		expect(timeZoneAt(overlapping, 'KS', 7, 5)).toBeNull();
	});
});

describe('placeRows', () => {
	const located = [
		point('place', '0100124', 'NY', 5, 5),
		point('zip', '60601', 'IL', 12, 5),
		point('zip', '99999', 'FL', 45, 5),
		point('place', '0400000', 'AZ', 25, 2),
	];

	it('keeps the places file’s order and keys, with the zone name last', () => {
		expect(formatRows(placeRows(regions, located).rows).split('\n').slice(1, -2)).toEqual([
			'{"kind":"place","geoid":"0100124","timeZone":"America/New_York"},',
			'{"kind":"zip","zip":"60601","timeZone":"America/Chicago"},',
			'{"kind":"place","geoid":"0400000","timeZone":"America/Phoenix"}',
		]);
	});

	it('sets aside what no zone holds, so a check can name it', () => {
		expect(placeRows(regions, located).unplaced.map((item) => item.zip)).toEqual(['99999']);
	});
});

describe('runChecks', () => {
	// Probes use real coordinates, so the made-up zones above fail them: that is what they are for.
	const located = [point('place', '1', 'NY', 5, 5), point('zip', '60601', 'IL', 12, 5)];
	const names = (checks: { name: string; passed: boolean }[]) =>
		checks.filter((check) => !check.passed).map((check) => check.name);

	it('fails the known-city check against zones that are not the real ones', () => {
		expect(names(runChecks(regions, located, placeRows(regions, located)))).toEqual(
			expect.arrayContaining([expect.stringContaining('Known cities')]),
		);
	});

	it('catches a point in no zone, a missing zone in the file, and a thin zone', () => {
		const withWater = [...located, point('zip', '99999', 'FL', 45, 5)];
		const failures = names(runChecks(regions, withWater, placeRows(regions, withWater)));

		expect(failures).toEqual(expect.arrayContaining([expect.stringContaining('exactly one zone')]));
		expect(failures).toEqual(expect.arrayContaining([expect.stringContaining('plausible number')]));
		expect(names(runChecks(regions.slice(1), located, placeRows(regions, located)))).toEqual(
			expect.arrayContaining([expect.stringContaining('four zones')]),
		);
	});

	it('catches a repeated row', () => {
		const twice = [...located, located[0] as Located];

		expect(names(runChecks(regions, twice, placeRows(regions, twice)))).toEqual(
			expect.arrayContaining([expect.stringContaining('one row, with no repeats')]),
		);
	});

	it('catches an Arizona place that did not get Phoenix time', () => {
		const arizona = [point('zip', '85001', 'AZ', 35, 5)];

		expect(names(runChecks(regions, arizona, placeRows(regions, arizona)))).toEqual(
			expect.arrayContaining([expect.stringContaining('Arizona is the only state')]),
		);
	});

	it('lists a probe for each awkward case, all in the Lower 48', () => {
		expect(PROBES.map((probe) => probe.name)).toEqual(
			expect.arrayContaining(['Evansville', 'West Wendover', 'Phoenix', 'Lewiston', 'Pensacola']),
		);
		expect(
			PROBES.every(
				(probe) => probe.lat > 24 && probe.lat < 50 && probe.lon < -66 && probe.lon > -125,
			),
		).toBe(true);
	});
});

describe('summarize', () => {
	const located = [
		point('place', '1', 'IN', 5, 5),
		point('zip', '47701', 'IN', 12, 5),
		point('zip', '85001', 'AZ', 25, 2),
	];
	const placed = placeRows(regions, located);

	it('counts each zone, names the split states, and states the Navajo Nation gap', () => {
		const text = summarize(2025, located, placed, [], null, '2024-06-28');

		expect(text).toContain('## Time zones for the 2025 places');
		expect(text).toContain('boundaries as of 2024-06-28');
		expect(text).toContain('| America/New_York | 1 | 0 |');
		expect(text).toContain('| America/Phoenix | 0 | 1 |');
		expect(text).toContain('IN (New_York, Chicago)');
		expect(text).toContain('Navajo Nation');
	});

	it('says how many rows changed zone since the year before', () => {
		const before = [
			{ kind: 'place', geoid: '1', timeZone: IANA.Central },
			{ kind: 'zip', zip: '47701', timeZone: IANA.Central },
		] as const;

		expect(summarize(2025, located, placed, [], before, 'x')).toContain('1 rows changed zone.');
	});
});

describe('nextYear', () => {
	it('says to make the first one by hand when the repo has none', () => {
		expect(nextYear([], ['2025'])).toEqual({
			next: null,
			note: expect.stringContaining('No years in the repo yet'),
		});
	});

	it('offers the next year of places that has no time zones, and knows when it is up to date', () => {
		expect(nextYear(['2024'], ['2024', '2025']).next).toBe('2025');
		expect(nextYear(['2025'], ['2024', '2025'])).toEqual({
			next: null,
			note: expect.stringContaining('Up to date: 2025'),
		});
	});
});
