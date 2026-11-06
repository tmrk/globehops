import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from './build-country-labels.ts';
import {
  buildCountryLabels,
  includeMarine,
  marineContainsPoint,
  marineLabelPoint,
  validateCountryLabels,
} from './lib/countryLabels.ts';
import { decodePlaceNameOverrides } from './lib/placeNames.ts';
import { decodeCountryLabels } from '../src/lib/countryLabels.ts';

const feature = (properties: unknown, geometry?: unknown) => ({ type: 'Feature', properties, geometry });
const properties = {
  NAME: 'Example',
  NAME_HU: 'Példa',
  NAME_SV: 'Exempel',
  LABEL_Y: 12.3456,
  LABEL_X: -45.6789,
  MIN_LABEL: 2.74,
  LABELRANK: 3,
};
const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });
const fixture = () => buildCountryLabels(collection(feature(properties)));
const overrides = decodePlaceNameOverrides(
  JSON.parse(readFileSync(new URL('../data/place-names.json', import.meta.url), 'utf8')),
);
const rectangle = (x0 = 0, x1 = 10, y0 = 0, y1 = 10) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

describe('Natural Earth multilingual map labels', () => {
  it('extracts three names, rounds coordinates and applies documented cartographic overrides', () => {
    const data = buildCountryLabels(
      collection(
        feature(properties),
        feature({
          ...properties,
          NAME: 'United States of America',
          NAME_HU: 'Amerikai Egyesült Államok',
          NAME_SV: 'USA',
        }),
      ),
      undefined,
      overrides,
    );
    expect(data.format).toBe(2);
    expect(data.meta.version).toBe('5.1.2');
    expect(data.meta.license).toContain('CC0');
    expect(data.labels).toEqual([
      ['country', 'Example', 'Példa', 'Exempel', 12.35, -45.68, 2.7, 3],
      ['country', 'United States', 'Egyesült Államok', 'USA', 12.35, -45.68, 2.7, 3],
    ]);
    expect(validateCountryLabels(data, 2)).toBe(2);
  });
  it('sorts by rank, kind, zoom and English name deterministically', () => {
    const data = buildCountryLabels(
      collection(
        ...[{ NAME: 'Z', LABELRANK: 1 }, { NAME: 'B' }, { NAME: 'A' }, { NAME: 'Early', MIN_LABEL: 1 }].map((p) =>
          feature({ ...properties, ...p }),
        ),
      ),
    );
    expect(data.labels.map((l) => l[1])).toEqual(['Z', 'Early', 'A', 'B']);
    expect(buildCountryLabels(collection(feature(properties)))).toEqual(fixture());
  });
  it('skips invalid country points/names without inventing centroids', () => {
    const bad = [
      null,
      {},
      { ...properties, NAME: '' },
      { ...properties, NAME: 3 },
      { ...properties, LABEL_Y: NaN },
      { ...properties, LABEL_X: 180.001 },
      { ...properties, LABEL_Y: -90.001 },
    ];
    expect(buildCountryLabels(collection(...bad.map(feature))).labels).toEqual([]);
  });
  it.each([null, {}, { type: 'FeatureCollection', features: [null] }])('rejects malformed GeoJSON: %j', (raw) => {
    expect(() => buildCountryLabels(raw)).toThrow();
  });
  it.each([{ MIN_LABEL: -1 }, { MIN_LABEL: 13 }, { LABELRANK: NaN }, { LABELRANK: 21 }])(
    'rejects invalid styles: %j',
    (p) => {
      expect(() => buildCountryLabels(collection(feature({ ...properties, ...p })))).toThrow();
    },
  );
  it('requires enough countries independently of marine labels', () => {
    expect(() => validateCountryLabels(fixture())).toThrow('expected at least 180');
    const data = fixture();
    data.labels.push(['ocean', 'Example', 'Példa', 'Exempel', 0, 0, 1, 0]);
    expect(() => validateCountryLabels(data, 2)).toThrow('expected at least 2');
  });
  it('rejects CLI mistakes and truncated local sources without replacing output', async () => {
    const output = new URL('../src/data/generated/country-labels.json', import.meta.url);
    const before = await readFile(output);
    const temporary = await mkdtemp(join(tmpdir(), 'globehops-labels-'));
    const source = join(temporary, 'countries.geojson');
    try {
      for (const args of [['--unknown'], ['--offline', '--refresh'], ['one', 'two', 'three']])
        await expect(main(args)).rejects.toThrow('Usage:');
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
  const marine = new URL('../.cache/naturalearth/ne_50m_geography_marine_polys.geojson', import.meta.url);
  it.skipIf(!existsSync(cache) || !existsSync(marine))(
    'rebuilds committed data and keeps every marine point in its polygon',
    () => {
      const raw: unknown = JSON.parse(readFileSync(cache, 'utf8'));
      const water = JSON.parse(readFileSync(marine, 'utf8')) as {
        features: { properties: { name: string }; geometry: unknown }[];
      };
      const data = buildCountryLabels(raw, water, overrides);
      expect(validateCountryLabels(data)).toBe(321);
      expect(JSON.stringify(data) + '\n').toBe(
        readFileSync(new URL('../src/data/generated/country-labels.json', import.meta.url), 'utf8'),
      );
      const labels = decodeCountryLabels(data);
      for (const label of labels) {
        expect(label.names.hu).toBeTruthy();
        expect(label.names.sv).toBeTruthy();
        if (label.kind === 'country') continue;
        const originalName =
          overrides.labels.find((o) => o.kind === label.kind && o.names.en === label.name)?.key ?? label.name;
        const f = water.features.find((f) => f.properties.name === originalName)!;
        expect(marineContainsPoint(f.geometry, label.lat, label.lng), label.name).toBe(true);
      }
      expect(labels.filter((l) => l.kind === 'ocean')).toHaveLength(7);
      for (const name of ['North Pacific Ocean', 'South Pacific Ocean']) {
        expect(labels.find((l) => l.name === name)?.names).toEqual({
          en: name,
          hu: 'Csendes-óceán',
          sv: 'Stilla havet',
        });
      }
    },
  );
});

describe('marine selection and interior points', () => {
  it('keeps major seas, bays and gulfs, rank-4 seas and only selected channels/straits', () => {
    const p = (name: string, featurecla: string, scalerank: number) => includeMarine({ name, featurecla, scalerank });
    expect(p('Ocean', 'ocean', 0)).toBe(true);
    expect(p('Bay', 'bay', 3)).toBe(true);
    expect(p('Bay', 'bay', 4)).toBe(false);
    expect(p('Ionian Sea', 'sea', 4)).toBe(true);
    expect(p('English Channel', 'channel', 3)).toBe(true);
    expect(p('Strait of Gibraltar', 'strait', 4)).toBe(true);
    for (const [name, kind] of [
      ['Inner Sea', 'sea'],
      ['Inner Seas', 'sea'],
      ['The North Western Passages', 'channel'],
      ['River', 'river'],
      ['Reef', 'reef'],
      ['Sound', 'sound'],
      ['Luzon Strait', 'strait'],
    ])
      expect(p(name, kind, 1)).toBe(false);
  });
  it('finds the pole of a rectangle and avoids a central island', () => {
    expect(marineLabelPoint(rectangle())).toEqual({ lat: 5, lng: 5 });
    const water = rectangle();
    water.coordinates.push([
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ]);
    const point = marineLabelPoint(water);
    expect(marineContainsPoint(water, point.lat, point.lng)).toBe(true);
    expect(point.lat < 4 || point.lat > 6 || point.lng < 4 || point.lng > 6).toBe(true);
    expect(marineContainsPoint(water, 5, 5)).toBe(false);
  });
  it('unwraps antimeridian crossings and selects the largest split polygon', () => {
    const crossing = rectangle(170, -170, -10, 10);
    const point = marineLabelPoint(crossing);
    expect(Math.abs(point.lng)).toBe(180);
    expect(marineContainsPoint(crossing, point.lat, point.lng)).toBe(true);
    const split = {
      type: 'MultiPolygon',
      coordinates: [rectangle(170, 180, -10, 10).coordinates, rectangle(-180, -160, -10, 10).coordinates],
    };
    expect(marineLabelPoint(split).lng).toBe(-170);
  });
  it('rejects malformed geometries and out-of-water overrides', () => {
    expect(() => marineLabelPoint({ type: 'Point', coordinates: [0, 0] })).toThrow();
    expect(() =>
      buildCountryLabels(
        collection(),
        collection(feature({ name: 'Sea', featurecla: 'sea', scalerank: 1, min_label: 2 }, rectangle())),
        {
          cities: [],
          labels: [{ kind: 'sea', key: 'Sea', names: {}, point: [50, 50], reason: 'test' }],
        },
      ),
    ).toThrow('outside its polygon');
  });
});
