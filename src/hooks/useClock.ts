import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ClockSnapshot, SimulationClock } from '../state/clock.ts';
import type { Journey } from '../lib/schedule.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';
import { tripStateAt, type Trip } from '../lib/trip.ts';

/** Every change, including each playing frame; the planner observes phase boundaries, the time bar its text. */
export function useClock(clock: SimulationClock) {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
const MINUTE = 60_000;
/** While playing, text moves on about this often in real time, however fast the clock runs. */
const TEXT_REFRESH_MS = 100;

/** Whether two snapshots differ in anything but time (and a skip's progress, which only moves a thumb). */
function sameState(a: ClockSnapshot, b: ClockSnapshot): boolean {
  return (
    a.playing === b.playing &&
    a.live === b.live &&
    a.speed === b.speed &&
    a.start === b.start &&
    a.end === b.end &&
    a.skipping?.from === b.skipping?.from &&
    a.skipping?.to === b.skipping?.to
  );
}

/**
 * A `getSnapshot` for text: it changes with anything other than time, and when time has moved on by a step
 * that reads as a change: a minute, or while playing whatever passes in a tenth of a second of playback.
 */
function textSnapshots(clock: SimulationClock): () => ClockSnapshot {
  let view: ClockSnapshot | null = null;
  let step = MINUTE;
  return () => {
    const next = clock.getSnapshot();
    if (view && sameState(view, next)) {
      if (Math.floor(view.time / step) === Math.floor(next.time / step)) return view;
    } else step = next.playing ? Math.max(MINUTE, clock.rate * TEXT_REFRESH_MS) : MINUTE;
    view = next;
    return view;
  };
}

/**
 * The clock for views that show time as text: a new snapshot only when the text could read differently, not
 * on every playing frame (a fast clock passes a simulated minute almost every frame). Positions that must move
 * every frame, such as a thumb or a progress line, follow `clock.subscribe` imperatively instead.
 */
export function useClockText(clock: SimulationClock): ClockSnapshot {
  const getSnapshot = useMemo(() => textSnapshots(clock), [clock]);
  return useSyncExternalStore(clock.subscribe, getSnapshot);
}

export function useClockPhase(
  clock: SimulationClock,
  journey: Journey,
  timeline: Timeline | null,
  open: boolean,
  trip: Trip | null = null,
) {
  const snapshot = useCallback(() => {
    const { time, playing, live } = clock.getSnapshot();
    const mode = playing ? 'playing' : live ? 'live' : 'paused';
    if (trip) {
      const state = open && trip.timeline ? tripStateAt(trip, trip.timeline, time) : null;
      if (!state) return `${mode}:`;
      if (state.phase === 'stay') return `${mode}:stay:${state.section}`;
      const local = state.state;
      return `${mode}:${local.phase}:${state.section}:${local.leg}:${'stop' in local ? local.stop : ''}`;
    }
    const state = open && timeline ? journeyStateAt(journey, timeline, time) : null;
    return `${mode}:${state?.phase ?? ''}:${state?.leg ?? ''}:${state && 'stop' in state ? state.stop : ''}`;
  }, [clock, journey, timeline, open, trip]);
  return useSyncExternalStore(clock.subscribe, snapshot);
}
