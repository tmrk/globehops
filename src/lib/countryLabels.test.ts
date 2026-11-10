import { describe, expect, it } from 'vitest';
import {
  decodeCountryLabels,
  labelStyle,
  mapZoom,
  placeLabels,
  labelLocale,
  labelPriority,
  type CountryLabel,
} from './countryLabels.ts';

const label: CountryLabel = {
  kind: 'country',
  name: 'Brazil',
  names: { en: 'Brazil', hu: 'Brazília', sv: 'Brasilien' },
  lat: -12.1,
  lng: -49.56,
  minZoom: 1.7,
  rank: 2,
};
const wire = () => ({
  format: 2,
  meta: { source: 'Natural Earth', version: '5.1.2', license: 'Public domain' },
  labels: [['country', 'Brazil', 'Brazília', 'Brasilien', -12.1, -49.56, 1.7, 2]],
});

describe('decodeCountryLabels', () => {
  it('decodes the compact tuple without mutating it', () => {
    const raw = wire();
    expect(decodeCountryLabels(raw)).toEqual([label]);
    expect(raw.labels[0]).toEqual(['country', 'Brazil', 'Brazília', 'Brasilien', -12.1, -49.56, 1.7, 2]);
  });
  it.each([
    null,
    [],
    {},
    { ...wire(), format: 1 },
    { ...wire(), meta: null },
    { ...wire(), meta: { source: 'x', version: '', license: 'x' } },
    { ...wire(), labels: null },
  ])('rejects malformed envelopes: %j', (raw) => {
    expect(() => decodeCountryLabels(raw)).toThrow();
  });
  it.each([
    [],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, 0, 1, 2, 3],
    ['country', '', 'Brazília', 'Brasilien', 0, 0, 1, 2],
    ['country', ' Brazil ', 'Brazília', 'Brasilien', 0, 0, 1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 90.01, 0, 1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', -90.01, 0, 1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, 180.01, 1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, -180.01, 1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', NaN, 0, 1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, Infinity, 1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, 0, -0.1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, 0, 12.1, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, 0, NaN, 2],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, 0, 1, -1],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, 0, 1, 21],
    ['country', 'Brazil', 'Brazília', 'Brasilien', 0, 0, 1, Infinity],
    ['country', 'Brazil', 'Brazília', 'Brasilien', '0', 0, 1, 2],
  ])('rejects invalid tuples: %j', (...tuple) => {
    expect(() => decodeCountryLabels({ ...wire(), labels: [tuple] })).toThrow();
  });
  it('rejects duplicate names and accepts inclusive coordinate/style bounds', () => {
    expect(() => decodeCountryLabels({ ...wire(), labels: [...wire().labels, ...wire().labels] })).toThrow();
    expect(
      decodeCountryLabels({
        ...wire(),
        labels: [
          ['ocean', 'North', 'Észak', 'Norr', 90, 180, 0, 0],
          ['sea', 'South', 'Dél', 'Söder', -90, -180, 12, 20],
        ],
      }),
    ).toHaveLength(2);
  });
});

describe('atlas zoom and style', () => {
  it('calibrates CSS pixel scale against 256px web-map tiles', () => {
    expect(mapZoom(256 / (2 * Math.PI))).toBeCloseTo(0);
    expect(mapZoom(512 / (2 * Math.PI))).toBeCloseTo(1);
    // Whole-globe centre scales: ~400px/rad desktop, ~180px/rad phone. Major countries
    // (MIN_LABEL 1.7–2) are established on both; smaller countries (3+) need desktop/zoom.
    expect(mapZoom(400)).toBeCloseTo(3.295, 2);
    expect(mapZoom(180)).toBeCloseTo(2.143, 2);
    expect(labelStyle(label, mapZoom(180))?.opacity).toBeGreaterThan(0.7);
    expect(labelStyle({ ...label, minZoom: 3 }, mapZoom(180))).toBeNull();
    expect(labelStyle({ ...label, minZoom: 3 }, mapZoom(400))?.opacity).toBeGreaterThan(0);
  });
  it('starts at the threshold and fades in over 0.6 zoom levels', () => {
    expect(labelStyle(label, 1.69)).toBeNull();
    expect(labelStyle(label, 1.7)?.opacity).toBe(0);
    expect(labelStyle(label, 2)?.opacity).toBeCloseTo(0.5);
    expect(labelStyle(label, 2.3)?.opacity).toBeCloseTo(1);
    expect(labelStyle(label, NaN)).toBeNull();
  });
  it('makes important countries larger, grows modestly, and clamps the size', () => {
    expect(labelStyle(label, 3)!.fontPx).toBeGreaterThan(labelStyle({ ...label, rank: 6 }, 3)!.fontPx);
    expect(labelStyle(label, 4)!.fontPx - labelStyle(label, 3)!.fontPx).toBeCloseTo(0.65);
    expect(labelStyle({ ...label, rank: 20 }, 2)!.fontPx).toBe(10);
    expect(labelStyle(label, 20)!.fontPx).toBe(17);
  });
});

