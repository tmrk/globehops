import { describe, expect, it } from 'vitest';
import {
  legTrack,
  normalizeTrack,
  reverseTrack,
  sameTrack,
  simplifyTrackIndices,
  trackAltitudeKmAt,
  trackFlightPhaseAt,
  trackFractionAtTime,
  type CustomTrack,
} from './track.ts';
import { pathLengthKm } from './routePath.ts';

const track = (recorded = true): CustomTrack => ({
  kind: recorded ? 'recorded' : 'planned',
  source: { format: 'gpx', name: 'test' },
  points: [0, 1, 3, 4, 5].map((lng, i) => ({
    lat: 0,
    lng,
    altM: i === 1 ? 1000 : i === 3 ? 4000 : null,
    time: i === 1 ? 100000 : i === 3 ? 400000 : null,
  })),
});
describe('custom path math', () => {
  it('caches geometry and interpolates sparse altitudes/times along distance, holding at ends', () => {
    const t = track(),
      lt = legTrack(t);
    expect(legTrack(t)).toBe(lt);
    expect(legTrack(t).path).toBe(lt.path);
    expect(lt.altitudesKm).toEqual([1, 1, 3, 4, 4]);
    expect(lt.times).toEqual([100000, 100000, 300000, 400000, 400000]);
    expect(lt.distanceKm).toBeCloseTo(pathLengthKm(lt.path));
    expect(lt.reducedFrom).toBeNull();
    expect(trackFractionAtTime(lt, 200000)).toBeCloseTo(0.4);
    expect(trackFractionAtTime(lt, -1)).toBe(0);
    expect(trackFractionAtTime(lt, 400000)).toBe(1);
    expect(trackAltitudeKmAt(lt, 0.4)).toBeCloseTo(2);
    expect(trackAltitudeKmAt(lt, -1)).toBe(1);
    expect(trackAltitudeKmAt(lt, 2)).toBe(4);
    expect(trackFlightPhaseAt(lt, 200000)).toBe('climb');
    const descending = { ...t, points: t.points.map((p) => ({ ...p, altM: p.altM === null ? null : 5000 - p.altM })) };
    expect(trackFlightPhaseAt(legTrack(descending), 200000)).toBe('descent');
    expect(trackFlightPhaseAt(legTrack({ ...t, kind: 'planned' }), 200000)).toBe('cruise');
  });
  it('normalizes invalid inputs without mutating the original and downgrades incomplete recordings', () => {
    const t = track();
    t.points[0].lat = 91;
    t.points[1].altM = 30001;
    t.points[2].time = 50000;
    t.points[3].time = NaN;
    const result = normalizeTrack(t);
    expect(result.dropped).toBe(1);
    expect(result.track?.kind).toBe('planned');
    expect(result.track?.points.map((p) => p.time)).toEqual([100000, null, null, null]);
    expect(result.track?.points[0].altM).toBeNull();
    expect(legTrack(result.track!).times).toBeNull();
    expect(legTrack(result.track!).altitudesKm).toBeNull();
    expect(Number.isNaN(t.points[3].time)).toBe(true);
    expect(normalizeTrack({ ...t, points: t.points.slice(0, 1) }).track).toBeNull();
    const valid = track();
    expect(normalizeTrack(valid).track).toBe(valid);
  });
  it('handles repeated positions and timestamps without nonfinite interpolation', () => {
    const t = track();
    t.points = t.points.map((p, i) => ({ ...p, lng: 0, time: i < 3 ? 1000 : 2000 }));
    const lt = legTrack(t);
    expect(lt.altitudesKm?.every(Number.isFinite)).toBe(true);
    expect(trackFractionAtTime(lt, 1500)).toBe(0);
    expect(trackAltitudeKmAt(lt, 0.5)).toBeTypeOf('number');
  });
  it('reverses only planned paths, discards times and compares values structurally', () => {
    expect(reverseTrack(track())).toBeNull();
    const t = track(false),
      reversed = reverseTrack(t)!;
    expect(reversed.points.map((p) => p.lng)).toEqual([5, 4, 3, 1, 0]);
    expect(reversed.points.every((p) => p.time === null)).toBe(true);
    expect(sameTrack(t, structuredClone(t))).toBe(true);
    expect(sameTrack(t, reversed)).toBe(false);
    expect(sameTrack(null, undefined)).toBe(true);
  });
  it('keeps spherical bends, dateline crossings and ends under a cap', () => {
    const path = [
      { lat: 0, lng: 179 },
      { lat: 0, lng: 180 },
      { lat: 0, lng: -179 },
      { lat: 5, lng: -178 },
      { lat: 0, lng: -177 },
    ];
    expect(simplifyTrackIndices(path, { toleranceKm: 1 })).toEqual([0, 2, 3, 4]);
    expect(simplifyTrackIndices(path, { maxPoints: 3 })).toEqual([0, 3, 4]);
    expect(simplifyTrackIndices(path, { maxPoints: 1 })).toEqual([0, 4]);
    expect(simplifyTrackIndices([])).toEqual([]);
    expect(simplifyTrackIndices([{ lat: 0, lng: 0 }])).toEqual([0]);
    const points = Array.from({ length: 1000 }, (_, i) => ({ lat: 10 * Math.sin(i / 80), lng: i / 10 - 50 }));
    const reduced = simplifyTrackIndices(points, { toleranceKm: 10 });
    expect(reduced[0]).toBe(0);
    expect(reduced.at(-1)).toBe(999);
    expect(reduced.length).toBeLessThan(100);
  });
  it('simplifies a 250k-point flight without recursion within a practical Node budget', () => {
    const path = Array.from({ length: 250000 }, (_, i) => ({
      lat: 50 + 5 * Math.sin(i / 100000),
      lng: -80 + i / 2500,
    }));
    const start = performance.now();
    const indices = simplifyTrackIndices(path, { toleranceKm: 1, maxPoints: 300 });
    expect(performance.now() - start).toBeLessThan(600); // allows contention from Vitest workers
    expect(indices.length).toBeLessThanOrEqual(300);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(249999);
  });
});
