/** Runtime border decoding and subdivision tests using small, independent fixtures. */

import { describe, expect, it } from 'vitest';
import type { LatLng } from '../types.ts';
import { countSegments, decodeBorders, densifyLine } from './borders.ts';

function dataset(lines: unknown = [[100, 200, -50, 25]]) {
  return { format: 1, source: 'Test borders', url: 'https://example.com/borders.geojson', precision: 100, lines };
}

describe('decodeBorders', () => {
  it('decodes longitude first, accumulates deltas and resets at each line', () => {
    expect(
      decodeBorders(
        dataset([
          [100, 200, -50, 25, -150, -325],
          [-18000, -9000, 36000, 18000],
        ]),
      ),
    ).toEqual([
      [
        { lat: 2, lng: 1 },
        { lat: 2.25, lng: 0.5 },
        { lat: -1, lng: -1 },
      ],
      [
        { lat: -90, lng: -180 },
        { lat: 90, lng: 180 },
      ],
    ]);
    expect(decodeBorders(dataset([]))).toEqual([]);
  });

  it.each([
    null,
    [],
    {},
    { ...dataset(), format: 2 },
    { ...dataset(), format: '1' },
    { ...dataset(), precision: 0 },
    { ...dataset(), precision: 1000 },
    { ...dataset(), source: null },
    { ...dataset(), source: ' ' },
    { ...dataset(), url: 1 },
    { ...dataset(), url: '' },
    dataset(null),
    dataset({}),
    dataset([null]),
    dataset([[]]),
    dataset([[0, 0]]),
    dataset([[0, 0, 1]]),
    dataset([[0, 0, 1, 1, 2]]),
    dataset([[0, 0, 0, 0]]),
    dataset([[0, 0, 0.5, 1]]),
    dataset([[0, 0, '1', 1]]),
    dataset([[0, 0, null, 1]]),
    dataset([[0, 0, NaN, 1]]),
    dataset([[0, 0, 1, Infinity]]),
    dataset([[0, 0, -Infinity, 1]]),
    dataset([[0, 0, Number.MAX_SAFE_INTEGER + 1, 1]]),
    dataset(new Array(1)),
    dataset([new Array(4)]),
  ])('throws Error on malformed input: %j', (raw) => {
    expect(() => decodeBorders(raw)).toThrow(Error);
  });

  it.each([
    [18001, 0, -1, 0],
    [-18001, 0, 1, 0],
    [0, 9001, 0, -1],
    [0, -9001, 0, 1],
    [18000, 0, 1, 0],
    [-18000, 0, -1, 0],
    [0, 9000, 0, 1],
    [0, -9000, 0, -1],
    [17999, 8999, 1, 1, 1, 1],
  ])('rejects out-of-range absolute or accumulated coordinates: %j', (...encoded) => {
    expect(() => decodeBorders(dataset([encoded]))).toThrow(/out of range/);
  });
});

describe('densifyLine', () => {
  it('limits both coordinate steps, preserves each original endpoint and does not mutate input', () => {
    const line: LatLng[] = [
      { lat: -2, lng: 3 },
      { lat: 5, lng: -1 },
      { lat: 4.5, lng: -1.5 },
    ];
    const original = structuredClone(line);
    line.forEach(Object.freeze);
    Object.freeze(line);
    const result = densifyLine(line, 2);
    expect(result).toEqual([
      { lat: -2, lng: 3 },
      { lat: -0.25, lng: 2 },
      { lat: 1.5, lng: 1 },
      { lat: 3.25, lng: 0 },
      { lat: 5, lng: -1 },
      { lat: 4.5, lng: -1.5 },
    ]);
    for (let index = 1; index < result.length; index++) {
      expect(Math.abs(result[index].lat - result[index - 1].lat)).toBeLessThanOrEqual(2);
      expect(Math.abs(result[index].lng - result[index - 1].lng)).toBeLessThanOrEqual(2);
    }
    expect(line).toEqual(original);
    expect(result[0]).not.toBe(line[0]);
    expect(result.at(-1)).not.toBe(line.at(-1));
  });

  it('keeps parallels at the same latitude and meridians at the same longitude', () => {
    const parallel = densifyLine(
      [
        { lat: 49, lng: -123 },
        { lat: 49, lng: -119 },
      ],
      1,
    );
    expect(parallel).toHaveLength(5);
    expect(parallel.every((point) => point.lat === 49)).toBe(true);
    expect(parallel.map((point) => point.lng)).toEqual([-123, -122, -121, -120, -119]);
    const meridian = densifyLine(
      [
        { lat: 4, lng: 20 },
        { lat: 0, lng: 20 },
      ],
      1,
    );
    expect(meridian).toHaveLength(5);
    expect(meridian.every((point) => point.lng === 20)).toBe(true);
  });

  it('leaves antimeridian steps untouched in either direction, then resumes subdivision', () => {
    const line = [
      { lat: 5, lng: 179 },
      { lat: 10, lng: -179 },
      { lat: 5, lng: 179 },
      { lat: 5, lng: 177 },
    ];
    expect(densifyLine(line, 1)).toEqual([...line.slice(0, 3), { lat: 5, lng: 178 }, line[3]]);
  });

  it('densifies a step of exactly 180 degrees', () => {
    expect(
      densifyLine(
        [
          { lat: 0, lng: -90 },
          { lat: 0, lng: 90 },
        ],
        90,
      ),
    ).toEqual([
      { lat: 0, lng: -90 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 90 },
    ]);
  });

  it.each<LatLng[][]>([
    [[]],
    [[{ lat: 1, lng: 2 }]],
    [
      [
        { lat: 1, lng: 2 },
        { lat: 1.25, lng: 2.5 },
      ],
    ],
    [
      [
        { lat: 1, lng: 2 },
        { lat: 1, lng: 2 },
      ],
    ],
    [
      [
        { lat: 1, lng: 2 },
        { lat: 2, lng: 3 },
      ],
    ],
  ])('returns a new array without adding points to short lines: %j', (line) => {
    const result = densifyLine(line, 1);
    expect(result).toEqual(line);
    expect(result).not.toBe(line);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid maximum steps: %s', (maxStepDeg) => {
    expect(() => densifyLine([], maxStepDeg)).toThrow(/finite and positive/);
  });
});

describe('countSegments', () => {
  it('counts adjacent pairs without bridging lines or counting empty and single-point lines', () => {
    const first = densifyLine(
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 4 },
      ],
      1,
    );
    const second = densifyLine(
      [
        { lat: 2, lng: 2 },
        { lat: 4, lng: 2 },
      ],
      1,
    );
    expect(countSegments([[], [{ lat: 0, lng: 0 }], first, second])).toBe(6);
    expect(countSegments([])).toBe(0);
  });
});
