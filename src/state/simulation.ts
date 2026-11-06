import type { Journey } from '../lib/schedule.ts';
import { subsolarPoint } from '../lib/sun.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';
import type { FleetAircraft, SimFrame, SimulationFeed } from '../globe/simFeed.ts';
import { playbackRate, type SimulationClock } from './clock.ts';

export function simFrameAt(
  journey: Journey,
  timeline: Timeline | null,
  time: number,
  dayNight: boolean,
  fleet?: SimulationContext['fleet'],
  primary = 0,
): SimFrame {
  const frame: SimFrame = {
    subsolar: dayNight ? subsolarPoint(time) : null,
    aircraft: null,
    highlightLeg: null,
    follow: false,
  };
  if (fleet !== undefined) {
    frame.fleet = [];
    for (let i = 0; i < fleet.length; i++) {
      const entry = fleet[i];
      if (!entry.timeline) continue;
      const state = journeyStateAt(entry.journey, entry.timeline, time);
      const highlightLeg = entry.legOffset + (state.phase === 'transfer' ? state.leg - 1 : state.leg);
      const aircraft: FleetAircraft = {
        view:
          state.phase === 'flight'
            ? { kind: 'air', leg: entry.legOffset + state.leg, fraction: state.distanceFraction }
            : {
                kind: 'ground',
                leg: highlightLeg,
                at: state.phase === 'before' ? 'start' : 'end',
              },
        color: entry.color,
        tag: entry.tag,
        highlightLeg,
      };
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
export interface SimulationContext {
  journey: Journey;
  timeline: Timeline | null;
  open: boolean;
  dayNight: boolean;
  follow: boolean;
  /** Compare journeys in flattened globe-leg order; absent in single mode. */
  fleet?: { journey: Journey; timeline: Timeline | null; legOffset: number; color: string; tag: string }[];
  /** Index into fleet, before entries without timelines are filtered out. */
  primary?: number;
}
const EMPTY_FLEET: NonNullable<SimulationContext['fleet']> = [];
export function createSimulationFeed(
  clock: SimulationClock,
  getContext: () => SimulationContext,
): SimulationFeed & { refresh(): void } {
  let cached: SimFrame | null = null;
  let signature = '';
  const listeners = new Set<() => void>();
  const getFrame = () => {
    const ctx = getContext();
    const snapshot = clock.getSnapshot();
    const frame = simFrameAt(
      ctx.journey,
      ctx.open ? ctx.timeline : null,
      snapshot.time,
      ctx.dayNight,
      ctx.fleet === undefined ? undefined : ctx.open ? ctx.fleet : EMPTY_FLEET,
      ctx.primary,
    );
    frame.follow = ctx.open && ctx.follow && snapshot.playing;
    const primary = ctx.fleet?.[ctx.primary ?? 0];
    const primaryJourney = ctx.fleet === undefined ? ctx.journey : primary?.journey;
    const primaryTimeline = ctx.fleet === undefined ? ctx.timeline : primary?.timeline;
    if (frame.aircraft?.kind === 'air' && primaryJourney && primaryTimeline && snapshot.playing) {
      const span = snapshot.start !== null && snapshot.end !== null ? snapshot.end - snapshot.start : 15000;
      const rate = playbackRate(snapshot.speed, span);
      const next = journeyStateAt(primaryJourney, primaryTimeline, snapshot.time + rate * 100);
      // Local distance velocity, in real seconds, predicts through the camera's smoothing lag.
      frame.aircraft.fractionPerSecond =
        next.phase === 'flight' && next.leg + (primary?.legOffset ?? 0) === frame.aircraft.leg
          ? Math.max(0, (next.distanceFraction - frame.aircraft.fraction) / 0.1)
          : 0;
    }
    const next = JSON.stringify(frame);
    if (next !== signature || !cached) {
      signature = next;
      cached = frame;
    }
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
      const unsubscribe = clock.subscribe(refresh);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
  };
}