describe('placeLabels', () => {
  const rect = (x: number, y = 0) => ({ x0: x, y0: y, x1: x + 20, y1: y + 10 });
  it('greedily accepts priority order; rejected labels reserve no space', () => {
    expect(placeLabels([rect(0), rect(10), rect(25)], [])).toEqual([true, false, true]);
    expect(placeLabels([rect(10), rect(0), rect(25)], [])).toEqual([true, false, false]);
  });
  it('gives airport rectangles priority, including their dots', () => {
    expect(placeLabels([rect(0), rect(25), rect(80)], [rect(10), rect(80)])).toEqual([false, false, false]);
  });
  it('keeps four CSS pixels between boxes on either axis without mutating inputs', () => {
    const candidates = [rect(0), rect(23), rect(24), rect(0, 14)];
    const before = structuredClone(candidates);
    expect(placeLabels(candidates, [])).toEqual([true, false, true, true]);
    expect(candidates).toEqual(before);
    expect(placeLabels([], [rect(0)])).toEqual([]);
  });
});

describe('label locales and priority', () => {
  it('falls back to English and accepts only supported locales', () => {
    expect(['en', 'hu', 'sv', 'fr', 'hu-HU'].map(labelLocale)).toEqual(['en', 'hu', 'sv', 'en', 'en']);
  });
  it('ranks oceans with the leading countries: below them and major seas, above other seas and countries', () => {
    const ocean: CountryLabel = { ...label, kind: 'ocean', name: 'Ocean', rank: 0, minZoom: 0.8 };
    const labels: CountryLabel[] = [
      { ...label, kind: 'sea', name: 'Minor sea', rank: 2 },
      { ...label, kind: 'country', name: 'Small country', rank: 3 },
      ocean,
      { ...label, kind: 'country', name: 'Leading country', rank: 2 },
      { ...label, kind: 'sea', name: 'Major sea', rank: 1 },
    ];
    expect(labels.sort(labelPriority).map((l) => l.name)).toEqual([
      'Major sea',
      'Leading country',
      'Ocean',
      'Minor sea',
      'Small country',
    ]);
    expect(labelStyle({ ...label, kind: 'sea' }, 3)!.fontPx).toBeLessThan(labelStyle(label, 3)!.fontPx);
  });
  it('keeps oceans smaller and fainter than the leading country names on the whole globe, matching them up close', () => {
    const ocean: CountryLabel = { ...label, kind: 'ocean', rank: 0, minZoom: 0.8 };
    const leading: CountryLabel = { ...label, kind: 'country', rank: 2, minZoom: 1.7 };
    // Phone and desktop whole-globe views: 2.5px smaller and 30% fainter.
    for (const zoom of [2.5, 3.5]) {
      expect(labelStyle(ocean, zoom)!.fontPx).toBeCloseTo(labelStyle(leading, zoom)!.fontPx - 2.5);
      expect(labelStyle(ocean, zoom)!.opacity).toBeCloseTo(0.7);
    }
    // Halfway to regional zoom, and then the same as the leading names.
    expect(labelStyle(ocean, 4.4)!.fontPx).toBeCloseTo(labelStyle(leading, 4.4)!.fontPx - 1.25);
    expect(labelStyle(ocean, 4.4)!.opacity).toBeCloseTo(0.85);
    for (const zoom of [5.2, 7, 20]) {
      expect(labelStyle(ocean, zoom)!.fontPx).toBeCloseTo(labelStyle(leading, zoom)!.fontPx);
      expect(labelStyle(ocean, zoom)!.opacity).toBe(1);
    }
    expect(labelStyle(ocean, 0.8)!.fontPx).toBeCloseTo(10.1, 1);
    expect(labelStyle(ocean, 1.1)!.opacity).toBeCloseTo(0.35);
    expect(labelStyle(ocean, 20)!.fontPx).toBe(17);
  });
  it('requires all translations and unique kind/English identities, while allowing shared exonyms', () => {
    const raw = wire();
    for (const value of ['', '  ', null, 1]) {
      const tuple: unknown[] = [...raw.labels[0]];
      tuple[2] = value;
      expect(() => decodeCountryLabels({ ...raw, labels: [tuple] })).toThrow();
    }
    const tuple = ['ocean', 'South Atlantic', 'Atlanti-óceán', 'Atlanten', -30, -15, 1, 0];
    expect(
      decodeCountryLabels({
        ...raw,
        labels: [tuple, ['ocean', 'North Atlantic', 'Atlanti-óceán', 'Atlanten', 30, -40, 1, 0]],
      }),
    ).toHaveLength(2);
    expect(() => decodeCountryLabels({ ...raw, labels: [['river', 'A', 'A', 'A', 0, 0, 1, 0]] })).toThrow();
  });
});
