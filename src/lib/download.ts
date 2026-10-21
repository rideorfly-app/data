import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** True when the address answers a HEAD request with success, without downloading it. */
export async function exists(url: string): Promise<boolean> {
	const response = await fetch(url, { method: 'HEAD' });

	return response.ok;
}

/**
 * Downloads `url` to `destination` and returns it. A file that's already there
 * is kept, so a rerun doesn't fetch 30 MB again. It's written under a
 * temporary name first, so a stopped download is never mistaken for a whole one.
 */
export async function download(url: string, destination: string): Promise<string> {
	if (
		await stat(destination).then(
			() => true,
			() => false,
		)
	) {
		return destination;
	}

	const response = await fetch(url);

	if (!response.ok || !response.body) {
		throw new Error(`Couldn't download ${url}: ${response.status} ${response.statusText}`);
	}

	await mkdir(dirname(destination), { recursive: true });

	const partial = `${destination}.part`;

	try {
		await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
		await rename(partial, destination);
	} catch (error) {
		await rm(partial, { force: true });
		throw error;
	}

	return destination;
}
