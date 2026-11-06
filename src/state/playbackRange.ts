import type { SimulationClock } from './clock.ts';

export const PLAYBACK_LEAD_MS = 30 * 60_000;

/** Replay from departure after reaching the end, retaining any earlier linked view time. */
export function playInRange(clock: SimulationClock, range: { start: number; end: number }, linkedTime: number | null) {
  if (clock.getSnapshot().time >= range.end) clock.seek(range.start);
  clock.setRange(Math.min(range.start - PLAYBACK_LEAD_MS, linkedTime ?? Infinity), range.end);
  clock.play();
}
