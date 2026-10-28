import { describe, expect, it } from 'vitest';
import { buildRegion, contains, type Polygon, regionsAt } from '../../src/lib/geometry.ts';

/** A square from (x, y) with the given side, as a closed ring. */
const square = (x: number, y: number, side: number): Polygon[number] => [
	[x, y],
	[x + side, y],
	[x + side, y + side],
	[x, y + side],
	[x, y],
];

describe('contains', () => {
	const box = buildRegion('box', [[square(0, 0, 10)]]);

	it('says yes inside and no outside, on every side', () => {
		expect(contains(box, 5, 5)).toBe(true);
		expect(contains(box, 15, 5)).toBe(false);
		expect(contains(box, -5, 5)).toBe(false);
		expect(contains(box, 5, 15)).toBe(false);
		expect(contains(box, 5, -5)).toBe(false);
	});

	it('treats a hole as outside, and the land around it as inside', () => {
		const ring = buildRegion('ring', [[square(0, 0, 10), square(4, 4, 2)]]);

		expect(contains(ring, 5, 5)).toBe(false);
		expect(contains(ring, 2, 5)).toBe(true);
		expect(contains(ring, 8, 5)).toBe(true);
	});

	it('handles several separate pieces, and a concave shape', () => {
		const pieces = buildRegion('pieces', [[square(0, 0, 2)], [square(10, 10, 2)]]);
		const ell = buildRegion('ell', [
			[
				[
					[0, 0],
					[10, 0],
					[10, 3],
					[3, 3],
					[3, 10],
					[0, 10],
					[0, 0],
				],
			],
		]);

		expect(contains(pieces, 1, 1)).toBe(true);
		expect(contains(pieces, 11, 11)).toBe(true);
		expect(contains(pieces, 6, 6)).toBe(false);
		expect(contains(ell, 1, 8)).toBe(true);
		expect(contains(ell, 8, 1)).toBe(true);
		expect(contains(ell, 8, 8)).toBe(false);
	});

	it('works across negative coordinates and a ring that spans many latitude bands', () => {
		const wide = buildRegion('wide', [[square(-110, 30, 20)]]);

		expect(contains(wide, -100, 40)).toBe(true);
		expect(contains(wide, -100, 49.95)).toBe(true);
		expect(contains(wide, -100, 50.05)).toBe(false);
		expect(contains(wide, -100, 29.95)).toBe(false);
	});

	it('finds a shape thinner than one latitude band, and a point just above or below it', () => {
		const sliver = buildRegion('sliver', [
			[
				[
					[0, 5.01],
					[10, 5.01],
					[10, 5.03],
					[0, 5.03],
					[0, 5.01],
				],
			],
		]);

		expect(contains(sliver, 5, 5.02)).toBe(true);
		expect(contains(sliver, 5, 5.04)).toBe(false);
		expect(contains(sliver, 5, 5.0)).toBe(false);
	});

	it('is false for a point at a latitude no edge reaches', () => {
		expect(contains(buildRegion('empty', []), 0, 0)).toBe(false);
	});
});

describe('regionsAt', () => {
	it('names every area that holds the point, so overlaps and gaps can be told apart from a clean hit', () => {
		const a = buildRegion('a', [[square(0, 0, 10)]]);
		const b = buildRegion('b', [[square(5, 5, 10)]]);

		expect(regionsAt([a, b], 2, 2)).toEqual(['a']);
		expect(regionsAt([a, b], 7, 7)).toEqual(['a', 'b']);
		expect(regionsAt([a, b], 20, 20)).toEqual([]);
	});
});
