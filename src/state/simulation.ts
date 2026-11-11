import type { Journey } from '../lib/schedule.ts';
import { moonAt } from '../lib/moon.ts';
import { subsolarPoint, sunDistanceKm } from '../lib/sun.ts';
import { journeyStateAt, type JourneyState, type Timeline } from '../lib/timeline.ts';
import { tripStateAt, type Trip, type TripTimeline } from '../lib/trip.ts';
import {
  sameAircraft,
  type AircraftView,
  type FleetAircraft,
  type SimFrame,
  type SimulationFeed,
  type Sky,
} from '../globe/simFeed.ts';
import type { ClockSnapshot, SimulationClock } from './clock.ts';

export const skyAt = (time: number): Sky => ({
  sun: subsolarPoint(time),
  sunDistanceKm: sunDistanceKm(time),
  moon: moonAt(time),
});

/**
 * A journey's aircraft at one of its states, on global leg indices from `offset`: flying its leg, or parked
 * at the start, the connection or the end, with the leg it last flew (or is about to fly) highlighted.
 */
function aircraftAt(state: JourneyState, offset: number): { view: AircraftView; highlightLeg: number } {
  const highlightLeg = offset + (state.phase === 'transfer' ? state.leg - 1 : state.leg);
  return {
    highlightLeg,
    view:
      state.phase === 'flight'
        ? { kind: 'air', leg: offset + state.leg, fraction: state.distanceFraction }
        : { kind: 'ground', leg: highlightLeg, at: state.phase === 'before' ? 'start' : 'end' },
  };
}

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
      let placed: { view: AircraftView; highlightLeg: number };
      if (entry.trip) {
        // A compared trip's traveller, on its own trip's legs after the alternatives before it.
        const traveller = tripFrameAt(entry.trip.trip, entry.trip.timeline, time, false);
        if (!traveller.aircraft || traveller.highlightLeg === null) continue;
        placed = {
          view: { ...traveller.aircraft, leg: entry.legOffset + traveller.aircraft.leg },
          highlightLeg: entry.legOffset + traveller.highlightLeg,
        };
      } else {
        if (!entry.timeline) continue;
        placed = aircraftAt(journeyStateAt(entry.journey, entry.timeline, time), entry.legOffset);
      }
      const aircraft: FleetAircraft = { ...placed, color: entry.color, tag: entry.tag };
      frame.fleet.push(aircraft);
      if (i === primary) {
        frame.aircraft = aircraft.view;
        frame.highlightLeg = aircraft.highlightLeg;
      }
    }
    return frame;
  }
  if (!timeline || !journey.playable) return frame;
  const { view, highlightLeg } = aircraftAt(journeyStateAt(journey, timeline, time), 0);
  frame.aircraft = view;
  frame.highlightLeg = highlightLeg;
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
  const { view, highlightLeg } = aircraftAt(state.state, state.legOffset);
  frame.aircraft = view;
  frame.highlightLeg = highlightLeg;
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
  /** The clock snapshot and context `cached` was worked out for: listeners ask again right after a refresh. */
  let cachedFor: { snapshot: ClockSnapshot; ctx: SimulationContext } | null = null;
  let unsubscribeClock: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const getFrame = () => {
    const ctx = getContext();
    const snapshot = clock.getSnapshot();
    if (cached && cachedFor?.snapshot === snapshot && cachedFor.ctx === ctx) return cached;
    cachedFor = { snapshot, ctx };
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
  /** Works the frame out afresh (the clock moved or the context changed) and tells listeners if it differs. */
  const refresh = () => {
    cachedFor = null;
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
