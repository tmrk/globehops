/** Validated, atomic OurAirports runway build; never modifies the airport-search dataset. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { format } from 'prettier';
import { atomicWrite, download } from './update-airports.ts';
import { buildDiversionAirports, type DiversionInputs, type DiversionBuildOptions } from './lib/diversion.ts';
import { parseExclusions } from './lib/dataset.ts';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export async function main(args = process.argv.slice(2)): Promise<void> {
  const offline = args.includes('--offline'),
    refresh = args.includes('--refresh');
  if (args.some((a) => !['--offline', '--refresh'].includes(a)) || (offline && refresh))
    throw new Error('Usage: node scripts/build-diversion-airports.ts [--offline | --refresh]');
  const cache = resolve(ROOT, '.cache/ourairports');
  let provenance: Pick<DiversionBuildOptions, 'lastModified' | 'upstreamCommit'> = {};
  try {
    provenance = JSON.parse(await readFile(resolve(cache, 'diversion-inputs.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const loaded = await Promise.all(
    (['airports.csv', 'runways.csv'] as const).map(async (name) => {
      if (!refresh) {
        try {
          return {
            name,
            text: await readFile(resolve(cache, name), 'utf8'),
            downloaded: false,
            lastModified: provenance.lastModified?.[name] ?? null,
          };
        } catch (error) {
          if (offline || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return {
        name,
        ...(await download(`https://davidmegginson.github.io/ourairports-data/${name}`)),
        downloaded: true,
      };
    }),
  );
  const inputs = Object.fromEntries(loaded.map((f) => [f.name, f.text])) as DiversionInputs;
  const lastModified = Object.fromEntries(loaded.map((f) => [f.name, f.lastModified]));
  const excluded = parseExclusions(JSON.parse(await readFile(resolve(ROOT, 'data/excluded-airports.json'), 'utf8')));
  const { dataset, report } = buildDiversionAirports(inputs, {
    ...provenance,
    lastModified,
    excluded,
    // A refresh downloads current main files independently, so an old cached commit must not be attributed to them.
    upstreamCommit: loaded.some((f) => f.downloaded) ? null : provenance.upstreamCommit,
  });
  const output = JSON.stringify(dataset) + '\n';
  await mkdir(cache, { recursive: true });
  for (const f of loaded) if (f.downloaded) await atomicWrite(resolve(cache, f.name), f.text);
  await atomicWrite(
    resolve(cache, 'diversion-inputs.json'),
    JSON.stringify({ upstreamCommit: dataset.meta.upstreamCommit, lastModified }),
  );
  await atomicWrite(
    resolve(ROOT, 'data/diversion-build.json'),
    await format(JSON.stringify(report), { parser: 'json', tabWidth: 2, printWidth: 120 }),
  );
  await atomicWrite(resolve(ROOT, 'src/data/generated/diversion-airports.json'), output);
  console.log(
    `Potential diversion airports: ${dataset.airports.length}; excluded uncertain runways: ${dataset.meta.counts.excludedUncertain}; ${Buffer.byteLength(output)} bytes, ${gzipSync(output).byteLength} bytes gzip.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
