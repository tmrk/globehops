/** Builds compact, public-domain Natural Earth land borders and coastlines from pinned sources or a local cache. */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BORDER_LAYER,
  COAST_LAYER,
  MIN_BORDER_LINES,
  MIN_BORDER_POINTS,
  MIN_COAST_LINES,
  MIN_COAST_POINTS,
  buildBorders,
  validateBorders,
  type LineLayerSource,
} from './lib/borders.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const USAGE = 'Usage: node scripts/build-borders.ts [--refresh | --offline] [borders-source.geojson]';

interface LayerBuild {
  name: string;
  layer: LineLayerSource;
  cachePath: string;
  outputPath: string;
  minLines: number;
  minPoints: number;
}

const LAYERS: LayerBuild[] = [
  {
    name: 'Borders',
    layer: BORDER_LAYER,
    cachePath: resolve(ROOT, '.cache/naturalearth/ne_50m_admin_0_boundary_lines_land.geojson'),
    outputPath: resolve(ROOT, 'src/data/generated/borders.json'),
    minLines: MIN_BORDER_LINES,
    minPoints: MIN_BORDER_POINTS,
  },
  {
    name: 'Coastlines',
    layer: COAST_LAYER,
    cachePath: resolve(ROOT, '.cache/naturalearth/ne_50m_coastline.geojson'),
    outputPath: resolve(ROOT, 'src/data/generated/coastlines.json'),
    minLines: MIN_COAST_LINES,
    minPoints: MIN_COAST_POINTS,
  },
];

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
  throw new Error(`Failed to download ${url} after 3 attempts`, { cause: failure });
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

async function loadSource(
  build: LayerBuild,
  offline: boolean,
  refresh: boolean,
): Promise<{ text: string; downloaded: boolean }> {
  if (!refresh) {
    try {
      return { text: await readFile(build.cachePath, 'utf8'), downloaded: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (offline)
        throw new Error(`Offline cache is missing: ${build.cachePath}. Run without --offline to download it.`, {
          cause: error,
        });
    }
  }
  return { text: await download(build.layer.url), downloaded: true };
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
  // A positional path replaces only the border source; coastlines always use the pinned source.
  const prepared = [];
  for (const build of LAYERS) {
    const source =
      paths.length && build.layer === BORDER_LAYER
        ? { text: await readFile(resolve(paths[0]), 'utf8'), downloaded: false }
        : await loadSource(build, offline, refresh);
    let raw: unknown;
    try {
      raw = JSON.parse(source.text);
    } catch (error) {
      throw new Error(`Natural Earth ${build.name.toLowerCase()} source is not valid JSON`, { cause: error });
    }
    const dataset = buildBorders(raw, build.layer);
    const counts = validateBorders(dataset, { minLines: build.minLines, minPoints: build.minPoints });
    prepared.push({ build, source, output: JSON.stringify(dataset) + '\n', counts });
  }
  // Validate every layer before replacing any cache or generated output.
  for (const { build, source, output, counts } of prepared) {
    if (source.downloaded) await atomicWrite(build.cachePath, source.text);
    await atomicWrite(build.outputPath, output);
    console.log(`${build.name}: ${counts.lines} lines, ${counts.points} points, ${Buffer.byteLength(output)} bytes.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
