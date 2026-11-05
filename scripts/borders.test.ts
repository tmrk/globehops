/** Offline fixtures for Natural Earth extraction, compact encoding and production safeguards. */

import { describe, expect, it } from 'vitest';
import { decodeBorders } from '../src/lib/borders.ts';
import {
  BORDER_PRECISION,
  BORDER_SOURCE,
  BORDER_SOURCE_URL,
  MIN_BORDER_LINES,
  MIN_BORDER_POINTS,
  buildBorders,
  validateBorders,
} from './lib/borders.ts';

function collection(...geometries: unknown[]) {
  return { type: 'FeatureCollection', features: geometries.map((geometry) => ({ type: 'Feature', geometry })) };
}

function line(coordinates: unknown) {
  return { type: 'LineString', coordinates };
}

const fixture = () =>
  buildBorders(
    collection(
      line([
        [12.345, -4.567],
        [12.376, -4.521],
        [12.301, -4.599],
      ]),
    ),
  );
const smallValidation = { minLines: 1, minPoints: 2 };

describe('buildBorders', () => {
  it('round trips quantised coordinates with absolute first pairs and signed deltas', () => {
    const dataset = fixture();
    expect(dataset).toEqual({
      format: 1,
      source: BORDER_SOURCE,
      url: BORDER_SOURCE_URL,
      precision: BORDER_PRECISION,
      lines: [[1235, -457, 3, 5, -8, -8]],
    });
    expect(decodeBorders(dataset)).toEqual([
      [
        { lng: 12.35, lat: -4.57 },
        { lng: 12.38, lat: -4.52 },
        { lng: 12.3, lat: -4.6 },
      ],
    ]);
    expect(
      buildBorders(
        collection(
          line([
            [12.345, -4.567],
            [12.376, -4.521],
            [12.301, -4.599],
          ]),
        ),
      ),
    ).toEqual(dataset);
  });

  it('drops consecutive duplicates after quantisation and lines with fewer than two distinct points', () => {
    const dataset = buildBorders(
      collection(
        line([
          [1.001, 2.001],
          [1.004, 2.004],
          [1.016, 2.001],
          [1.019, 2.004],
          [1.001, 2.001],
        ]),
        line([
          [3, 4],
          [3.004, 4.004],
        ]),
        line([[3, 4]]),
        line([]),
      ),
    );
    expect(dataset.lines).toEqual([[100, 200, 2, 0, -2, 0]]);
    expect(validateBorders(dataset, smallValidation)).toEqual({ lines: 1, points: 3 });
  });

  it('splits MultiLineStrings while retaining feature and part order', () => {
    const dataset = buildBorders(
      collection(
        line([
          [1, 2],
          [2, 3],
        ]),
        {
          type: 'MultiLineString',
          coordinates: [
            [
              [4, 5],
              [6, 7],
            ],
            [[8, 9]],
            [
              [10, 11],
              [12, 13],
            ],
          ],
        },
        line([
          [14, 15],
          [16, 17],
        ]),
      ),
    );
    expect(dataset.lines).toEqual([
      [100, 200, 100, 100],
      [400, 500, 200, 200],
      [1000, 1100, 200, 200],
      [1400, 1500, 200, 200],
    ]);
  });

  it('ignores null and other geometries, including nested lines in GeometryCollections', () => {
    const dataset = buildBorders(
      collection(
        null,
        { type: 'Point', coordinates: [1, 2] },
        {
          type: 'Polygon',
          coordinates: [
            [
              [1, 2],
              [3, 4],
              [1, 2],
            ],
          ],
        },
        {
          type: 'GeometryCollection',
          geometries: [
            line([
              [1, 2],
              [3, 4],
            ]),
          ],
        },
        line([
          [-180, -90],
          [180, 90],
        ]),
      ),
    );
    expect(dataset.lines).toEqual([[-18000, -9000, 36000, 18000]]);
    expect(decodeBorders(dataset)).toEqual([
      [
        { lng: -180, lat: -90 },
        { lng: 180, lat: 90 },
      ],
    ]);
  });

  it.each([
    null,
    {},
    { type: 'FeatureCollection', features: null },
    { type: 'FeatureCollection', features: [null] },
    collection(undefined),
    collection({ type: 'LineString' }),
    collection({ type: 'MultiLineString', coordinates: [null] }),
    collection(line([[1, 2], [3]])),
    collection(
      line([
        [1, 2],
        ['3', 4],
      ]),
    ),
    collection(
      line([
        [1, 2],
        [NaN, 4],
      ]),
    ),
    collection(
      line([
        [1, 2],
        [3, Infinity],
      ]),
    ),
  ])('rejects malformed source data: %j', (raw) => {
    expect(() => buildBorders(raw)).toThrow(Error);
  });

  it.each([
    [180.001, 0],
    [-180.001, 0],
    [0, 90.001],
    [0, -90.001],
  ])('rejects out-of-range source coordinates before rounding (%s, %s)', (lng, lat) => {
    expect(() =>
      buildBorders(
        collection(
          line([
            [0, 0],
            [lng, lat],
          ]),
        ),
      ),
    ).toThrow(/out of range/);
  });
});

describe('validateBorders', () => {
  it('enforces the named production line and point thresholds', () => {
    expect(() => validateBorders(fixture())).toThrow(`expected at least ${MIN_BORDER_LINES}`);
    const dataset = { ...fixture(), lines: Array.from({ length: MIN_BORDER_LINES }, () => [0, 0, 1, 1]) };
    expect(() => validateBorders(dataset)).toThrow(`expected at least ${MIN_BORDER_POINTS}`);
    dataset.lines = Array.from({ length: MIN_BORDER_LINES }, () => [0, 0, ...Array.from({ length: 98 }, () => 1)]);
    expect(validateBorders(dataset)).toEqual({ lines: MIN_BORDER_LINES, points: MIN_BORDER_POINTS });
  });

  it.each([
    [0, 0, 0.1, 1],
    [0, 0, NaN, 1],
    [0, 0, Infinity, 1],
    [0, 0, 1, -Infinity],
    [0, 0, Number.MAX_SAFE_INTEGER + 1, 1],
  ])('rejects non-integer or non-finite encoded coordinates: %j', (...encoded) => {
    expect(() => validateBorders({ ...fixture(), lines: [encoded] }, smallValidation)).toThrow(/finite integers/);
  });

  it.each([
    [18001, 0, -1, 0],
    [-18001, 0, 1, 0],
    [0, 9001, 0, -1],
    [0, -9001, 0, 1],
    [18000, 0, 1, 0],
    [0, -9000, 0, -1],
    [17999, 8999, 1, 1, 1, 1],
  ])('checks every absolute and accumulated coordinate: %j', (...encoded) => {
    expect(() => validateBorders({ ...fixture(), lines: [encoded] }, smallValidation)).toThrow(/out of range/);
  });

  it.each([[], [0, 0], [0, 0, 1], [0, 0, 1, 1, 2], [0, 0, 0, 0]])(
    'rejects incomplete and degenerate lines: %j',
    (...encoded) => {
      expect(() => validateBorders({ ...fixture(), lines: [encoded] }, smallValidation)).toThrow(/Border line 0/);
    },
  );
});
