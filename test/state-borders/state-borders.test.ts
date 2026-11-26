import { describe, expect, it } from 'vitest';
import { checkBorders } from '../../src/hand-kept/checks.ts';
import { BORDER_STATES, buildBorders, crossCheck, inState } from '../../src/lib/borders.ts';
import { inRing, readRings, readTable, signedArea, toPolygons } from '../../src/lib/shapefile.ts';
import { buildDbf, buildShp, hole, madeUpStates, square } from './shapes.ts';

describe('readRings', () => {
	it('reads the rings of each record, and gives a record with no shape no rings', () => {
		const shp = buildShp([[square(0, 0, 2), hole(0.5, 0.5, 1)], [], [square(10, 10, 1)]]);

		expect(readRings(shp)).toEqual([[square(0, 0, 2), hole(0.5, 0.5, 1)], [], [square(10, 10, 1)]]);
	});

	it('refuses a file that is not a shapefile', () => {
		const shp = buildShp([[square(0, 0, 1)]]);

		shp.writeInt32BE(1234, 0);

		expect(() => readRings(shp)).toThrow(/file code is wrong/);
		expect(() => readRings(Buffer.alloc(10))).toThrow(/file code is wrong/);
	});

	it('refuses a file that is shorter than it says (a stopped download)', () => {
		const shp = buildShp([[square(0, 0, 1)], [square(5, 5, 1)]]);

		expect(() => readRings(shp.subarray(0, shp.length - 20))).toThrow(/Is the download complete/);
	});

	it('refuses lines and points, which are not boundaries', () => {
		const shp = buildShp([[square(0, 0, 1)]]);

		shp.writeInt32LE(3, 32);

		expect(() => readRings(shp)).toThrow(/shape type 3, not polygons/);
	});

	it('refuses a record of another shape type', () => {
		const shp = buildShp([[square(0, 0, 1)]]);

		shp.writeInt32LE(8, 108);

		expect(() => readRings(shp)).toThrow(/record has shape type 8/);
	});

	it('refuses a record with more points than room', () => {
		const shp = buildShp([[square(0, 0, 1)]]);

		shp.writeInt32LE(5000, 108 + 40);

		expect(() => readRings(shp)).toThrow(/more points than it has room for/);
	});

	it('refuses a part that starts outside its record', () => {
		const shp = buildShp([[square(0, 0, 1)]]);

		shp.writeInt32LE(99, 108 + 44);

		expect(() => readRings(shp)).toThrow(/part points outside/);
	});

	it('refuses a record that runs past the end of the file', () => {
		const shp = buildShp([[square(0, 0, 1)]]);

		shp.writeInt32BE(10_000, 104);

		expect(() => readRings(shp)).toThrow(/runs past the end/);
	});
});

describe('readTable', () => {
	it('reads each record by field name, trimmed', () => {
		const dbf = buildDbf([
			{ STUSPS: 'CO', NAME: 'Colorado' },
			{ STUSPS: 'UT', NAME: 'Utah' },
		]);

		expect(readTable(dbf)).toEqual([
			{ STUSPS: 'CO', NAME: 'Colorado' },
			{ STUSPS: 'UT', NAME: 'Utah' },
		]);
	});

	it('refuses a table with a deleted record, which would shift the shapes', () => {
		expect(() => readTable(buildDbf([{ A: 'x' }, { A: 'y' }], [1]))).toThrow(/deleted record/);
	});

	it('refuses a table shorter than it says', () => {
		const dbf = buildDbf([{ A: 'xx' }, { A: 'yy' }]);

		expect(() => readTable(dbf.subarray(0, dbf.length - 3))).toThrow(/shorter than it says/);
	});
});

describe('shapes', () => {
	it('knows clockwise from counterclockwise', () => {
		expect(signedArea(square(0, 0, 2))).toBe(-8);
		expect(signedArea(hole(0, 0, 2))).toBe(8);
	});

	it('knows inside from outside a ring', () => {
		const ring = square(0, 0, 2);

		expect(inRing(ring, [1, 1])).toBe(true);
		expect(inRing(ring, [3, 1])).toBe(false);
		expect(inRing(ring, [1, -0.1])).toBe(false);
	});

	it('makes each clockwise ring a polygon and gives a hole to the polygon around it', () => {
		const polygons = toPolygons([
			square(0, 0, 10),
			hole(1, 1, 2),
			square(20, 20, 5),
			hole(21, 21, 1),
			square(40, 40, 1),
		]);

		expect(polygons).toEqual([
			[square(0, 0, 10), hole(1, 1, 2)],
			[square(20, 20, 5), hole(21, 21, 1)],
			[square(40, 40, 1)],
		]);
	});

	it('refuses a hole with nothing around it', () => {
		expect(() => toPolygons([hole(0, 0, 1)])).toThrow(/no outline around it/);
	});
});

