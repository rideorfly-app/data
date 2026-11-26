/** What a job makes for one update: the file to write and a description for the pull request. */
export interface Build {
	/** Where the file goes, relative to the repo root. */
	path: string;
	contents: string;

	/** Markdown for the pull request's description. */
	summary: string;
}

/**
 * A dataset's job. It answers "is there new data?" and, if so, "make its file".
 * Every job is a folder in `src/` with a default export of this shape.
 *
 * An update is named by a string that suits the dataset: a month (`2026-08`),
 * a week (`2026-10-26`, the Monday), or a year (`2025`, `FY2027`).
 */
export interface Job {
	name: string;

	/** The next update the source has that the repo doesn't, or null when it's up to date. */
	check(): Promise<{ next: string | null; note: string }>;

	/** Makes the file for one update. Throws, and so writes nothing, if a check fails. */
	build(update: string): Promise<Build>;
}
