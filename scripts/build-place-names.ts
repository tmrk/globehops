/** Build optional Hungarian/Swedish airport-city exonyms from pinned Natural Earth populated places. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeDataset } from '../src/data/airports.ts';
import { atomicWrite, loadNaturalEarth } from './build-country-labels.ts';
import { buildPlaceNames, decodePlaceNameOverrides, PLACE_NAMES_SOURCE_URL } from './lib/placeNames.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = resolve(ROOT, '.cache/naturalearth/ne_10m_populated_places.geojson');

export async function main(args = process.argv.slice(2)): Promise<void> {
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const offline = args.includes('--offline'),
    refresh = args.includes('--refresh');
  if (
    paths.length > 1 ||
    (offline && refresh) ||
    args.some((arg) => arg.startsWith('--') && arg !== '--offline' && arg !== '--refresh')
  )
    throw new Error('Usage: node scripts/build-place-names.ts [--offline | --refresh] [places.geojson]');
  const source = paths.length
    ? { text: await readFile(resolve(paths[0]), 'utf8'), downloaded: false }
    : await loadNaturalEarth(PLACE_NAMES_SOURCE_URL, CACHE, offline, refresh);
  const airports = decodeDataset(
    JSON.parse(await readFile(resolve(ROOT, 'src/data/generated/airports.json'), 'utf8')),
  ).airports;
  const overrides = decodePlaceNameOverrides(
    JSON.parse(await readFile(resolve(ROOT, 'data/place-names.json'), 'utf8')),
  );
  const raw: unknown = JSON.parse(source.text);
  // Guard against replacing production data with a valid but truncated source.
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('features' in raw) ||
    !Array.isArray(raw.features) ||
    raw.features.length < 7000
  )
    throw new Error('Too few populated places; expected at least 7,000');
  const { dataset, stats } = buildPlaceNames(raw, airports, overrides);
  if (stats.matchedCities < 1000) throw new Error('Too few matched airport cities; expected at least 1,000');
  const output = JSON.stringify(dataset) + '\n';
  if (source.downloaded) await atomicWrite(CACHE, source.text);
  await atomicWrite(resolve(ROOT, 'src/data/generated/city-names.json'), output);
  console.log(
    `Cities: ${stats.matchedCities}/${stats.cities} matched; ${stats.ambiguousCities} ambiguous skipped. Exonyms: hu ${Object.keys(dataset.names.hu).length}, sv ${Object.keys(dataset.names.sv).length}. Scheduled airports: ${stats.matchedScheduled}/${stats.scheduled} (${((100 * stats.matchedScheduled) / stats.scheduled).toFixed(1)}%). ${Buffer.byteLength(output)} bytes.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
