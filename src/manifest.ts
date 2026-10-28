// Writes the manifest for a release from the files in `datasets/`.
//
//   node src/manifest.ts 2026-10-14            prints it
//   node src/manifest.ts 2026-10-14 out.json   writes it to a file

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildManifest, formatManifest } from './lib/manifest.ts';

const [release, out] = process.argv.slice(2);

if (!release) {
	console.error(
		'Usage: node src/manifest.ts RELEASE [OUTPUT_FILE]   (RELEASE is the date, such as 2026-10-14)',
	);
	process.exit(1);
}

const text = formatManifest(await buildManifest(join(import.meta.dirname, '..'), release));

if (out) {
	await writeFile(out, text);
	console.log(`Wrote ${out}`);
} else {
	process.stdout.write(text);
}
