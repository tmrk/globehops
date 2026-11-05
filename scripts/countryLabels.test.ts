import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './build-country-labels.ts';
import { describe, expect, it } from 'vitest';
import { buildCountryLabels, COUNTRY_LABEL_SOURCE_URL, validateCountryLabels } from './lib/countryLabels.ts';

const feature = (properties: unknown) => ({ type: 'Feature', properties });
const properties = { NAME: 'Example', LABEL_Y: 12.3456, LABEL_X: -45.6789, MIN_LABEL: 2.74, LABELRANK: 3 };
const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });
const fixture = () => buildCountryLabels(collection(feature(properties)));

describe('Natural Earth country labels', () => {
  it('extracts short names, rounds points/zoom and records pinned public-domain provenance', () => {
    const data = buildCountryLabels(
      collection(feature(properties), feature({ ...properties, NAME: 'United States of America' })),
    );
    expect(data).toEqual({
      format: 1,
      meta: { source: COUNTRY_LABEL_SOURCE_URL, version: '5.1.2', license: 'Public domain (Natural Earth)' },
      labels: [
        ['Example', 12.35, -45.68, 2.7, 3],
        ['United States', 12.35, -45.68, 2.7, 3],
      ],
    });
    expect(validateCountryLabels(data, 2)).toBe(2);
  });
  it('sorts by rank, zoom then name deterministically', () => {
    const data = buildCountryLabels(
      collection(
        ...[{ NAME: 'Z', LABELRANK: 1 }, { NAME: 'B' }, { NAME: 'A' }, { NAME: 'Early', MIN_LABEL: 1 }].map((p) =>
          feature({ ...properties, ...p }),
        ),
      ),
    );
    expect(data.labels.map((l) => l[0])).toEqual(['Z', 'Early', 'A', 'B']);
    expect(buildCountryLabels(collection(feature(properties)))).toEqual(fixture());
  });
  it('skips missing/invalid points and names without inventing centroids', () => {
    const bad = [
      null,
      {},
      { ...properties, NAME: '' },
      { ...properties, NAME: 3 },
      { ...properties, LABEL_Y: NaN },
      { ...properties, LABEL_X: 180.001 },
      { ...properties, LABEL_Y: -90.001 },
      { ...properties, LABEL_X: '3' },
    ];
    expect(buildCountryLabels(collection(...bad.map(feature))).labels).toEqual([]);
  });
  it.each([null, {}, { type: 'FeatureCollection', features: [null] }])('rejects malformed GeoJSON: %j', (raw) => {
    expect(() => buildCountryLabels(raw)).toThrow();
  });
  it.each([{ MIN_LABEL: -1 }, { MIN_LABEL: 13 }, { LABELRANK: NaN }, { LABELRANK: 21 }])(
    'rejects invalid display fields: %j',
    (p) => {
      expect(() => buildCountryLabels(collection(feature({ ...properties, ...p })))).toThrow();
    },
  );
  it('rejects truncated datasets, duplicates and invalid tuples before writes', () => {
    expect(() => validateCountryLabels(fixture())).toThrow('expected at least 180');
    const data = fixture();
    data.labels.push([...data.labels[0]]);
    expect(() => validateCountryLabels(data, 1)).toThrow('Invalid country label');
    data.labels = [['Bad', Infinity, 0, 1, 2]];
    expect(() => validateCountryLabels(data, 1)).toThrow();
  });
  it('rejects CLI mistakes and invalid local sources without replacing generated output', async () => {
    const output = new URL('../src/data/generated/country-labels.json', import.meta.url);
    const before = await readFile(output);
    const temporary = await mkdtemp(join(tmpdir(), 'globehops-labels-'));
    const source = join(temporary, 'countries.geojson');
    try {
      for (const args of [['--unknown'], ['--offline', '--refresh'], ['one', 'two']]) {
        await expect(main(args)).rejects.toThrow('Usage:');
      }
      await writeFile(source, '{');
      await expect(main([source])).rejects.toThrow('not valid JSON');
      await writeFile(source, JSON.stringify(collection(feature(properties))));
      await expect(main([source])).rejects.toThrow('expected at least 180');
      expect(await readFile(output)).toEqual(before);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
  const cache = new URL('../.cache/naturalearth/ne_50m_admin_0_countries.geojson', import.meta.url);
  it.skipIf(!existsSync(cache))('rebuilds the committed production data from the pinned cache', () => {
    const raw: unknown = JSON.parse(readFileSync(cache, 'utf8'));
    const data = buildCountryLabels(raw);
    expect(validateCountryLabels(data)).toBeGreaterThanOrEqual(180);
    expect(JSON.stringify(data) + '\n').toBe(
      readFileSync(new URL('../src/data/generated/country-labels.json', import.meta.url), 'utf8'),
    );
  });
});
