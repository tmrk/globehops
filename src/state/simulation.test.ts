import { describe, expect, it, vi } from 'vitest';
import type { Airport } from '../types.ts';
import { computeJourney } from '../lib/schedule.ts';
import { buildTimeline } from '../lib/timeline.ts';
import { subsolarPoint } from '../lib/sun.ts';
import { SimulationClock } from './clock.ts';
import { createSimulationFeed, simFrameAt, skyAt, tripFrameAt, type SimulationContext } from './simulation.ts';
import { computeTrip } from '../lib/trip.ts';
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

describe('fleet simulation frames', () => {
  const later = computeJourney({
    id: 'B',
    stops: airports.map((airport, i) => ({
      airport,
      zone: 'UTC',
      layoverMin: 90,
      arrival: null,
      departure: i === 0 ? { local: '2026-11-20T10:00', offsetMin: null } : null,
    })),
  });
  const laterTimeline = buildTimeline(later)!;
  const fleet = [
    { journey, timeline, legOffset: 0, color: '#ffc24b', tag: 'A' },
    { journey: later, timeline: laterTimeline, legOffset: 2, color: '#5ea8f2', tag: 'B' },
  ];

  it('flies each journey at the shared UTC instant and uses global leg indices', () => {
    const time = timeline.segments[1].end + 10000;
    const frame = simFrameAt(journey, timeline, time, true, fleet, 1);
    expect(frame.fleet).toHaveLength(2);
    expect(frame.fleet?.[0]).toMatchObject({
      view: { kind: 'air', leg: 1 },
      highlightLeg: 1,
      color: '#ffc24b',
      tag: 'A',
    });
    const singleB = simFrameAt(later, laterTimeline, time, false);
    expect(frame.fleet?.[1]).toEqual({
      view: { ...singleB.aircraft, leg: singleB.aircraft!.leg + 2 },
      highlightLeg: singleB.highlightLeg! + 2,
      color: '#5ea8f2',
      tag: 'B',
    });
    expect(frame.aircraft).toBe(frame.fleet?.[1].view);
    expect(frame.highlightLeg).toBe(frame.fleet?.[1].highlightLeg);
    expect(frame.sky?.sun).toEqual(subsolarPoint(time));
  });

  it('parks before each departure, during its transfer, and after each arrival', () => {
    const before = simFrameAt(journey, timeline, timeline.start - 1, false, fleet);
    expect(before.fleet?.map((entry) => entry.view)).toEqual([
      { kind: 'ground', leg: 0, at: 'start' },
      { kind: 'ground', leg: 2, at: 'start' },
    ]);
    const early = simFrameAt(journey, timeline, timeline.start + 1000, false, fleet);
    expect(early.fleet?.[0].view.kind).toBe('air');
    expect(early.fleet?.[1].view).toEqual({ kind: 'ground', leg: 2, at: 'start' });
    const transfer = simFrameAt(journey, timeline, laterTimeline.segments[0].end, false, fleet, 1);
    expect(transfer.fleet?.[1]).toMatchObject({
      view: { kind: 'ground', leg: 2, at: 'end' },
      highlightLeg: 2,
    });
    const firstArrival = simFrameAt(journey, timeline, timeline.end, false, fleet);
    expect(firstArrival.fleet?.[0].view).toEqual({ kind: 'ground', leg: 1, at: 'end' });
    expect(firstArrival.fleet?.[1].view.kind).toBe('air');
    const after = simFrameAt(journey, timeline, laterTimeline.end + 1, false, fleet);
    expect(after.fleet?.map((entry) => entry.view)).toEqual([
      { kind: 'ground', leg: 1, at: 'end' },
      { kind: 'ground', leg: 3, at: 'end' },
    ]);
  });

  it('selects primary by its original fleet index and excludes journeys without timelines', () => {
    const entries = [
      { ...fleet[0], timeline: null },
      fleet[1],
      { ...fleet[0], journey: { ...journey, playable: false }, timeline: null },
    ];
    const frame = simFrameAt(journey, timeline, timeline.start, false, entries, 1);
    expect(frame.fleet).toHaveLength(1);
    expect(frame.aircraft).toBe(frame.fleet?.[0].view);
    expect(frame.highlightLeg).toBe(2);
    for (const primary of [0, 2, 3]) {
      expect(simFrameAt(journey, timeline, timeline.start, false, entries, primary)).toMatchObject({
        aircraft: null,
        highlightLeg: null,
      });
    }
    expect(simFrameAt(journey, timeline, timeline.start, false, fleet).aircraft).toEqual(
      simFrameAt(journey, timeline, timeline.start, false).aircraft,
    );
    expect(simFrameAt(journey, timeline, timeline.start, false)).not.toHaveProperty('fleet');
  });

  it('predicts follow velocity using the primary journey and its local leg index', () => {
    const clock = new SimulationClock({ now: () => timeline.start, requestFrame: () => 1, cancelFrame: () => {} });
    const context: SimulationContext = {
      journey,
      timeline,
      open: true,
      dayNight: false,
      follow: true,
      fleet,
      primary: 1,
    };
    const feed = createSimulationFeed(clock, () => context);
    clock.setRange(timeline.start, laterTimeline.end);
    clock.seek((laterTimeline.start + laterTimeline.segments[0].end) / 2);
    expect(feed.getFrame().aircraft).not.toHaveProperty('fractionPerSecond');
    clock.play();
    const frame = feed.getFrame();
    expect(frame.follow).toBe(true);
    expect(frame.aircraft).toMatchObject({ kind: 'air', leg: 2 });
    if (frame.aircraft?.kind === 'air') expect(frame.aircraft.fractionPerSecond).toBeGreaterThan(0);
    clock.pause();
    expect(feed.getFrame().aircraft).not.toHaveProperty('fractionPerSecond');
    clock.dispose();
  });

  it('caches identical fleet frames, notices style/primary changes and clears aircraft when closed', () => {
    const clock = new SimulationClock({ now: () => timeline.start });
    const context: SimulationContext = { journey, timeline, open: true, dayNight: false, follow: true, fleet };
    const feed = createSimulationFeed(clock, () => context);
    let calls = 0;
    const off = feed.subscribe(() => calls++);
    const first = feed.getFrame();
    feed.refresh();
    expect(feed.getFrame()).toBe(first);
    expect(calls).toBe(0);
    context.fleet = fleet.map((entry) => ({ ...entry }));
    feed.refresh();
    expect(feed.getFrame()).toBe(first);
    context.primary = 1;
    feed.refresh();
    expect(calls).toBe(1);
    expect(feed.getFrame().highlightLeg).toBe(2);
    context.fleet = [fleet[0], { ...fleet[1], color: '#56d3a6', tag: 'C' }];
    feed.refresh();
    expect(calls).toBe(2);
    expect(feed.getFrame().fleet?.[1]).toMatchObject({ color: '#56d3a6', tag: 'C' });
    context.open = false;
    feed.refresh();
    expect(feed.getFrame()).toMatchObject({ fleet: [], aircraft: null, highlightLeg: null, follow: false });
    context.fleet = undefined;
    feed.refresh();
    expect(feed.getFrame()).not.toHaveProperty('fleet');
    off();
    clock.dispose();
  });
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
      sky: skyAt(timeline.start),
      aircraft: null,
      highlightLeg: null,
      follow: false,
    });
    expect(simFrameAt(journey, timeline, timeline.start, false).sky).toBeNull();
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
  it('follows live flights at real-time speed', () => {
    const now = (timeline.start + timeline.segments[0].end) / 2;
    const clock = new SimulationClock({ now: () => now, setTimeout: () => 0 as never, clearTimeout: () => {} });
    const context = { journey, timeline, open: true, dayNight: true, follow: true };
    const feed = createSimulationFeed(clock, () => context);
    clock.goLive();
    const frame = feed.getFrame();
    expect(frame.follow).toBe(true);
    expect(frame.sky?.sun).toEqual(subsolarPoint(now));
    if (frame.aircraft?.kind !== 'air') throw new Error('Expected an airborne aircraft');
    // A long-haul flight crosses well under a thousandth of its distance per real second.
    expect(frame.aircraft.fractionPerSecond).toBeGreaterThan(0);
    expect(frame.aircraft.fractionPerSecond).toBeLessThan(1e-3);
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

it('shares the clock subscription and releases it after the last listener leaves', () => {
  const clock = new SimulationClock({ now: () => timeline.start });
  const context = { journey, timeline, open: true, dayNight: false, follow: false };
  const getContext = vi.fn(() => context);
  const feed = createSimulationFeed(clock, getContext);
  const subscribe = vi.spyOn(clock, 'subscribe');
  const first = vi.fn();
  const second = vi.fn();
  const offFirst = feed.subscribe(first);
  const offSecond = feed.subscribe(second);
  expect(subscribe).toHaveBeenCalledTimes(1);
  feed.getFrame();
  getContext.mockClear();
  clock.seek(timeline.start + 1000);
  expect(getContext).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  offFirst();
  clock.seek(timeline.start + 2000);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  offSecond();
  getContext.mockClear();
  clock.seek(timeline.start + 3000);
  expect(getContext).not.toHaveBeenCalled();
  const offAgain = feed.subscribe(first);
  expect(subscribe).toHaveBeenCalledTimes(2);
  clock.seek(timeline.start + 4000);
  expect(first).toHaveBeenCalledTimes(2);
  offAgain();
  clock.dispose();
});

describe('trip frames', () => {
  const [cph, lhr, jfk] = airports;
  const stop = (airport: Airport, departure: string | null = null) => ({
    airport,
    zone: 'UTC',
    layoverMin: null,
    arrival: null,
    departure: departure ? { local: departure, offsetMin: null } : null,
  });
  // CPH → LHR → JFK, three days in New York, then JFK → CPH.
  const trip = computeTrip(
    [
      { label: null, stayMin: null, input: { id: 'x', stops: [stop(cph, '2026-11-15T07:00'), stop(lhr), stop(jfk)] } },
      { label: null, stayMin: null, input: { id: 'y', stops: [stop(jfk, '2026-11-20T18:00'), stop(cph)] } },
    ],
    { assumedStart: null, now: Date.UTC(2026, 10, 9) },
  );
  const tl = trip.timeline!;
  it('flies one traveller on the trip-wide legs and parks it where it landed during the stay', () => {
    const outbound = tl.sections[0].timeline;
    const flying = tripFrameAt(trip, tl, outbound.start + 30 * 60_000, false);
    expect(flying.aircraft).toMatchObject({ kind: 'air', leg: 0 });
    expect(flying.highlightLeg).toBe(0);
    expect(flying.fleet).toBeUndefined();
    const staying = tripFrameAt(trip, tl, Date.UTC(2026, 10, 18), true);
    expect(staying.aircraft).toEqual({ kind: 'ground', leg: 1, at: 'end' });
    expect(staying.sky).not.toBeNull();
    const home = tripFrameAt(trip, tl, tl.sections[1].timeline.start + 60 * 60_000, false);
    expect(home.aircraft).toMatchObject({ kind: 'air', leg: 2 });
    const waiting = tripFrameAt(trip, tl, tl.sections[1].timeline.start - 10 * 60_000, false);
    expect(waiting.aircraft).toMatchObject({ kind: 'ground', at: 'end' });
    expect(tripFrameAt(trip, null, Date.UTC(2026, 10, 18), false).aircraft).toBeNull();
  });
  it('feeds trip frames, with the playback velocity of the one traveller', () => {
    const clock = new SimulationClock({ now: () => tl.start, requestFrame: () => 1, cancelFrame: () => {} });
    const context: SimulationContext = {
      journey: trip.sections[0].journey,
      timeline: trip.sections[0].timeline,
      open: true,
      dayNight: false,
      follow: true,
      trip: { trip, timeline: tl },
    };
    const feed = createSimulationFeed(clock, () => context);
    clock.setRange(tl.start, tl.end);
    clock.seek(tl.sections[1].timeline.start + 60 * 60_000);
    clock.play();
    const frame = feed.getFrame();
    expect(frame.aircraft).toMatchObject({ kind: 'air', leg: 2 });
    expect(frame.follow).toBe(true);
    if (frame.aircraft?.kind === 'air') expect(frame.aircraft.fractionPerSecond).toBeGreaterThan(0);
    clock.dispose();
  });
});
