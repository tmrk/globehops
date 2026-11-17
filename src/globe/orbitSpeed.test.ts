import { describe, expect, it } from 'vitest';
import { MIN_ALTITUDE, orbitRotateSpeed } from './orbitSpeed.ts';

describe('orbitRotateSpeed', () => {
  it('matches the geometry at a 30 degree field of view', () => {
    expect(orbitRotateSpeed(1.121, 30)).toBeCloseTo((0.121 * 30) / 360, 12);
    expect(orbitRotateSpeed(1.32, 30)).toBeCloseTo((0.32 * 30) / 360, 12);
    expect(orbitRotateSpeed(2, 30)).toBeCloseTo(1 / 12, 12);
    expect(orbitRotateSpeed(4, 30)).toBeCloseTo(0.25, 12);
  });

  it('keeps falling below the old minimum distance', () => {
    expect(orbitRotateSpeed(1.121, 30)).toBeLessThan(orbitRotateSpeed(1.32, 30));
    expect(orbitRotateSpeed(1.32, 30)).toBeLessThan(0.12);
  });

  it('scales with the field of view', () => {
    expect(orbitRotateSpeed(2, 60)).toBeCloseTo(2 * orbitRotateSpeed(2, 30), 12);
  });

  it('stays positive when the camera is at or below the surface', () => {
    const floor = (MIN_ALTITUDE * 30) / 360;
    expect(orbitRotateSpeed(1, 30)).toBeCloseTo(floor, 12);
    expect(orbitRotateSpeed(0.5, 30)).toBeCloseTo(floor, 12);
    expect(orbitRotateSpeed(1, 30)).toBeGreaterThan(0);
  });
});
