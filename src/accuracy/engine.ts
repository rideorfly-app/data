/**
 * What an entry of `node_modules/.package-lock.json` says about the engine.
 * That file is npm's record of what it installed.
 */
export interface InstalledPackage {
	version?: string;
	resolved?: string;

	/** True when npm linked a folder on this computer instead of installing a copy. */
	link?: boolean;
}

/** A commit's first seven characters, or the whole text when it has none. */
const short = (text: string) =>
	text.includes('#') ? (text.split('#')[1] ?? text).slice(0, 7) : text;

/** The engine `package.json` asks for: a commit until the engine is on npm, the version after. */
export function pinnedEngine(spec: string): string {
	return short(spec);
}

/** The engine npm actually installed, or null for a link to a local folder or no record at all. */
export function installedEngine(entry: InstalledPackage | undefined): string | null {
	if (!entry || entry.link) {
		return null;
	}

	return entry.resolved?.includes('#') ? short(entry.resolved) : (entry.version ?? null);
}

/**
 * The engine a report may name. Throws unless the installed engine is the
 * pinned one, because the report's `engine` line comes from the pin, and a
 * report made with some other engine would then name the wrong code.
 */
export function checkedEngine(spec: string, entry: InstalledPackage | undefined): string {
	const pinned = pinnedEngine(spec);
	const installed = installedEngine(entry);

	if (installed !== pinned) {
		throw new Error(
			`The report would name engine ${pinned}, but node_modules holds ${installed ?? 'a local link or an engine npm has no record of'}. Run npm install so they match, then try again.`,
		);
	}

	return pinned;
}
