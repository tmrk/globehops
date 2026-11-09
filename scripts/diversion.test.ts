import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { buildDiversionAirports, type DiversionInputs } from './lib/diversion.ts';
import { parseExclusions } from './lib/dataset.ts';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const paths = ['../.cache/ourairports/airports.csv', '../.cache/ourairports/runways.csv'];
it.skipIf(!paths.every((p) => existsSync(new URL(p, import.meta.url))))(
  'rebuilds the diversion file from cached inputs without drift (npm run diversion:build)',
  () => {
    const generated = JSON.parse(read('../src/data/generated/diversion-airports.json')) as ReturnType<
      typeof buildDiversionAirports
    >['dataset'];
    const inputs = Object.fromEntries(paths.map((p) => [p.split('/').at(-1), read(p)])) as DiversionInputs;
    const generatedFiles = generated.meta.files;
    const { dataset, report } = buildDiversionAirports(inputs, {
      generatedAt: generated.meta.generatedAt,
      upstreamCommit: generated.meta.upstreamCommit,
      lastModified: Object.fromEntries(Object.entries(generatedFiles).map(([name, f]) => [name, f.lastModified])),
      excluded: parseExclusions(JSON.parse(read('../data/excluded-airports.json'))),
    });
    expect(dataset).toEqual(generated);
    expect(report).toEqual(JSON.parse(read('../data/diversion-build.json')));
    expect(gzipSync(JSON.stringify(dataset) + '\n').byteLength).toBeLessThan(40 * 1024);
  },
);
