import { useCallback, useSyncExternalStore } from 'react';
import type { SimulationClock } from '../state/clock.ts';
import type { Journey } from '../lib/schedule.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';
import { tripStateAt, type Trip } from '../lib/trip.ts';

/** Only the time bar consumes animation frames. The planner observes phase boundaries. */
export function useClock(clock: SimulationClock) {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
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