/** A boundary file for the 49 made-up states plus Alaska, Hawaii, and Puerto Rico, which must be left out. */
function boundaryFile() {
	const states = madeUpStates();
	const extra = ['AK', 'HI', 'PR'].map((code, i) => ({ code, ring: square(-70 + i, 20, 0.5) }));
	const records = [...states.map((row) => row.polygons.flat()), ...extra.map(({ ring }) => [ring])];
	const table = [
		...states.map((row) => ({ STUSPS: row.state, NAME: row.name })),
		...extra.map(({ code }) => ({ STUSPS: code, NAME: `Elsewhere ${code}` })),
	];

	return { records, table };
}

describe('buildBorders', () => {
	it('keeps the 49 states and DC, sorted by code, and leaves out Alaska, Hawaii, and Puerto Rico', () => {
		const { records, table } = boundaryFile();
		const { rows, dropped } = buildBorders(
			buildShp(records),
			buildDbf(table),
			'https://example.test/a.zip',
		);

		expect(rows.map((row) => row.state)).toEqual([...BORDER_STATES]);
		expect(BORDER_STATES).toHaveLength(49);
		expect(BORDER_STATES).not.toContain('AK');
		expect(rows[0]).toMatchObject({
			state: 'AL',
			name: 'State AL',
			source: 'https://example.test/a.zip',
		});
		expect(dropped).toBe(0);
	});

	it('sorts rows that arrive in another order', () => {
		const { records, table } = boundaryFile();

		records.reverse();
		table.reverse();

		const { rows } = buildBorders(buildShp(records), buildDbf(table), 'https://example.test/a.zip');

		expect(rows.map((row) => row.state)).toEqual([...BORDER_STATES]);
	});

	it('rounds points to four places, drops repeats the rounding makes, and keeps the ring closed', () => {
		const { records, table } = boundaryFile();

		records[0] = [
			[
				[-100.000001, 30.000004],
				[-100.00002, 31.234567],
				[-100.000024, 31.234569],
				[-99.123456, 31.2],
				[-100.000001, 30.000004],
			],
		];

		const { rows } = buildBorders(buildShp(records), buildDbf(table), 'https://example.test/a.zip');

		expect(rows[0]?.polygons[0]?.[0]).toEqual([
			[-100, 30],
			[-100, 31.2346],
			[-99.1235, 31.2],
			[-100, 30],
		]);
	});

	it('rounds a tie away from zero for a longitude, as toFixed does (Math.round would not)', () => {
		const { records, table } = boundaryFile();

		// Census's longitudes have five decimals, so ties like -88.05325 are common in the real file.
		// toFixed gives -88.0533; Math.round would give -88.0532.
		records[0] = [
			[
				[-88.05325, 41.0018],
				[-87, 41.0018],
				[-87, 40],
				[-88.05325, 41.0018],
			],
		];

		const { rows } = buildBorders(buildShp(records), buildDbf(table), 'https://example.test/a.zip');

		expect(rows[0]?.polygons[0]?.[0]?.map(([x]) => x)).toEqual([-88.0533, -87, -87, -88.0533]);
	});

	it('leaves out a ring that rounding shrinks to a speck, and says how many', () => {
		const { records, table } = boundaryFile();

		records[0] = [square(-100, 30, 1), square(-90, 30, 0.00001)];

		const { rows, dropped } = buildBorders(
			buildShp(records),
			buildDbf(table),
			'https://example.test/a.zip',
		);

		expect(rows[0]?.polygons).toHaveLength(1);
		expect(dropped).toBe(1);
	});

	it('refuses a file that is missing a state', () => {
		const { records, table } = boundaryFile();

		records.splice(5, 1);
		table.splice(5, 1);

		expect(() => buildBorders(buildShp(records), buildDbf(table), 'x')).toThrow(/missing/);
	});

	it('refuses shapes and a table that do not line up', () => {
		const { records, table } = boundaryFile();

		expect(() => buildBorders(buildShp(records), buildDbf(table.slice(1)), 'x')).toThrow(
			/shapes but its table has/,
		);
	});
});

describe('inState and crossCheck', () => {
	const donut = { polygons: [[square(0, 0, 10), hole(4, 4, 2)]] };

	it('puts a point in a state when it is inside an outline and not in a hole', () => {
		expect(inState(donut, [1, 1])).toBe(true);
		expect(inState(donut, [5, 5])).toBe(false);
		expect(inState(donut, [11, 5])).toBe(false);
	});

	it('counts places inside their own state, and names the ones outside', () => {
		const rows = [
			{ state: 'AA', name: 'A', source: 'x', polygons: [[square(0, 0, 10)]] },
			{ state: 'BB', name: 'B', source: 'x', polygons: [[square(20, 0, 10)]] },
		];

		const places = [
			{ name: 'Inside', state: 'AA', lat: 5, lon: 5 },
			{ name: 'Wrong state', state: 'AA', lat: 5, lon: 25 },
			{ zip: '12345', state: 'BB', lat: 50, lon: 25 },
			{ name: 'Alaska', state: 'AK', lat: 60, lon: 5 },
		];

		expect(crossCheck(rows, places)).toEqual({
			checked: 3,
			inside: 1,
			misses: ['Wrong state, AA', '12345, BB'],
		});
	});
});

