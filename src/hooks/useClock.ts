import { useCallback, useSyncExternalStore } from 'react';
import type { SimulationClock } from '../state/clock.ts';
import type { Journey } from '../lib/schedule.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';

/** Only the time bar consumes animation frames. The planner observes phase boundaries. */
export function useClock(clock: SimulationClock) {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
export function useClockPhase(clock: SimulationClock, journey: Journey, timeline: Timeline | null, open: boolean) {
  const snapshot = useCallback(() => {
    const { time, playing, live } = clock.getSnapshot();
    const state = open && timeline ? journeyStateAt(journey, timeline, time) : null;
    return `${playing ? 'playing' : live ? 'live' : 'paused'}:${state?.phase ?? ''}:${state?.leg ?? ''}:${state && 'stop' in state ? state.stop : ''}`;
  }, [clock, journey, timeline, open]);
  return useSyncExternalStore(clock.subscribe, snapshot);
}
