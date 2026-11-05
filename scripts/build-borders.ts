/** Builds compact, public-domain Natural Earth land borders from a pinned source or local cache. */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BORDER_SOURCE_URL, buildBorders, validateBorders } from './lib/borders.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE_PATH = resolve(ROOT, '.cache/naturalearth/ne_50m_admin_0_boundary_lines_land.geojson');
const OUTPUT_PATH = resolve(ROOT, 'src/data/generated/borders.json');
const USAGE = 'Usage: node scripts/build-borders.ts [--refresh | --offline] [source.geojson]';

async function download(): Promise<string> {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(BORDER_SOURCE_URL, {
        signal: AbortSignal.timeout(60_000),
        headers: { Accept: 'application/geo+json, application/json, text/plain' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${BORDER_SOURCE_URL}`);
      return await response.text();
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    }
  }
  throw new Error('Failed to download Natural Earth borders after 3 attempts', { cause: failure });
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function loadSource(offline: boolean, refresh: boolean): Promise<{ text: string; downloaded: boolean }> {
  if (!refresh) {
    try {
      return { text: await readFile(CACHE_PATH, 'utf8'), downloaded: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (offline)
        throw new Error(`Offline border cache is missing: ${CACHE_PATH}. Run without --offline to download it.`, {
          cause: error,
        });
    }
  }
  return { text: await download(), downloaded: true };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const offline = args.includes('--offline');
  const refresh = args.includes('--refresh');
  if (
    args.some((arg) => arg.startsWith('--') && arg !== '--offline' && arg !== '--refresh') ||
    paths.length > 1 ||
    (offline && refresh)
  ) {
    throw new Error(USAGE);
  }
  const source = paths.length
    ? { text: await readFile(resolve(paths[0]), 'utf8'), downloaded: false }
    : await loadSource(offline, refresh);
  let raw: unknown;
  try {
    raw = JSON.parse(source.text);
  } catch (error) {
    throw new Error('Natural Earth border source is not valid JSON', { cause: error });
  }
  const dataset = buildBorders(raw);
  const counts = validateBorders(dataset);
  // No simplification is needed: quantisation and delta encoding keep the pinned data below 250 KB.
  const output = JSON.stringify(dataset) + '\n';
  // Validate everything before replacing either the cache or generated output.
  if (source.downloaded) await atomicWrite(CACHE_PATH, source.text);
  await atomicWrite(OUTPUT_PATH, output);
  console.log(`Borders: ${counts.lines} lines, ${counts.points} points, ${Buffer.byteLength(output)} bytes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
