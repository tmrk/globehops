import type { Journey } from '../lib/schedule.ts';
import { moonAt } from '../lib/moon.ts';
import { subsolarPoint, sunDistanceKm } from '../lib/sun.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';
import { tripStateAt, type Trip, type TripTimeline } from '../lib/trip.ts';
import type { AircraftView, FleetAircraft, SimFrame, SimulationFeed, Sky } from '../globe/simFeed.ts';
import type { SimulationClock } from './clock.ts';

export const skyAt = (time: number): Sky => ({
  sun: subsolarPoint(time),
  sunDistanceKm: sunDistanceKm(time),
  moon: moonAt(time),
});

export function simFrameAt(
  journey: Journey,
  timeline: Timeline | null,
  time: number,
  dayNight: boolean,
  fleet?: SimulationContext['fleet'],
  primary = 0,
): SimFrame {
  const frame: SimFrame = {
    sky: dayNight ? skyAt(time) : null,
    aircraft: null,
    highlightLeg: null,
    follow: false,
  };
  if (fleet !== undefined) {
    frame.fleet = [];
    for (let i = 0; i < fleet.length; i++) {
      const entry = fleet[i];
      let view: AircraftView;
      let highlightLeg: number;
      if (entry.trip) {
        // A compared trip's traveller, on its own trip's legs after the alternatives before it.
        const traveller = tripFrameAt(entry.trip.trip, entry.trip.timeline, time, false);
        if (!traveller.aircraft || traveller.highlightLeg === null) continue;
        view = { ...traveller.aircraft, leg: entry.legOffset + traveller.aircraft.leg };
        highlightLeg = entry.legOffset + traveller.highlightLeg;
      } else {
        if (!entry.timeline) continue;
        const state = journeyStateAt(entry.journey, entry.timeline, time);
        highlightLeg = entry.legOffset + (state.phase === 'transfer' ? state.leg - 1 : state.leg);
        view =
          state.phase === 'flight'
            ? { kind: 'air', leg: entry.legOffset + state.leg, fraction: state.distanceFraction }
            : { kind: 'ground', leg: highlightLeg, at: state.phase === 'before' ? 'start' : 'end' };
      }
      const aircraft: FleetAircraft = { view, color: entry.color, tag: entry.tag, highlightLeg };
      frame.fleet.push(aircraft);
      if (i === primary) {
        frame.aircraft = aircraft.view;
        frame.highlightLeg = highlightLeg;
      }
    }
    return frame;
  }
  if (!timeline || !journey.playable) return frame;
  const state = journeyStateAt(journey, timeline, time);
  frame.highlightLeg = state.phase === 'transfer' ? state.leg - 1 : state.leg;
  frame.aircraft =
    state.phase === 'flight'
      ? { kind: 'air', leg: state.leg, fraction: state.distanceFraction }
      : { kind: 'ground', leg: frame.highlightLeg, at: state.phase === 'before' ? 'start' : 'end' };
  return frame;
}
/**
 * A trip's single traveller on the flattened globe legs of all its journeys: flying, connecting or waiting
 * like a journey's aircraft, and parked where it landed during a stay.
 */
export function tripFrameAt(trip: Trip, timeline: TripTimeline | null, time: number, dayNight: boolean): SimFrame {
  const frame: SimFrame = { sky: dayNight ? skyAt(time) : null, aircraft: null, highlightLeg: null, follow: false };
  if (!timeline) return frame;
  const state = tripStateAt(trip, timeline, time);
  if (state.phase === 'stay') {
    const before = trip.sections[state.after];
    const leg = before.legOffset + before.journey.legs.length - 1;
    frame.highlightLeg = leg;
    frame.aircraft = { kind: 'ground', leg, at: 'end' };
    return frame;
  }
  const local = state.state;
  const leg = state.legOffset + (local.phase === 'transfer' ? local.leg - 1 : local.leg);
  frame.highlightLeg = leg;
  frame.aircraft =
    local.phase === 'flight'
      ? { kind: 'air', leg: state.legOffset + local.leg, fraction: local.distanceFraction }
      : { kind: 'ground', leg, at: local.phase === 'before' ? 'start' : 'end' };
  return frame;
}

