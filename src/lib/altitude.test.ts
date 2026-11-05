import { describe, it, expect } from 'vitest';
import {
  altitudeAt,
  altitudeProfile,
  climbDistanceKm,
  DEFAULT_ALTITUDE_MODEL,
  descentDistanceKm,
  exaggeratedLift,
  locateFraction,
  profileFractions,
} from './altitude.ts';

const cruise = DEFAULT_ALTITUDE_MODEL.cruiseAltitudeKm;
const climb = climbDistanceKm();
const descent = descentDistanceKm();

describe('altitude profile', () => {
  it('derives climb and descent distances from typical times and speeds', () => {
    expect(climb).toBeCloseTo(200);
    expect(descent).toBeCloseTo(229.2, 1);
  });

  it('climbs to cruise in the climb distance, holds it, and leaves it only for the descent', () => {
    const p = altitudeProfile(5540); // London–New York
    expect(p.peakKm).toBe(cruise);
    expect(altitudeAt(p, 0)).toBe(0);
    expect(altitudeAt(p, 5540)).toBeCloseTo(0, 9);
    expect(altitudeAt(p, climb)).toBe(cruise);
    expect(altitudeAt(p, climb / 2)).toBeGreaterThan(cruise / 2);
    expect(altitudeAt(p, climb / 2)).toBeLessThan(cruise);
    for (const s of [climb, 1000, 2770, 4000, 5540 - descent]) expect(altitudeAt(p, s)).toBe(cruise);
    expect(altitudeAt(p, 5540 - descent / 2)).toBeLessThan(cruise);
  });

  it('rises monotonically during the climb and falls monotonically during the descent', () => {
    const p = altitudeProfile(12000);
    let previous = -1;
    for (let s = 0; s <= climb; s += 5) {
      const a = altitudeAt(p, s);
      expect(a).toBeGreaterThanOrEqual(previous);
      previous = a;
    }
    previous = Infinity;
    for (let s = 12000 - descent; s <= 12000; s += 5) {
      const a = altitudeAt(p, s);
      expect(a).toBeLessThanOrEqual(previous);
      previous = a;
    }
  });

  it('peaks lower on legs too short to reach cruise, with a smooth top', () => {
    const p = altitudeProfile(300);
    expect(p.peakKm).toBeLessThan(cruise);
    expect(p.peakKm).toBeGreaterThan(cruise / 2);
    expect(p.climbKm + p.descentKm).toBeCloseTo(300);
    expect(altitudeAt(p, p.climbKm)).toBeCloseTo(p.peakKm);
    expect(altitudeAt(p, p.climbKm - 1)).toBeCloseTo(p.peakKm, 1);
    expect(altitudeProfile(30).peakKm).toBeLessThan(altitudeProfile(100).peakKm);
    expect(altitudeAt(altitudeProfile(0), 0)).toBe(0);
  });

  it('clamps positions outside the leg and handles invalid distances', () => {
    const p = altitudeProfile(1000);
    expect(altitudeAt(p, -50)).toBe(0);
    expect(altitudeAt(p, 5000)).toBeCloseTo(0, 9);
    expect(altitudeProfile(Number.NaN).distanceKm).toBe(0);
  });

  it('exaggerates altitude into scene units', () => {
    expect(exaggeratedLift(cruise, 1)).toBeCloseTo(cruise / 6371.0088);
    expect(exaggeratedLift(cruise, 10)).toBeCloseTo((cruise / 6371.0088) * 10);
  });
});

describe('arc sampling', () => {
  it('samples densely through climb and descent and evenly in cruise', () => {
    const p = altitudeProfile(10000);
    const f = profileFractions(p, { phaseSegments: 10, maxCruiseStepKm: 100 });
    expect(f[0]).toBe(0);
    expect(f[f.length - 1]).toBe(1);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
    const inClimb = f.filter((x) => x * 10000 <= climb + 1e-6).length;
    expect(inClimb).toBe(11);
    // Cruise steps never exceed the configured step.
    const steps = f.slice(1).map((x, i) => (x - f[i]) * 10000);
    expect(Math.max(...steps)).toBeLessThanOrEqual(100 + 1e-6);
  });

  it('caps cruise samples on very long legs and handles short and empty legs', () => {
    expect(profileFractions(altitudeProfile(20000), { maxCruiseSegments: 50, phaseSegments: 5 })).toHaveLength(61);
    const short = profileFractions(altitudeProfile(50), { phaseSegments: 4 });
    expect(short[0]).toBe(0);
    expect(short[short.length - 1]).toBe(1);
    expect(profileFractions(altitudeProfile(0))).toEqual([0, 1]);
  });

  it('locates a fraction within the samples', () => {
    const f = [0, 0.1, 0.5, 1];
    const near = (f2: number, index: number, t: number) => {
      const r = locateFraction(f, f2);
      expect(r.index).toBe(index);
      expect(r.t).toBeCloseTo(t, 9);
    };
    near(0, 0, 0);
    near(0.05, 0, 0.5);
    near(0.3, 1, 0.5);
    near(0.75, 2, 0.5);
    near(1, 2, 1);
    near(2, 2, 1);
    expect(locateFraction([0], 0.5)).toEqual({ index: 0, t: 0 });
  });
});
