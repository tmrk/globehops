import { describe, expect, it } from 'vitest';
import { ORIGINAL_MIN_DISTANCE, orbitRotateSpeed } from './orbitSpeed.ts';

const original = (d: number) => Math.max(0.12, Math.min(0.75, (d - 1) * 0.28));

describe('orbitRotateSpeed', () => {
  it('keeps the original speeds from the ordinary closest zoom outwards', () => {
    for (const d of [ORIGINAL_MIN_DISTANCE, 1.4, 1.5, 2, 3, 4, 6])
      expect(orbitRotateSpeed(d)).toBeCloseTo(original(d), 12);
  });

  it('slows in proportion to height when zoomed closer than that', () => {
    expect(orbitRotateSpeed(1.16)).toBeCloseTo(0.06, 12);
    expect(orbitRotateSpeed(1.121)).toBeCloseTo((0.12 * 0.121) / 0.32, 12);
    expect(orbitRotateSpeed(1.121)).toBeLessThan(orbitRotateSpeed(1.2));
  });

  it('is continuous at the ordinary closest zoom', () => {
    expect(orbitRotateSpeed(ORIGINAL_MIN_DISTANCE - 1e-9)).toBeCloseTo(orbitRotateSpeed(ORIGINAL_MIN_DISTANCE), 6);
  });

  it('stays positive at or below the surface', () => {
    expect(orbitRotateSpeed(1)).toBeGreaterThan(0);
    expect(orbitRotateSpeed(0.5)).toBeGreaterThan(0);
  });
});
