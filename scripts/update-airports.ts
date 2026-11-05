/**
 * OurAirports selection: exclude closed/closed_airport and balloonport; retain a
 * valid IATA, scheduled service, or large/medium type (including unscheduled).
 * Drop invalid/zero coordinates and empty names. Normalize codes and whitespace;
 * resolve duplicate codes by scheduled, type, ICAO presence, then lowest id,
 * retaining losing codes as keywords. Dedupe/truncate keywords and merge only
 * documented aliases. Keep region names for US/CA/AU, round coordinates to four
 * decimals, and sort by numeric id. The pure builder validates before any writes.
 */
import { readFile, writeFile, mkdir, rename, appendFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildDataset, FILE_NAMES, parseExclusions, serializeDataset } from './lib/dataset.ts';
import type { DatasetInputs, FileName } from './lib/dataset.ts';
export { buildDataset } from './lib/dataset.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function download(url: string, json = false): Promise<{ text: string; lastModified: string | null }> {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60000),
        headers: {
          Accept: json ? 'application/vnd.github+json' : 'text/csv',
          ...(json && process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
      const type = response.headers.get('content-type') ?? '';
      if (
        !(json ? /application\/(?:[^;]+\+)?json/i : /(?:text\/(?:csv|plain)|application\/(?:csv|octet-stream))/i).test(
          type,
        )
      )
        throw new Error(`Unexpected content-type ${type} for ${url}`);
      return { text: await response.text(), lastModified: response.headers.get('last-modified') };
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw failure;
}
async function readExisting(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.some((a) => !['--offline', '--check'].includes(a)))
    throw new Error('Usage: node scripts/update-airports.ts [--offline] [--check]');
  const offline = args.includes('--offline'),
    check = args.includes('--check');
  const datasetPath = resolve(ROOT, 'src/data/generated/airports.json');
  const previous = (await readExisting(datasetPath)) as {
    meta?: { contentHash?: string; counts?: { airports?: number } };
  } | null;
  const inputs = {} as DatasetInputs;
  const lastModified: Partial<Record<FileName, string | null>> = {};
  const results = await Promise.all(
    FILE_NAMES.map(async (name) => {
      const path = resolve(ROOT, '.cache/ourairports', name);
      return {
        name,
        ...(offline
          ? { text: await readFile(path, 'utf8'), lastModified: null }
          : await download(`https://davidmegginson.github.io/ourairports-data/${name}`)),
      };
    }),
  );
  for (const r of results) {
    inputs[r.name] = r.text;
    lastModified[r.name] = r.lastModified;
  }
  let upstreamCommit: string | null = null;
  if (!offline) {
    try {
      const commit = JSON.parse(
        (await download('https://api.github.com/repos/davidmegginson/ourairports-data/commits/main', true)).text,
      ) as { sha?: string };
      if (/^[a-f0-9]{40}$/.test(commit.sha ?? '')) upstreamCommit = commit.sha!;
    } catch {
      console.warn('Upstream commit unavailable; continuing with null.');
    }
  }
  const aliases = JSON.parse(await readFile(resolve(ROOT, 'data/aliases.json'), 'utf8')) as Record<string, string[]>;
  const excluded = parseExclusions(JSON.parse(await readFile(resolve(ROOT, 'data/excluded-airports.json'), 'utf8')));
  const { dataset, report } = buildDataset(inputs, {
    aliases,
    excluded,
    previousCount: previous?.meta?.counts?.airports,
    upstreamCommit,
    lastModified,
  });
  const changed = dataset.meta.contentHash !== previous?.meta?.contentHash;
  // No cache or generated file is touched until every validation has succeeded.
  if (!check) {
    if (!offline) {
      await mkdir(resolve(ROOT, '.cache/ourairports'), { recursive: true });
      for (const name of FILE_NAMES) await atomicWrite(resolve(ROOT, '.cache/ourairports', name), inputs[name]);
    }
    if (changed) {
      await mkdir(resolve(ROOT, 'src/data/generated'), { recursive: true });
      await mkdir(resolve(ROOT, 'data'), { recursive: true });
      await atomicWrite(resolve(ROOT, 'data/airports-build.json'), JSON.stringify(dataset.meta, null, 2) + '\n');
      await atomicWrite(datasetPath, serializeDataset(dataset));
    }
  }
  console.log(
    `${check ? 'Check' : 'Build'}: ${dataset.airports.length} airports (${dataset.meta.counts.scheduled} scheduled, ${dataset.meta.counts.withIata} IATA); dropped ${report.dropped}; excluded ${report.excluded.length}/${Object.keys(excluded).length}; duplicate codes: ${report.duplicates.iata} IATA, ${report.duplicates.icao} ICAO; ${changed ? (check ? 'would change' : 'changed') : 'unchanged'}.`,
  );
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `CHANGED=${changed}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
