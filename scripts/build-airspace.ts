/** Builds `src/data/generated/airspace.json` from the advisory list and pinned Natural Earth polygons. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COUNTRY_LABEL_SOURCE_URL, MARINE_LABEL_SOURCE_URL } from './lib/countryLabels.ts';
import { atomicWrite, loadNaturalEarth } from './build-country-labels.ts';
import { buildAirspace, decodeAdvisories, validateAirspace } from './lib/airspace.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ADVISORIES_PATH = resolve(ROOT, 'data/airspace-advisories.json');
// The same pinned, cached sources as `npm run labels:build`; nothing new is downloaded.
const COUNTRIES_CACHE = resolve(ROOT, '.cache/naturalearth/ne_50m_admin_0_countries.geojson');
const MARINE_CACHE = resolve(ROOT, '.cache/naturalearth/ne_50m_geography_marine_polys.geojson');
const OUTPUT_PATH = resolve(ROOT, 'src/data/generated/airspace.json');
const USAGE = 'Usage: node scripts/build-airspace.ts [--offline | --refresh]';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const offline = args.includes('--offline');
  const refresh = args.includes('--refresh');
  if (args.some((arg) => arg !== '--offline' && arg !== '--refresh') || (offline && refresh)) throw new Error(USAGE);
  const advisories = decodeAdvisories(JSON.parse(await readFile(ADVISORIES_PATH, 'utf8')));
  const countries = await loadNaturalEarth(COUNTRY_LABEL_SOURCE_URL, COUNTRIES_CACHE, offline, refresh);
  const marine = await loadNaturalEarth(MARINE_LABEL_SOURCE_URL, MARINE_CACHE, offline, refresh);
  const dataset = buildAirspace(advisories, JSON.parse(countries.text), JSON.parse(marine.text));
  const points = validateAirspace(dataset);
  const output = JSON.stringify(dataset) + '\n';
  if (countries.downloaded) await atomicWrite(COUNTRIES_CACHE, countries.text);
  if (marine.downloaded) await atomicWrite(MARINE_CACHE, marine.text);
  await atomicWrite(OUTPUT_PATH, output);
  console.log(`Airspace: ${dataset.zones.length} zones, ${points} points, ${Buffer.byteLength(output)} bytes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
