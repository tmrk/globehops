import { describe, expect, it } from 'vitest';
import { decodeTrack, encodeTrack, fitTracks, TRACK_FORMATS } from './trackCodec.ts';
import { legTrack, type CustomTrack } from './track.ts';
import { MAX_TRACK_POINTS } from '../agent/contract.ts';
const track = (n = 100, recorded = true): CustomTrack => ({
  kind: recorded ? 'recorded' : 'planned',
  source: { format: 'gpx', name: 'private file' },
  points: Array.from({ length: n }, (_, i) => ({
    lat: 50 + Math.sin(i / 3),
    lng: -179.123456 + i * 0.01,
    altM: i * 3.123,
    time: Date.UTC(2026, 2, 1) + i * 1000.12,
  })),
});
describe('track link codec', () => {
  it.each(TRACK_FORMATS)('round-trips %s, geometry, altitude and recorded instants', (format) => {
    const t = track();
    t.source.format = format;
    const encoded = encodeTrack(t);
    expect(encoded).toMatch(/^[A-Za-z0-9_.-]+$/);
    const decoded = decodeTrack(encoded)!;
    expect(decoded.kind).toBe('recorded');
    expect(decoded.source).toEqual({ format, name: null });
    decoded.points.forEach((p, i) => {
      expect(Math.abs(p.lat - t.points[i].lat)).toBeLessThanOrEqual(1e-5);
      expect(Math.abs(p.lng - t.points[i].lng)).toBeLessThanOrEqual(1e-5);
      expect(Math.abs(p.altM! - t.points[i].altM!)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.time! - t.points[i].time!)).toBeLessThanOrEqual(1000);
    });
    const planned = decodeTrack(encodeTrack({ ...t, kind: 'planned' }))!;
    expect(planned.kind).toBe('planned');
    expect(planned.points.every((p) => p.time === null)).toBe(true);
  });
  it('fills sparse altitudes/times and drops flags without two values', () => {
    const t = track(3);
    t.points[1].altM = null;
    t.points[1].time = null;
    const decoded = decodeTrack(encodeTrack(t))!;
    expect(decoded.points[1].altM).toBeCloseTo(legTrack(t).altitudesKm![1] * 1000, 0);
    const sparse = structuredClone(t);
    sparse.points[0].altM = null;
    sparse.points[0].time = null;
    const planned = decodeTrack(encodeTrack(sparse))!;
    expect(planned.kind).toBe('planned');
    expect(planned.points.every((p) => p.altM === null)).toBe(true);
  });
  it.each([
    '',
    'garbage',
    '2rgD.AAAA',
    '1rgD.____',
    '1rgA.AAAA',
    '1pgD.AAAA',
    '1pgE.AAAA',
    '1pgA.A',
    '1pgA.💥',
    '1pgA.AAAA.',
  ])('rejects garbage %j without throwing', (value) => {
    expect(decodeTrack(value)).toBeNull();
  });
  it('rejects out-of-range positions, altitudes, times and excess points', () => {
    for (const changes of [{ lat: 91 }, { lng: 181 }, { altM: 30001 }, { time: Date.UTC(2200, 0, 1) }]) {
      const t = track(2);
      Object.assign(t.points[1], changes);
      expect(decodeTrack(encodeTrack(t))).toBeNull();
    }
    expect(decodeTrack(encodeTrack(track(MAX_TRACK_POINTS + 1)))).toBeNull();
  });
  it('fits proportionally and deterministically using original subsets, preserving endpoints and order', () => {
    const a = track(3000),
      b = track(1000),
      originals = [a, null, b];
    expect(fitTracks(originals, 100000)).toEqual({ tracks: originals, reduced: null });
    expect(fitTracks(originals, 100000).tracks[0]).toBe(a);
    const fit = fitTracks(originals, 1000);
    expect(fit).toEqual(fitTracks(originals, 1000));
    expect(fit.reduced?.total).toBe(4000);
    expect(fit.tracks.reduce((n, t) => n + (t ? encodeTrack(t).length : 0), 0)).toBeLessThanOrEqual(1000);
    for (const [i, original] of [
      [0, a],
      [2, b],
    ] as const) {
      const reduced = fit.tracks[i]!;
      expect(reduced.points[0]).toBe(original.points[0]);
      expect(reduced.points.at(-1)).toBe(original.points.at(-1));
      expect(reduced.points.every((p) => original.points.includes(p))).toBe(true);
      expect(reduced.reducedFrom).toBe(original.points.length);
      expect(reduced.points.map((p) => p.time)).toEqual(reduced.points.map((p) => p.time).sort((a, b) => a! - b!));
    }
    const minimum = encodeTrack({ ...a, points: [a.points[0], a.points.at(-1)!] }).length;
    expect(fitTracks([a, b], minimum).tracks.map(Boolean)).toEqual([true, false]);
    expect(fitTracks([a, b], 0)).toEqual({ tracks: [null, null], reduced: { kept: 0, total: 4000 } });
    expect(a.reducedFrom).toBeUndefined();
    expect(a.points).toHaveLength(3000);
  });
});

it('retains recorded timing and usable altitude at sparse endpoints when sharing only two vertices', () => {
  const t = track(5);
  t.points[0].altM = null;
  t.points[0].time = null;
  t.points[4].altM = null;
  t.points[4].time = null;
  const minimum = encodeTrack({
    ...t,
    points: [
      { ...t.points[0], altM: t.points[1].altM, time: t.points[1].time },
      { ...t.points[4], altM: t.points[3].altM, time: t.points[3].time },
    ],
  }).length;
  const fit = fitTracks([t], minimum);
  expect(fit.tracks[0]?.points).toHaveLength(2);
  const decoded = decodeTrack(encodeTrack(fit.tracks[0]!))!;
  expect(decoded.kind).toBe('recorded');
  expect(decoded.points.every((p) => p.altM !== null && p.time !== null)).toBe(true);
  expect(t.points[0].time).toBeNull();
});

it('normalizes bad share inputs and reports dropped tracks rather than failing URL construction', () => {
  const t = track(2);
  const bad = { ...t, points: t.points.map((p) => ({ ...p, lat: Infinity })) };
  expect(fitTracks([bad, t], 1000)).toEqual({ tracks: [null, t], reduced: { kept: 2, total: 4 } });
  const unsupported = { ...t, points: t.points.map((p) => ({ ...p, time: 1e300 })) };
  expect(fitTracks([unsupported], 1000)).toEqual({ tracks: [null], reduced: { kept: 0, total: 2 } });
});
