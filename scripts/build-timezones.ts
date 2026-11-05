/** Download once, validate the pinned ZIP, and build an offline-capable airport time-zone table. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildTimeZones, TIMEZONE_RELEASE, TIMEZONE_SOURCE_URL, TIMEZONE_ZIP_SHA256 } from './lib/timezones.ts';
import { extractJsonFromZip } from './lib/zip.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE_PATH = resolve(ROOT, `.cache/timezones/${TIMEZONE_RELEASE}/timezones.geojson.zip`);
const OUTPUT_PATH = resolve(ROOT, 'src/data/generated/timezones.json');
const BUILD_PATH = resolve(ROOT, 'data/timezones-build.json');
const USAGE = 'Usage: node scripts/build-timezones.ts [--offline | --refresh]';

async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Preserve an equivalent build report even if a formatter has changed its whitespace. */
async function writeBuildReport(record: unknown): Promise<void> {
  try {
    const previous: unknown = JSON.parse(await readFile(BUILD_PATH, 'utf8'));
    if (JSON.stringify(previous) === JSON.stringify(record)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await atomicWrite(BUILD_PATH, JSON.stringify(record, null, 2) + '\n');
}

export function verifyTimeZoneZip(zip: Buffer): void {
  const actual = createHash('sha256').update(zip).digest('hex');
  if (actual !== TIMEZONE_ZIP_SHA256)
    throw new Error(`Time-zone ZIP SHA-256 mismatch: expected ${TIMEZONE_ZIP_SHA256}, got ${actual}`);
}

async function download(): Promise<Buffer> {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(TIMEZONE_SOURCE_URL, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${TIMEZONE_SOURCE_URL}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    }
  }
  throw new Error('Failed to download time-zone boundaries after 3 attempts', { cause: failure });
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const started = performance.now();
  const offline = args.includes('--offline'),
    refresh = args.includes('--refresh');
  if (args.some((arg) => arg !== '--offline' && arg !== '--refresh') || (offline && refresh)) throw new Error(USAGE);
  let zip: Buffer | undefined;
  let downloaded = false;
  if (!refresh) {
    try {
      zip = await readFile(CACHE_PATH);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (offline)
        throw new Error(`Offline time-zone cache is missing: ${CACHE_PATH}. Run without --offline to download it.`, {
          cause: error,
        });
    }
  }
  if (!zip) {
    zip = await download();
    downloaded = true;
  }
  verifyTimeZoneZip(zip);
  const raw: unknown = JSON.parse(extractJsonFromZip(zip).toString('utf8'));
  const airportRaw: unknown = JSON.parse(await readFile(resolve(ROOT, 'src/data/generated/airports.json'), 'utf8'));
  const overrideRaw: unknown = JSON.parse(await readFile(resolve(ROOT, 'data/timezone-overrides.json'), 'utf8'));
  const { dataset, report } = buildTimeZones(raw, airportRaw, overrideRaw);
  // A no-change rebuild preserves generatedAt and bytes for reproducible, reviewable diffs.
  try {
    const previous: unknown = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    if (
      typeof previous === 'object' &&
      previous !== null &&
      'meta' in previous &&
      typeof previous.meta === 'object' &&
      previous.meta !== null &&
      'generatedAt' in previous.meta
    ) {
      const candidate = { ...dataset, meta: { ...dataset.meta, generatedAt: previous.meta.generatedAt } };
      if (JSON.stringify(candidate) === JSON.stringify(previous))
        dataset.meta.generatedAt = String(previous.meta.generatedAt);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const output = JSON.stringify(dataset) + '\n';
  const rawBytes = Buffer.byteLength(output),
    gzipBytes = gzipSync(output).length;
  if (gzipBytes >= 30 * 1024) throw new Error(`Time-zone dataset exceeds 30 KiB gzip: ${gzipBytes} bytes`);
  // Complete all source/coverage/sentinel/size validation before replacing any output or cache.
  if (downloaded) await atomicWrite(CACHE_PATH, zip);
  await atomicWrite(OUTPUT_PATH, output);
  await writeBuildReport({ ...dataset.meta, zipSha256: TIMEZONE_ZIP_SHA256, report });
  const c = dataset.meta.counts;
  console.log(
    `Time zones: ${c.airports}/${c.airports} airports, ${c.zones} zones, ${c.nearest} nearest, ${c.overrides} overrides, ${report.overlaps.length} overlaps, ${report.unusedOverrides.length} unused overrides; ${rawBytes} bytes (${gzipBytes} gzip); ${((performance.now() - started) / 1000).toFixed(2)}s.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
