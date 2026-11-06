/** Night-light mask: Black Marble background removal and range. */

import { describe, expect, it } from 'vitest';
import { lightMask, lightValue } from './lib/lights.ts';

describe('lightValue', () => {
  it('removes bluish moonlit land, ice and ocean', () => {
    expect(lightValue(5, 15)).toBe(0); // open ocean
    expect(lightValue(11, 28)).toBe(0); // rural land
    expect(lightValue(42, 84)).toBe(0); // Antarctic ice
    expect(lightValue(37, 62)).toBeLessThan(5); // desert
  });

  it('keeps city cores at full brightness and warm fringes visible', () => {
    expect(lightValue(252, 249)).toBe(255);
    expect(lightValue(120, 60)).toBeGreaterThan(100);
  });
});

describe('lightMask', () => {
  it('maps interleaved RGB to one value per pixel', () => {
    expect(Array.from(lightMask(new Uint8Array([5, 5, 15, 252, 251, 249])))).toEqual([0, 255]);
  });

  it('rejects data that is not RGB', () => {
    expect(() => lightMask(new Uint8Array(4))).toThrow(/RGB/);
  });
});
