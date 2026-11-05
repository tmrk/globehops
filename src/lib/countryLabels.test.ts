import { describe, expect, it } from 'vitest';
import { decodeCountryLabels, labelStyle, mapZoom, placeLabels, type CountryLabel } from './countryLabels.ts';

const label: CountryLabel = { name: 'Brazil', lat: -12.1, lng: -49.56, minZoom: 1.7, rank: 2 };
const wire = () => ({
  format: 1,
  meta: { source: 'Natural Earth', version: '5.1.2', license: 'Public domain' },
  labels: [['Brazil', -12.1, -49.56, 1.7, 2]],
});

describe('decodeCountryLabels', () => {
  it('decodes the compact tuple without mutating it', () => {
    const raw = wire();
    expect(decodeCountryLabels(raw)).toEqual([label]);
    expect(raw.labels[0]).toEqual(['Brazil', -12.1, -49.56, 1.7, 2]);
  });
  it.each([
    null,
    [],
    {},
    { ...wire(), format: 2 },
    { ...wire(), meta: null },
    { ...wire(), meta: { source: 'x', version: '', license: 'x' } },
    { ...wire(), labels: null },
  ])('rejects malformed envelopes: %j', (raw) => {
    expect(() => decodeCountryLabels(raw)).toThrow();
  });
  it.each([
    [],
    ['Brazil', 0, 0, 1, 2, 3],
    ['', 0, 0, 1, 2],
    [' Brazil ', 0, 0, 1, 2],
    ['Brazil', 90.01, 0, 1, 2],
    ['Brazil', -90.01, 0, 1, 2],
    ['Brazil', 0, 180.01, 1, 2],
    ['Brazil', 0, -180.01, 1, 2],
    ['Brazil', NaN, 0, 1, 2],
    ['Brazil', 0, Infinity, 1, 2],
    ['Brazil', 0, 0, -0.1, 2],
    ['Brazil', 0, 0, 12.1, 2],
    ['Brazil', 0, 0, NaN, 2],
    ['Brazil', 0, 0, 1, -1],
    ['Brazil', 0, 0, 1, 21],
    ['Brazil', 0, 0, 1, Infinity],
    ['Brazil', '0', 0, 1, 2],
  ])('rejects invalid tuples: %j', (...tuple) => {
    expect(() => decodeCountryLabels({ ...wire(), labels: [tuple] })).toThrow();
  });
  it('rejects duplicate names and accepts inclusive coordinate/style bounds', () => {
    expect(() => decodeCountryLabels({ ...wire(), labels: [...wire().labels, ...wire().labels] })).toThrow();
    expect(
      decodeCountryLabels({
        ...wire(),
        labels: [
          ['North', 90, 180, 0, 0],
          ['South', -90, -180, 12, 20],
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
