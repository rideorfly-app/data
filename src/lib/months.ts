/** A calendar month as `YYYY-MM`, the way the dataset files are named. */
export type Month = string;

/** Throws unless `value` looks like `YYYY-MM`. */
export function parseMonth(value: string): Month {
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
		throw new Error(`"${value}" isn't a month. Use YYYY-MM, such as 2026-08.`);
	}

	return value;
}

/** The month `count` months after `month`; negative counts go back. */
export function addMonths(month: Month, count: number): Month {
	const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;

	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Every month from `from` through `to`, oldest first. */
export function monthsBetween(from: Month, to: Month): Month[] {
	const months: Month[] = [];

	for (let month = from; month <= to; month = addMonths(month, 1)) {
		months.push(month);
	}

	return months;
}
