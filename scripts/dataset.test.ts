import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDataset, parseExclusions, serializeDataset } from './lib/dataset.ts';
import type { BuildOptions, DatasetInputs } from './lib/dataset.ts';
import { main } from './update-airports.ts';
const fields = [
  'id',
  'ident',
  'type',
  'name',
  'latitude_deg',
  'longitude_deg',
  'iso_country',
  'iso_region',
  'municipality',
  'scheduled_service',
  'icao_code',
  'iata_code',
  'gps_code',
  'keywords',
];
const csv = (rows: string[][]) =>
  rows.map((row) => row.map((s) => `"${s.replaceAll('"', '""')}"`).join(',')).join('\r\n');
function fixture(overrides: Record<string, string>[]): DatasetInputs {
  return {
    'airports.csv': csv([
      fields,
      ...overrides.map((r, i) => {
        const row = {
          id: String(i + 1),
          ident: `TEST${i}`,
          type: 'small_airport',
          name: '  Test   Airport ',
          latitude_deg: '55.123456',
          longitude_deg: '12.654321',
          iso_country: 'DK',
          iso_region: 'DK-84',
          municipality: ' Test  City ',
          scheduled_service: 'no',
          icao_code: '',
          iata_code: `A${String.fromCharCode(65 + i)}A`,
          gps_code: '',
          keywords: '',
          ...r,
        };
        return fields.map((f) => row[f as keyof typeof row]);
      }),
    ]),
    'countries.csv': 'code,name\nDK,Denmark\nUS,United States',
    'regions.csv': 'code,name\nDK-84,Capital\nUS-NY,New York',
  };
}
const options: BuildOptions = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  validation: { minRows: { 'airports.csv': 0, 'countries.csv': 0, 'regions.csv': 0 }, minSelected: 0, sentinels: {} },
};
describe('airport dataset build', () => {
  it('selects valid IATA, scheduled and unscheduled large/medium rows, excluding closed types', () => {
    const result = buildDataset(
      fixture([
        { type: 'closed' },
        { type: 'closed_airport' },
        { type: 'balloonport' },
        { iata_code: '', scheduled_service: 'yes' },
        { type: 'large_airport', iata_code: '' },
        { type: 'medium_airport', iata_code: 'bad1' },
        { type: 'small_airport', iata_code: '' },
        { latitude_deg: 'nope' },
        { latitude_deg: '', longitude_deg: '' },
        { latitude_deg: '91' },
        { latitude_deg: '0', longitude_deg: '0' },
        { name: '  ' },
        {},
      ]),
      options,
    );
    expect(result.dataset.airports.map((a) => a[0])).toEqual([4, 5, 6, 13]);
    expect(result.report.dropped).toBe(5);
    expect(result.dataset.airports[0].slice(4, 10)).toEqual(['Test Airport', 'Test City', 'DK', '', 55.1235, 12.6543]);
  });
  it('leaves out documented upstream records with wrong positions', () => {
    const result = buildDataset(fixture([{}, {}, {}]), {
      ...options,
      excluded: { TEST1: 'Misplaced upstream: wrong country.', MISSING: 'No longer upstream, kept harmlessly.' },
    });
    expect(result.dataset.airports.map((a) => a[1])).toEqual(['TEST0', 'TEST2']);
    expect(result.report.excluded).toEqual(['TEST1']);
    expect(parseExclusions({ X: 'A reason that explains it.' })).toEqual({ X: 'A reason that explains it.' });
    expect(() => parseExclusions({ X: '' })).toThrow('needs a reason');
    expect(() => parseExclusions([])).toThrow('Invalid');
  });
  it('resolves duplicate codes deterministically and preserves losing codes as keywords', () => {
    const result = buildDataset(
      fixture([
        { iata_code: ' dup ', icao_code: 'egll', type: 'large_airport' },
        { iata_code: 'DUP', icao_code: 'EGLL', scheduled_service: 'yes' },
        { iata_code: 'DUP', gps_code: 'EGLL', scheduled_service: 'yes', type: 'large_airport' },
        { iata_code: 'DUP', icao_code: 'EGLL', scheduled_service: 'yes', type: 'large_airport' },
      ]),
      options,
    );
    expect(result.dataset.airports[2].slice(2, 4)).toEqual(['DUP', 'EGLL']);
    for (const i of [0, 1, 3]) {
      expect(result.dataset.airports[i].slice(2, 4)).toEqual(['', '']);
      expect(result.dataset.airports[i][12]).toContain('DUP');
      expect(result.dataset.airports[i][12]).toContain('EGLL');
    }
    expect(result.report.duplicates).toEqual({ iata: 3, icao: 3 });
  });
  it('prefers an ICAO-bearing candidate after schedule and type ties', () => {
    const inputs = fixture([{ iata_code: 'DUP' }, { iata_code: 'DUP', icao_code: 'KAAA' }]);
    const built = buildDataset(inputs, options).dataset;
    expect(built.airports[0][2]).toBe('');
    expect(built.airports[1][2]).toBe('DUP');
    const [header, ...rows] = inputs['airports.csv'].split('\r\n');
    const reordered = buildDataset(
      { ...inputs, 'airports.csv': [header, ...rows.reverse()].join('\r\n') },
      options,
    ).dataset;
    expect(reordered.airports).toEqual(built.airports);
    expect(reordered.meta.contentHash).toBe(built.meta.contentHash);
  });
  it('cleans and caps keywords, merges aliases and keeps customary regions only', () => {
    const result = buildDataset(
      fixture([
        {
          iata_code: 'AAA',
          icao_code: 'bad',
          gps_code: 'KAAA',
          iso_country: 'US',
          iso_region: 'US-NY',
          keywords: ' Test Airport, test city, aaa, kaaa, Malmö, MALMO, , Alternative  Name',
        },
        { iso_country: 'XX', keywords: Array.from({ length: 20 }, (_, i) => `keyword${i}` + 'x'.repeat(70)).join(',') },
      ]),
      { ...options, aliases: { AAA: ['Local Alias', 'Malmö'] } },
    );
    expect(result.dataset.airports[0][12]).toBe('Malmö|Alternative Name|Local Alias');
    expect(result.dataset.airports[0][3]).toBe('KAAA');
    const keywords = result.dataset.airports[1][12].split('|');
    expect(keywords).toHaveLength(12);
    expect(keywords.every((k) => k.length <= 60)).toBe(true);
    expect(result.dataset.countries.XX).toBe('XX');
    expect(result.dataset.regions).toEqual({ 'US-NY': 'New York' });
  });
  it('fails on missing headers, truncated data, regression, duplicates and sentinel failures', () => {
    expect(() => buildDataset(fixture([{}]))).toThrow('Truncated');
    expect(() => buildDataset({ ...fixture([{}]), 'countries.csv': 'nope\nvalue' }, options)).toThrow(
      'Missing required',
    );
    expect(() => buildDataset(fixture([{}]), { ...options, previousCount: 100 })).toThrow('Too few');
    expect(() => buildDataset(fixture([{ id: '1' }, { id: '1' }]), options)).toThrow('Duplicate');
    expect(() =>
      buildDataset(fixture([{}]), { ...options, validation: { ...options.validation, sentinels: { CPH: [55, 12] } } }),
    ).toThrow('sentinel');
  });
  it('has deterministic output and content hash independent of metadata', () => {
    const input = fixture([{}]);
    const a = buildDataset(input, options).dataset;
    const b = buildDataset(input, { ...options, generatedAt: 'later', upstreamCommit: 'abc' }).dataset;
    expect(a.meta.contentHash).toBe(b.meta.contentHash);
    expect(JSON.parse(serializeDataset(a))).toEqual(a);
  });
  // Integration test over the real cached OurAirports CSVs (.cache/ is gitignored, so this only
  // runs where `npm run data:update` has populated it; CI exercises the online path instead).
  const hasCache = existsSync(new URL('../.cache/ourairports/airports.csv', import.meta.url));
  it.skipIf(!hasCache)('offline no-change and check runs preserve timestamps and emit a machine result', async () => {
    const datasetPath = new URL('../src/data/generated/airports.json', import.meta.url),
      buildPath = new URL('../data/airports-build.json', import.meta.url);
    const before = [(await stat(datasetPath)).mtimeMs, (await stat(buildPath)).mtimeMs];
    const temporary = await mkdtemp(join(tmpdir(), 'globehops-check-')),
      output = join(temporary, 'output');
    const prior = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = output;
    const logger = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await main(['--offline']);
      await main(['--offline', '--check']);
      expect([(await stat(datasetPath)).mtimeMs, (await stat(buildPath)).mtimeMs]).toEqual(before);
      expect(await readFile(output, 'utf8')).toBe('CHANGED=false\nCHANGED=false\n');
    } finally {
      logger.mockRestore();
      if (prior === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = prior;
      await rm(temporary, { recursive: true });
    }
  });
  it('CLI validation failure writes neither the dataset, build record nor GitHub output', async () => {
    const datasetPath = new URL('../src/data/generated/airports.json', import.meta.url),
      buildPath = new URL('../data/airports-build.json', import.meta.url);
    const beforeDataset = await readFile(datasetPath),
      beforeBuild = await readFile(buildPath);
    const temporary = await mkdtemp(join(tmpdir(), 'globehops-validation-')),
      output = join(temporary, 'output');
    await writeFile(output, 'existing\n');
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async (url) =>
          new Response(
            String(url).includes('api.github.com') ? JSON.stringify({ sha: 'a'.repeat(40) }) : 'code,name\nXX,Test',
            { headers: { 'content-type': String(url).includes('api.github.com') ? 'application/json' : 'text/csv' } },
          ),
      );
    const prior = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = output;
    try {
      await expect(main([])).rejects.toThrow('Missing required');
      expect(await readFile(datasetPath)).toEqual(beforeDataset);
      expect(await readFile(buildPath)).toEqual(beforeBuild);
      expect(await readFile(output, 'utf8')).toBe('existing\n');
    } finally {
      fetcher.mockRestore();
      if (prior === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = prior;
      await rm(temporary, { recursive: true });
    }
  });
});