/** The primary aircraft's flown fraction at an instant, on its global leg; null when not airborne. */
function airborneAt(ctx: SimulationContext, time: number): { leg: number; fraction: number } | null {
  if (ctx.trip) {
    if (!ctx.trip.timeline) return null;
    const state = tripStateAt(ctx.trip.trip, ctx.trip.timeline, time);
    return state.phase === 'journey' && state.state.phase === 'flight'
      ? { leg: state.legOffset + state.state.leg, fraction: state.state.distanceFraction }
      : null;
  }
  const primary = ctx.fleet?.[ctx.primary ?? 0];
  if (primary?.trip) {
    if (!primary.trip.timeline) return null;
    const state = tripStateAt(primary.trip.trip, primary.trip.timeline, time);
    return state.phase === 'journey' && state.state.phase === 'flight'
      ? { leg: primary.legOffset + state.legOffset + state.state.leg, fraction: state.state.distanceFraction }
      : null;
  }
  const journey = ctx.fleet === undefined ? ctx.journey : primary?.journey;
  const timeline = ctx.fleet === undefined ? ctx.timeline : primary?.timeline;
  if (!journey || !timeline) return null;
  const state = journeyStateAt(journey, timeline, time);
  return state.phase === 'flight'
    ? { leg: state.leg + (primary?.legOffset ?? 0), fraction: state.distanceFraction }
    : null;
}

export interface SimulationContext {
  journey: Journey;
  timeline: Timeline | null;
  open: boolean;
  dayNight: boolean;
  follow: boolean;
  /**
   * Compared journeys (or compared trips, each entry with its `trip`) in flattened globe-leg order;
   * absent in single mode.
   */
  fleet?: {
    journey: Journey;
    timeline: Timeline | null;
    /** A compared trip's traveller, flying every journey of it; `legOffset` is its first flight. */
    trip?: { trip: Trip; timeline: TripTimeline | null };
    legOffset: number;
    color: string;
    tag: string;
  }[];
  /** Index into fleet, before entries without timelines are filtered out. */
  primary?: number;
  /** A trip's journeys with one traveller (instead of `journey`/`fleet`); its timeline spans every journey. */
  trip?: { trip: Trip; timeline: TripTimeline | null };
}
const EMPTY_FLEET: NonNullable<SimulationContext['fleet']> = [];
function sameAircraft(a: AircraftView | null, b: AircraftView | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.leg !== b.leg) return false;
  if (a.kind === 'ground') return b.kind === 'ground' && a.at === b.at;
  return b.kind === 'air' && a.fraction === b.fraction && a.fractionPerSecond === b.fractionPerSecond;
}

function sameFrame(a: SimFrame, b: SimFrame): boolean {
  if (
    a.follow !== b.follow ||
    a.highlightLeg !== b.highlightLeg ||
    !sameAircraft(a.aircraft, b.aircraft) ||
    // Both bodies move with time alone, so an unmoved Sun means an unchanged sky.
    (a.sky !== b.sky && (!a.sky || !b.sky || a.sky.sun.lat !== b.sky.sun.lat || a.sky.sun.lng !== b.sky.sun.lng))
  )
    return false;
  if (a.fleet === b.fleet) return true;
  if (!a.fleet || !b.fleet || a.fleet.length !== b.fleet.length) return false;
  for (let i = 0; i < a.fleet.length; i++) {
    const first = a.fleet[i];
    const second = b.fleet[i];
    if (
      first.color !== second.color ||
      first.tag !== second.tag ||
      first.highlightLeg !== second.highlightLeg ||
      !sameAircraft(first.view, second.view)
    )
      return false;
  }
  return true;
}

export function createSimulationFeed(
  clock: SimulationClock,
  getContext: () => SimulationContext,
): SimulationFeed & { refresh(): void } {
  let cached: SimFrame | null = null;
  let unsubscribeClock: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const getFrame = () => {
    const ctx = getContext();
    const snapshot = clock.getSnapshot();
    const frame = ctx.trip
      ? tripFrameAt(ctx.trip.trip, ctx.open ? ctx.trip.timeline : null, snapshot.time, ctx.dayNight)
      : simFrameAt(
          ctx.journey,
          ctx.open ? ctx.timeline : null,
          snapshot.time,
          ctx.dayNight,
          ctx.fleet === undefined ? undefined : ctx.open ? ctx.fleet : EMPTY_FLEET,
          ctx.primary,
        );
    const moving = snapshot.playing || snapshot.live;
    frame.follow = ctx.open && ctx.follow && moving;
    if (frame.aircraft?.kind === 'air' && moving) {
      const next = airborneAt(ctx, snapshot.time + clock.rate * 100);
      // Local distance velocity, in real seconds, predicts through the camera's smoothing lag.
      frame.aircraft.fractionPerSecond =
        next && next.leg === frame.aircraft.leg ? Math.max(0, (next.fraction - frame.aircraft.fraction) / 0.1) : 0;
    }
    if (!cached || !sameFrame(frame, cached)) cached = frame;
    return cached;
  };
  const refresh = () => {
    const previous = cached;
    if (getFrame() !== previous) listeners.forEach((listener) => listener());
  };
  return {
    getFrame,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      unsubscribeClock ??= clock.subscribe(refresh);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeClock?.();
          unsubscribeClock = null;
        }
      };
    },
  };
}
