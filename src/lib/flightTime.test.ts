import { describe, it, expect } from 'vitest';
import { estimateFlightMinutes, formatDuration, sumDurations } from './flightTime.ts';
import { greatCircleDistanceKm } from './geo.ts';
describe('flight-time estimate', () => {
  it('rounds a configurable model and omits same-airport durations', () => {
    expect(estimateFlightMinutes(0)).toBeNull();
    expect(estimateFlightMinutes(0.999)).toBeNull();
    expect(estimateFlightMinutes(850)).toBe(90);
    expect(estimateFlightMinutes(1, { cruiseSpeedKmh: 1000, overheadMinutes: 0, roundingMinutes: 10 })).toBe(10);
    expect(() => estimateFlightMinutes(2, { cruiseSpeedKmh: 0, overheadMinutes: 0, roundingMinutes: 5 })).toThrow();
    expect(sumDurations([null, 45, 65])).toBe(110);
  });
  it('formats hours with two-digit minutes', () => {
    for (const [n, text] of [
      [495, '8h 15m'],
      [65, '1h 05m'],
      [45, '45m'],
      [600, '10h 00m'],
    ] as const)
      expect(formatDuration(n)).toBe(text);
  });
  it('falls within broad typical schedule calibration bands', () => {
    // Sanity bands supplied in the task, not live timetable claims. Winds and routing vary.
    for (const [a, b, min, max] of [
      [{ lat: 55.618, lng: 12.656 }, { lat: 51.471, lng: -0.462 }, 95, 120],
      [{ lat: 51.471, lng: -0.462 }, { lat: 40.64, lng: -73.779 }, 405, 465],
      [{ lat: -33.946, lng: 151.177 }, { lat: 33.943, lng: -118.408 }, 825, 915],
      [{ lat: 55.536, lng: 13.376 }, { lat: 59.652, lng: 17.919 }, 55, 80],
    ] as const) {
      const minutes = estimateFlightMinutes(greatCircleDistanceKm(a, b))!;
      expect(minutes).toBeGreaterThanOrEqual(min);
      expect(minutes).toBeLessThanOrEqual(max);
    }
  });
});
