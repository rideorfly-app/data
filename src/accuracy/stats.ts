/** The value `fraction` of the way through `sorted`, which must be in order; 0.5 is the median. */
export function quantile(sorted: readonly number[], fraction: number): number {
	const position = (sorted.length - 1) * fraction;
	const below = Math.floor(position);
	const above = Math.ceil(position);

	return (sorted[below] ?? 0) + ((sorted[above] ?? 0) - (sorted[below] ?? 0)) * (position - below);
}

/** The middle of `values`, in any order. Zero when there are none. */
export function median(values: readonly number[]): number {
	return quantile(
		[...values].sort((a, b) => a - b),
		0.5,
	);
}

export function round(value: number, places: number): number {
	const scale = 10 ** places;

	return Math.round(value * scale) / scale;
}