describe('checkBorders', () => {
	const failing = (rows: object[]): string[] =>
		checkBorders(rows as ReturnType<typeof madeUpStates>)
			.filter((check) => !check.passed)
			.map((check) => check.name);

	it('passes for outlines of all 49 states with their well-known cities inside', () => {
		expect(failing(madeUpStates())).toEqual([]);
	});

	it('catches a missing state, a repeat, and rows out of order', () => {
		const rows = madeUpStates();

		expect(failing(rows.slice(1))).toEqual([expect.stringContaining('exactly one row for each')]);
		expect(failing([rows[1], rows[0], ...rows.slice(2)] as object[])).toEqual([
			expect.stringContaining('exactly one row for each'),
		]);
	});

	it('catches a row with an extra key or keys in another order', () => {
		const rows = madeUpStates();

		expect(failing([{ ...rows[0], extra: 1 }, ...rows.slice(1)])).toEqual([
			expect.stringContaining('exactly the expected keys'),
		]);
		expect(
			failing([
				{ name: 'x', state: 'AL', source: rows[0]?.source, polygons: rows[0]?.polygons },
				...rows.slice(1),
			]),
		).toContainEqual(expect.stringContaining('exactly the expected keys'));
	});

	it('catches a blank name or a source that is not a secure link', () => {
		const rows = madeUpStates();

		expect(failing([{ ...rows[0], name: '' }, ...rows.slice(1)])).toEqual([
			expect.stringContaining('names its state and its source link'),
		]);
		expect(failing([{ ...rows[0], source: 'http://example.test' }, ...rows.slice(1)])).toEqual([
			expect.stringContaining('names its state and its source link'),
		]);
	});

	it('catches a ring that is not closed, is too short, or has points outside the Lower 48', () => {
		const rows = madeUpStates();
		const ring = rows[0]?.polygons[0]?.[0] ?? [];
		const bad = (replacement: unknown) => [
			{ ...rows[0], polygons: [[replacement]] },
			...rows.slice(1),
		];

		expect(failing(bad(ring.slice(0, -1)))).toContainEqual(
			expect.stringContaining('ring is closed'),
		);
		expect(failing(bad(ring.slice(0, 3)))).toContainEqual(
			expect.stringContaining('ring is closed'),
		);
		expect(
			failing(bad([...ring.slice(0, -1).map(([x, y]) => [y, x]), [24.5, -123]])),
		).toContainEqual(expect.stringContaining('ring is closed'));
		expect(failing([{ ...rows[0], polygons: [] }, ...rows.slice(1)])).toContainEqual(
			expect.stringContaining('at least one polygon'),
		);
	});

	it('catches outsides drawn counterclockwise and holes drawn clockwise', () => {
		const rows = madeUpStates();
		const outside = rows[0]?.polygons[0]?.[0] ?? [];

		expect(
			failing([{ ...rows[0], polygons: [[[...outside].reverse()]] }, ...rows.slice(1)]),
		).toEqual([expect.stringContaining('clockwise')]);
		expect(
			failing([{ ...rows[0], polygons: [[outside, square(-122.9, 24.6, 0.2)]] }, ...rows.slice(1)]),
		).toEqual([expect.stringContaining('clockwise')]);
	});

	it('catches a name paired with the wrong shape', () => {
		const rows = madeUpStates();
		const colorado = rows.findIndex((row) => row.state === 'CO');
		const utah = rows.findIndex((row) => row.state === 'UT');
		const swapped = rows.map((row) => ({ ...row }));

		swapped[colorado] = {
			...rows[colorado],
			polygons: rows[utah]?.polygons,
		} as (typeof rows)[number];
		swapped[utah] = { ...rows[utah], polygons: rows[colorado]?.polygons } as (typeof rows)[number];

		expect(failing(swapped)).toEqual([expect.stringContaining('Well-known cities')]);
	});

	it('catches a well-known city that falls in two states', () => {
		const rows = madeUpStates();
		const co = rows.findIndex((row) => row.state === 'CO');
		const wy = rows.findIndex((row) => row.state === 'WY');
		const overlapping = rows.map((row) => ({ ...row }));

		overlapping[wy] = { ...rows[wy], polygons: rows[co]?.polygons } as (typeof rows)[number];

		expect(failing(overlapping)).toEqual([expect.stringContaining('Well-known cities')]);
	});
});
