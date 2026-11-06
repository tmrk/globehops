import type { Journey } from '../lib/schedule.ts';
import { subsolarPoint } from '../lib/sun.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';
import type { SimFrame, SimulationFeed } from '../globe/simFeed.ts';
import { playbackRate, type SimulationClock } from './clock.ts';

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
    const snapshot = clock.getSnapshot();
    const frame = simFrameAt(ctx.journey, ctx.open ? ctx.timeline : null, snapshot.time, ctx.dayNight);
    frame.follow = ctx.open && ctx.follow && snapshot.playing;
    if (frame.aircraft?.kind === 'air' && ctx.timeline && snapshot.playing) {
      const span = snapshot.start !== null && snapshot.end !== null ? snapshot.end - snapshot.start : 15000;
      const rate = playbackRate(snapshot.speed, span);
      const next = journeyStateAt(ctx.journey, ctx.timeline, snapshot.time + rate * 100);
      // Local distance velocity, in real seconds, predicts through the camera's smoothing lag.
      frame.aircraft.fractionPerSecond =
        next.phase === 'flight' && next.leg === frame.aircraft.leg
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
