import type { Month } from './months.ts';

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
 */
export interface Job {
	name: string;

	/** The next update the source has that the repo doesn't, or null when it's up to date. */
	check(): Promise<{ next: Month | null; note: string }>;

	/** Makes the file for one update. Throws, and so writes nothing, if a check fails. */
	build(update: Month): Promise<Build>;
}
