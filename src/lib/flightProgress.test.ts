import { describe, it, expect } from 'vitest';
import { altitudeProfile } from './altitude.ts';
import { distanceFractionAt, flightPhaseAt, progressModel } from './flightProgress.ts';
describe('time to distance progress', () => {
  it.each([
    [100, 20],
    [1000, 100],
    [16000, 1000],
    [1000, 2],
  ])('is strictly monotonic over %i km / %i minutes', (distance, duration) => {
    const m = progressModel(distance, duration);
    const fractions = Array.from({ length: 1001 }, (_, i) => distanceFractionAt(m, (duration * i) / 1000));
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions.slice(1).every((f, i) => f > fractions[i])).toBe(true);
    expect(distanceFractionAt(m, -100)).toBe(0);
    expect(distanceFractionAt(m, duration + 100)).toBe(1);
    expect(m.climbKm).toBe(altitudeProfile(distance).climbKm);
    expect(m.descentKm).toBe(altitudeProfile(distance).descentKm);
  });
  it('uses all short-leg time for climb/descent and reserves cruise for long legs', () => {
    const short = progressModel(100, 20),
      long = progressModel(1000, 10);
    expect(short.climbMin + short.descentMin).toBeCloseTo(20);
    expect(long.climbMin + long.descentMin).toBeCloseTo(8);
    expect(flightPhaseAt(long, 0)).toBe('climb');
    expect(flightPhaseAt(long, long.climbMin)).toBe('cruise');
    expect(flightPhaseAt(long, long.durationMin - long.descentMin)).toBe('descent');
    expect(distanceFractionAt(long, long.climbMin)).toBeCloseTo(long.climbKm / 1000);
    expect(distanceFractionAt(long, long.durationMin - long.descentMin)).toBeCloseTo(1 - long.descentKm / 1000);
  });
  it('handles zero duration and distance without NaN', () => {
    expect(distanceFractionAt(progressModel(0, 10), 5)).toBe(0.5);
    expect(distanceFractionAt(progressModel(0, 0), 1)).toBe(1);
  });
});
