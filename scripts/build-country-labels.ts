/** Builds compact multilingual country and marine labels from pinned Natural Earth sources. */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  COUNTRY_LABEL_SOURCE_URL,
  MARINE_LABEL_SOURCE_URL,
  buildCountryLabels,
  validateCountryLabels,
} from './lib/countryLabels.ts';
import { decodePlaceNameOverrides } from './lib/placeNames.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE_PATH = resolve(ROOT, '.cache/naturalearth/ne_50m_admin_0_countries.geojson');
const MARINE_CACHE_PATH = resolve(ROOT, '.cache/naturalearth/ne_50m_geography_marine_polys.geojson');
const OUTPUT_PATH = resolve(ROOT, 'src/data/generated/country-labels.json');
const USAGE =
  'Usage: node scripts/build-country-labels.ts [--refresh | --offline] [countries.geojson] [marine.geojson]';

async function download(url: string): Promise<string> {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: { Accept: 'application/geo+json, application/json, text/plain' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
      return await response.text();
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    }
  }
  throw new Error('Failed to download Natural Earth source after 3 attempts', { cause: failure });
}

export async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function loadNaturalEarth(
  url: string,
  cachePath: string,
  offline: boolean,
  refresh: boolean,
): Promise<{ text: string; downloaded: boolean }> {
  if (!refresh) {
    try {
      return { text: await readFile(cachePath, 'utf8'), downloaded: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (offline)
        throw new Error(`Offline Natural Earth cache is missing: ${cachePath}. Run without --offline to download it.`, {
          cause: error,
        });
    }
  }
  return { text: await download(url), downloaded: true };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const offline = args.includes('--offline');
  const refresh = args.includes('--refresh');
  if (
    args.some((arg) => arg.startsWith('--') && arg !== '--offline' && arg !== '--refresh') ||
    paths.length > 2 ||
    (offline && refresh)
  ) {
    throw new Error(USAGE);
  }
  const source = paths.length
    ? { text: await readFile(resolve(paths[0]), 'utf8'), downloaded: false }
    : await loadNaturalEarth(COUNTRY_LABEL_SOURCE_URL, CACHE_PATH, offline, refresh);
  let raw: unknown;
  try {
    raw = JSON.parse(source.text);
  } catch (error) {
    throw new Error('Natural Earth country label source is not valid JSON', { cause: error });
  }
  const overrides = decodePlaceNameOverrides(
    JSON.parse(await readFile(resolve(ROOT, 'data/place-names.json'), 'utf8')),
  );
  validateCountryLabels(buildCountryLabels(raw, undefined, overrides));
  const marineSource = paths[1]
    ? { text: await readFile(resolve(paths[1]), 'utf8'), downloaded: false }
    : await loadNaturalEarth(MARINE_LABEL_SOURCE_URL, MARINE_CACHE_PATH, offline, refresh);
  const dataset = buildCountryLabels(raw, JSON.parse(marineSource.text), overrides);
  if (dataset.labels.filter((label) => label[0] === 'ocean').length < 7)
    throw new Error('Too few ocean labels; expected all seven Natural Earth ocean regions');
  const counts = validateCountryLabels(dataset);
  const output = JSON.stringify(dataset) + '\n';
  // Validate everything before replacing either the cache or generated output.
  if (source.downloaded) await atomicWrite(CACHE_PATH, source.text);
  if (marineSource.downloaded) await atomicWrite(MARINE_CACHE_PATH, marineSource.text);
  await atomicWrite(OUTPUT_PATH, output);
  console.log(`Place labels: ${counts} labels, ${Buffer.byteLength(output)} bytes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
