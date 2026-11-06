import { describe, it, expect } from 'vitest';
import type { Airport } from '../types.ts';
import { computeJourney } from './schedule.ts';
import { buildTimeline, journeyStateAt } from './timeline.ts';
const airports: Airport[] = [
  ['CPH', 55.618, 12.656],
  ['LHR', 51.4706, -0.4619],
  ['JFK', 40.6398, -73.7789],
].map(([code, lat, lng], i) => ({
  id: i,
  ident: String(code),
  iata: String(code),
  icao: null,
  name: String(code),
  city: String(code),
  lat: Number(lat),
  lng: Number(lng),
  country: '',
  countryCode: '',
  region: '',
  type: 'large',
  scheduled: true,
  keywords: [],
}));
const stops = airports.map((airport, i) => ({
  airport,
  zone: ['Europe/Copenhagen', 'Europe/London', 'America/New_York'][i],
  layoverMin: 2880,
  arrival: null,
  departure: i === 0 ? { local: '2026-11-20T08:00', offsetMin: null } : null,
}));
describe('journey timeline', () => {
  const j = computeJourney({ id: 'A', stops });
  const tl = buildTimeline(j)!;
  it('requires a playable journey', () => {
    expect(buildTimeline(computeJourney({ id: 'A', stops: [] }))).toBeNull();
    expect(buildTimeline({ ...j, playable: false })).toBeNull();
  });
  it('builds ordered flight/ground boundaries', () => {
    expect(tl.journeyId).toBe('A');
    expect(tl.segments.map((s) => s.kind)).toEqual(['flight', 'ground', 'flight']);
    expect(tl.start).toBe(tl.segments[0].start);
    expect(tl.end).toBe(tl.segments[2].end);
    expect(tl.segments[0].end).toBe(tl.segments[1].start);
    expect(tl.segments[1].end).toBe(tl.segments[2].start);
    expect(tl.segments[1].end - tl.segments[1].start).toBe(2880 * 60000);
  });
  it('assigns each exact boundary to the later segment and end to after', () => {
    expect(journeyStateAt(j, tl, tl.start - 1)).toEqual({ phase: 'before', stop: 0, leg: 0, nextDeparture: tl.start });
    expect(journeyStateAt(j, tl, tl.start)).toMatchObject({ phase: 'flight', leg: 0, elapsedMin: 0 });
    const arrival = tl.segments[0].end,
      departure = tl.segments[1].end;
    expect(journeyStateAt(j, tl, arrival)).toEqual({
      phase: 'transfer',
      stop: 1,
      leg: 1,
      arrival,
      departure,
      untilDepartureMin: 2880,
    });
    expect(journeyStateAt(j, tl, departure)).toMatchObject({ phase: 'flight', leg: 1, elapsedMin: 0 });
    expect(journeyStateAt(j, tl, tl.end)).toEqual({ phase: 'after', stop: 2, leg: 1 });
    expect(journeyStateAt(j, tl, tl.end + 99999)).toEqual(journeyStateAt(j, tl, tl.end));
  });
  it('is deterministic at the same instant and when scrubbing backwards', () => {
    const instant = tl.start + 30 * 60000;
    const state = journeyStateAt(j, tl, instant);
    expect(journeyStateAt(j, tl, instant)).toEqual(state);
    journeyStateAt(j, tl, tl.end);
    journeyStateAt(j, tl, tl.segments[1].start);
    expect(journeyStateAt(j, tl, instant)).toEqual(state);
    expect(state).toMatchObject({ phase: 'flight', flightPhase: 'cruise', elapsedMin: 30 });
    if (state.phase === 'flight') {
      expect(state.position.lng).toBeLessThan(airports[0].lng);
      expect(state.position.lng).toBeGreaterThan(airports[1].lng);
      expect(state.altitudeKm).toBe(11);
    }
  });
  it('keeps cached models consistent when a timeline is reused for changed flight geometry or duration', () => {
    const journey = computeJourney({ id: 'A', stops });
    const timeline = buildTimeline(journey);
    if (!timeline) throw new Error('Expected a playable timeline');
    const segment = timeline.segments[0];
    const instant = segment.start + 15 * 60000;
    journeyStateAt(journey, timeline, instant);
    const changed = { ...journey, legs: journey.legs.map((leg) => ({ ...leg, distanceKm: leg.distanceKm * 2 })) };
    expect(journeyStateAt(changed, timeline, instant)).toEqual(
      journeyStateAt(changed, { ...timeline, segments: timeline.segments.map((entry) => ({ ...entry })) }, instant),
    );
    segment.end += 30 * 60000;
    expect(journeyStateAt(changed, timeline, instant)).toEqual(
      journeyStateAt(changed, { ...timeline, segments: timeline.segments.map((entry) => ({ ...entry })) }, instant),
    );
  });
  it('skips zero-duration legs and zero-duration transfers', () => {
    const zeroStops = [stops[0], { ...stops[0], departure: null, layoverMin: 0 }, stops[2]];
    const zero = computeJourney({ id: 'Z', stops: zeroStops });
    const ztl = buildTimeline(zero)!;
    expect(ztl.segments).toHaveLength(1);
    expect(journeyStateAt(zero, ztl, ztl.start)).toMatchObject({ phase: 'flight', leg: 1 });
  });
});
