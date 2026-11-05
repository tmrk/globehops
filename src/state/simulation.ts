import type { Journey } from '../lib/schedule.ts';
import { subsolarPoint } from '../lib/sun.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';
import type { SimFrame, SimulationFeed } from '../globe/simFeed.ts';
import type { SimulationClock } from './clock.ts';

export function simFrameAt(journey: Journey, timeline: Timeline | null, time: number, dayNight: boolean): SimFrame {
  const frame: SimFrame = {
    subsolar: dayNight ? subsolarPoint(time) : null,
    aircraft: null,
    highlightLeg: null,
    follow: false,
  };
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
}
export function createSimulationFeed(
  clock: SimulationClock,
  getContext: () => SimulationContext,
): SimulationFeed & { refresh(): void } {
  let cached: SimFrame | null = null;
  let signature = '';
  const listeners = new Set<() => void>();
  const getFrame = () => {
    const ctx = getContext();
    const frame = simFrameAt(ctx.journey, ctx.open ? ctx.timeline : null, clock.getSnapshot().time, ctx.dayNight);
    frame.follow = ctx.open && ctx.follow && clock.getSnapshot().playing;
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
