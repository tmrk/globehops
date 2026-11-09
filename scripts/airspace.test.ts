import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildAirspace,
  clipRingMaxLng,
  decodeAdvisories,
  encodeRing,
  validateAirspace,
  type Advisories,
  type AdvisoryZone,
} from './lib/airspace.ts';
import { decodeAirspace, zoneContains } from '../src/data/airspace.ts';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const square = (x0: number, y0: number, size: number) => [
  [x0, y0],
  [x0 + size, y0],
  [x0 + size, y0 + size],
  [x0, y0 + size],
  [x0, y0],
];
const countries = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { ISO_A2: '-99', ISO_A2_EH: 'AA' },
      // Mainland 0–10° plus an exclave at 20°E and an island at 40°E.
      geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0, 10)], [square(20, 0, 2)], [square(40, 0, 2)]] },
    },
  ],
};
const marine = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Test Gulf' },
      geometry: { type: 'Polygon', coordinates: [square(50, 10, 10)] },
    },
  ],
};
const zone = (geometry: AdvisoryZone['geometry'], extra: Partial<AdvisoryZone> = {}): AdvisoryZone => ({
  id: 'z',
  name: 'Zone',
  place: 'AA',
  reference: 'CZIB-TEST',
  url: 'https://example.org/czib',
  issued: '2026-01-01',
  revised: null,
  validUntil: '2026-12-31',
  ceilingFl: null,
  operators: ['easa', 'tco'],
  recommendation: 'Not operate.',
  geometry,
  ...extra,
});
const advisories = (...zones: AdvisoryZone[]): Advisories => ({
  reviewed: '2026-11-09',
  index: 'https://example.org',
  operators: { easa: 'EASA operators', tco: 'Third-country operators' },
  zones,
  notModelled: [],
});

describe('airspace build', () => {
  it('selects country parts, excludes exclaves, clips at a meridian and reads marine polygons', () => {
    const built = buildAirspace(
      advisories(
        zone([{ country: 'AA', maxLng: 5 }], { id: 'west' }),
        zone([{ country: 'AA', part: [1, 41] }], { id: 'island' }),
        zone([{ country: 'AA', exclude: [[1, 21]] }], { id: 'home' }),
        zone([{ marine: 'Test Gulf' }], { id: 'gulf', place: 'test-gulf', exemptCountries: ['BB'] }),
      ),
      countries,
      marine,
    );
    const decoded = decodeAirspace(built);
    const [west, island, home, gulf] = decoded.zones;
    expect(zoneContains(west, 5, 2)).toBe(true);
    expect(zoneContains(west, 5, 8)).toBe(false); // clipped at 5°E
    expect(zoneContains(west, 1, 41)).toBe(false); // every part is clipped
    expect(zoneContains(island, 1, 41)).toBe(true);
    expect(zoneContains(island, 5, 5)).toBe(false);
    expect(zoneContains(home, 1, 21)).toBe(false); // excluded exclave
    expect(zoneContains(home, 1, 41)).toBe(true);
    expect(zoneContains(home, 5, 5)).toBe(true);
    expect(gulf).toMatchObject({ place: 'test-gulf', exemptCountries: ['BB'], approximate: false });
    expect(zoneContains(gulf, 15, 55)).toBe(true);
    expect(validateAirspace(built)).toBeGreaterThan(0);
  });

  it('rejects unknown geometry and drops slivers too small to matter', () => {
    expect(() => buildAirspace(advisories(zone([{ country: 'ZZ' }])), countries, marine)).toThrow(/no country ZZ/);
    expect(() => buildAirspace(advisories(zone([{ country: 'AA', part: [50, 50] }])), countries, marine)).toThrow(
      /No single AA part/,
    );
    expect(encodeRing(square(0, 0, 0.1) as [number, number][])).toBeNull();
    expect(clipRingMaxLng(square(0, 0, 10) as [number, number][], 4).every(([lng]) => lng <= 4)).toBe(true);
  });

  it('validates the hand-maintained list', () => {
    const valid = read('../data/airspace-advisories.json');
    expect(decodeAdvisories(valid).zones.length).toBeGreaterThan(5);
    const broken = (patch: Record<string, unknown>) => {
      const copy = structuredClone(valid) as { zones: Record<string, unknown>[] };
      Object.assign(copy.zones[0], patch);
      return copy;
    };
    expect(() => decodeAdvisories(broken({ validUntil: '2020-01-01' }))).toThrow(/precedes issued/);
    expect(() => decodeAdvisories(broken({ operators: ['everyone'] }))).toThrow(/operators/);
    expect(() => decodeAdvisories(broken({ url: 'http://example.org' }))).toThrow(/https/);
    expect(() => decodeAdvisories(broken({ geometry: [{ country: 'Ukraine' }] }))).toThrow(/ISO/);
  });

  it('keeps the generated file in step with the advisory list (run npm run airspace:build)', () => {
    const source = decodeAdvisories(read('../data/airspace-advisories.json'));
    const generated = read('../src/data/generated/airspace.json') as ReturnType<typeof buildAirspace>;
    expect(generated.reviewed).toBe(source.reviewed);
    expect(
      generated.zones.map(({ rings: _rings, ...metadata }) => {
        void _rings;
        return metadata;
      }),
    ).toEqual(
      source.zones.map((z) => ({
        id: z.id,
        name: z.name,
        place: z.place,
        reference: z.reference,
        url: z.url,
        issued: z.issued,
        validUntil: z.validUntil,
        ceilingFl: z.ceilingFl,
        operators: z.operators,
        exemptCountries: z.exemptCountries ?? [],
        approximate: z.approximate ?? false,
      })),
    );
    expect(validateAirspace(generated)).toBeGreaterThan(1000);
  });
});
