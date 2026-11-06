/** Day texture: lighter deep oceans without touching land, ice or bathymetry order. */

import { describe, expect, it } from 'vitest';
import { liftOceanPixel, liftOceans, waterWeight } from './lib/ocean.ts';

const brightness = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('liftOceanPixel', () => {
  it('turns the near-black deep ocean into a clearly visible navy', () => {
    const [r, g, b] = liftOceanPixel(2, 5, 20); // North Pacific basin
    expect(b).toBeGreaterThanOrEqual(65);
    expect(g).toBeGreaterThanOrEqual(25);
    expect(r).toBeLessThan(g);
    expect(g).toBeLessThan(b);
  });

  it('leaves land, deserts, forests, snow and ice unchanged', () => {
    const land: [number, number, number][] = [
      [20, 34, 9], // Amazon
      [202, 169, 124], // Sahara
      [28, 45, 13], // Siberian taiga
      [251, 253, 252], // Greenland ice
      [136, 144, 123], // Alps
      [0, 3, 6], // Lake Superior: near-black, kept as in the source
    ];
    for (const pixel of land) expect(liftOceanPixel(...pixel)).toEqual(pixel);
  });

  it('keeps the order of bathymetry gradations and lifts shallows least', () => {
    const depths: [number, number, number][] = [
      [2, 5, 20],
      [8, 24, 58],
      [17, 44, 91],
      [28, 70, 128],
    ];
    const lifted = depths.map((pixel) => liftOceanPixel(...pixel));
    for (let i = 1; i < lifted.length; i++) expect(brightness(lifted[i])).toBeGreaterThan(brightness(lifted[i - 1]));
    const gain = depths.map((pixel, i) => lifted[i][2] - pixel[2]);
    for (let i = 1; i < gain.length; i++) expect(gain[i]).toBeLessThan(gain[i - 1]);
  });

  it('is monotonic in blue across the whole water range', () => {
    let previous = -1;
    for (let b = 0; b <= 255; b++) {
      const lifted = liftOceanPixel(0, 0, b)[2];
      expect(lifted).toBeGreaterThanOrEqual(previous);
      previous = lifted;
    }
    expect(waterWeight(0, 0, 0)).toBe(0);
    expect(waterWeight(0, 0, 30)).toBe(1);
  });
});

describe('liftOceans', () => {
  it('maps interleaved RGB without changing its length', () => {
    expect(Array.from(liftOceans(new Uint8Array([20, 34, 9, 2, 5, 20])))).toEqual([
      20,
      34,
      9,
      ...liftOceanPixel(2, 5, 20),
    ]);
  });

  it('rejects data that is not RGB', () => {
    expect(() => liftOceans(new Uint8Array(4))).toThrow(/RGB/);
  });
});
