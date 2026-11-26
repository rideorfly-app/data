// Makes datasets/state-borders.json from Census's cartographic boundary file. Run it once, and
// again only if Census redraws the states: borders don't move, so it isn't a daily job (and is
// a file here, not a folder in src/, because every folder in src/ is run as a job).
//
//   node src/state-borders.ts                     the newest year, 5m resolution
//   node src/state-borders.ts --year 2025 --resolution 20m

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BORDER_STATES, buildBorders, crossCheck } from './lib/borders.ts';
import { cacheName, download } from './lib/download.ts';
import { formatRows } from './lib/write.ts';
import { readZippedBytes } from './lib/zip.ts';

const root = join(import.meta.dirname, '..');

const { values } = parseArgs({
	options: {
		year: { type: 'string', default: '2025' },
		resolution: { type: 'string', default: '5m' },
	},
});

const year = values.year ?? '2025';
const resolution = values.resolution ?? '5m';

if (!/^\d{4}$/.test(year) || !/^(500k|5m|20m)$/.test(resolution)) {
	console.error('Usage: node src/state-borders.ts [--year 2025] [--resolution 500k|5m|20m]');
	process.exit(1);
}

const stem = `cb_${year}_us_state_${resolution}`;
const url = `https://www2.census.gov/geo/tiger/GENZ${year}/shp/${stem}.zip`;
const zip = await download(url, join(root, '.cache', 'state-borders', cacheName(url)));

const { rows, dropped } = buildBorders(
	await readZippedBytes(zip, `${stem}.shp`),
	await readZippedBytes(zip, `${stem}.dbf`),
	url,
);
const text = formatRows(rows);

await writeFile(join(root, 'datasets', 'state-borders.json'), text);

const polygons = rows.reduce((sum, row) => sum + row.polygons.length, 0);
const points = rows.reduce(
	(sum, row) =>
		sum +
		row.polygons.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0),
	0,
);

console.log(
	`${rows.length} of ${BORDER_STATES.length} states, ${polygons} polygons, ${points} points, ${text.length} bytes.`,
);
console.log(`Source: ${url}`);

if (dropped > 0) {
	console.log(`${dropped} rings were smaller than the precision and were left out.`);
}

// Where the places file is on this computer, test the outlines against it.
const placesFile = join(root, 'datasets', 'places', `${year}.json`);
const places = await readFile(placesFile, 'utf8').then(
	(json) =>
		JSON.parse(json) as { state: string; lat: number; lon: number; name?: string; zip?: string }[],
	() => null,
);

if (places) {
	const { checked, inside, misses } = crossCheck(rows, places);

	console.log(
		`Against ${placesFile}: ${inside} of ${checked} places fall inside their own state (${misses.length} outside).`,
	);
	console.log(`First misses: ${misses.slice(0, 12).join('; ')}`);
}
