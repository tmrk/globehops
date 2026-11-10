/** Atomic, reproducible radio-navaid build, separate from airport-search data. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { format } from 'prettier';
import { atomicWrite, download } from './update-airports.ts';
import { buildNavaids } from './lib/navaids.ts';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export async function main(args = process.argv.slice(2)): Promise<void> {
  const offline = args.includes('--offline'),
    refresh = args.includes('--refresh');
  if (args.some((a) => !['--offline', '--refresh'].includes(a)) || (offline && refresh))
    throw new Error('Usage: node scripts/build-navaids.ts [--offline | --refresh]');
  const cache = resolve(ROOT, '.cache/ourairports');
  let text: string | undefined;
  if (!refresh) {
    try {
      text = await readFile(resolve(cache, 'navaids.csv'), 'utf8');
    } catch (error) {
      if (offline || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const downloaded = text === undefined;
  text ??= (await download('https://davidmegginson.github.io/ourairports-data/navaids.csv')).text;
  const { dataset, report } = buildNavaids(text);
  // Compact runtime artifact, formatted build record. Never write partially validated data.
  const output = JSON.stringify(dataset) + '\n';
  await mkdir(cache, { recursive: true });
  if (downloaded) await atomicWrite(resolve(cache, 'navaids.csv'), text);
  await atomicWrite(
    resolve(ROOT, 'data/navaids-build.json'),
    await format(JSON.stringify(report), { parser: 'json', tabWidth: 2, printWidth: 120 }),
  );
  await atomicWrite(resolve(ROOT, 'src/data/generated/navaids.json'), output);
  console.log(
    `Navaids: ${dataset.navaids.length}; ${Buffer.byteLength(output)} bytes, ${gzipSync(output).byteLength} bytes gzip.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
