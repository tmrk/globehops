import { describe, expect, it } from 'vitest';
import type { Airport } from '../types.ts';
import { computeJourney } from '../lib/schedule.ts';
import { buildTimeline } from '../lib/timeline.ts';
import { subsolarPoint } from '../lib/sun.ts';
import { SimulationClock } from './clock.ts';
import { createSimulationFeed, simFrameAt } from './simulation.ts';
const airports: Airport[] = ['CPH', 'LHR', 'JFK'].map((code, i) => ({
  id: i,
  ident: code,
  iata: code,
  icao: null,
  name: code,
  city: code,
  country: '',
  countryCode: '',
  region: '',
  type: 'large',
  scheduled: true,
  keywords: [],
  lat: 50 - i * 5,
  lng: 10 - i * 30,
}));
const journey = computeJourney({
  id: 'A',
  stops: airports.map((airport, i) => ({
    airport,
    zone: 'UTC',
    layoverMin: 90,
    arrival: null,
    departure: i === 0 ? { local: '2026-11-20T08:00', offsetMin: null } : null,
  })),
});
const timeline = buildTimeline(journey)!;
describe('simulation frames', () => {
  it('parks before departure and at the final arrival', () => {
    expect(simFrameAt(journey, timeline, timeline.start - 1, true).aircraft).toEqual({
      kind: 'ground',
      leg: 0,
      at: 'start',
    });
    expect(simFrameAt(journey, timeline, timeline.end, true)).toMatchObject({
      aircraft: { kind: 'ground', leg: 1, at: 'end' },
      highlightLeg: 1,
    });
  });
  it('flies from deterministic distance progress and parks during connections', () => {
    const mid = (timeline.start + timeline.segments[0].end) / 2;
    const frame = simFrameAt(journey, timeline, mid, true);
    expect(frame.aircraft).toMatchObject({ kind: 'air', leg: 0 });
    if (frame.aircraft?.kind === 'air') expect(frame.aircraft.fraction).toBeGreaterThan(0);
    expect(frame.highlightLeg).toBe(0);
    expect(simFrameAt(journey, timeline, timeline.segments[0].end, true).aircraft).toEqual({
      kind: 'ground',
      leg: 0,
      at: 'end',
    });
    expect(simFrameAt(journey, timeline, timeline.segments[1].end, true).aircraft).toEqual({
      kind: 'air',
      leg: 1,
      fraction: 0,
    });
  });
  it('uses the same UTC instant for sunlight and hides simulation when closed or invalid', () => {
    expect(simFrameAt(journey, null, timeline.start, true)).toEqual({
      subsolar: subsolarPoint(timeline.start),
      aircraft: null,
      highlightLeg: null,
      follow: false,
    });
    expect(simFrameAt(journey, timeline, timeline.start, false).subsolar).toBeNull();
    expect(simFrameAt({ ...journey, playable: false }, timeline, timeline.start, true).aircraft).toBeNull();
  });
  it('predicts real-time distance velocity only during playback', () => {
    const clock = new SimulationClock({ now: () => timeline.start, requestFrame: () => 1, cancelFrame: () => {} });
    const context = { journey, timeline, open: true, dayNight: false, follow: true };
    const feed = createSimulationFeed(clock, () => context);
    clock.setRange(timeline.start, timeline.end);
    clock.seek((timeline.start + timeline.segments[0].end) / 2);
    expect(feed.getFrame().aircraft).not.toHaveProperty('fractionPerSecond');
    clock.play();
    const frame = feed.getFrame();
    expect(frame.follow).toBe(true);
    expect(frame.aircraft?.kind).toBe('air');
    if (frame.aircraft?.kind === 'air') expect(frame.aircraft.fractionPerSecond).toBeGreaterThan(0);
    clock.pause();
    expect(feed.getFrame().follow).toBe(false);
    expect(feed.getFrame().aircraft).not.toHaveProperty('fractionPerSecond');
    clock.dispose();
  });
  it('caches unchanged frames and notifies subscribers when context changes', () => {
    const clock = new SimulationClock({ now: () => timeline.start });
    const context = { journey, timeline, open: true, dayNight: true, follow: true };
    const feed = createSimulationFeed(clock, () => context);
    let calls = 0;
    const off = feed.subscribe(() => calls++);
    const frame = feed.getFrame();
    expect(feed.getFrame()).toBe(frame);
    feed.refresh();
    expect(calls).toBe(0);
    clock.seek(timeline.start + 10000);
    expect(calls).toBe(1);
    expect(feed.getFrame()).not.toBe(frame);
    context.open = false;
    feed.refresh();
    expect(feed.getFrame().aircraft).toBeNull();
    expect(calls).toBe(2);
    off();
    clock.dispose();
  });
});
