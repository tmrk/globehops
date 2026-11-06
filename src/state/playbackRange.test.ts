import { describe, expect, it, vi } from 'vitest';
import { SimulationClock } from './clock.ts';
import { playInRange } from './playbackRange.ts';

function clockAt(time: number) {
  return new SimulationClock({ now: () => time, requestFrame: vi.fn(() => 1), cancelFrame: vi.fn() });
}

describe('starting journey playback', () => {
  const range = { start: 10_000_000, end: 20_000_000 };
  it.each([range.end, range.end + 1000])('replays from departure when the clock is at %i', (time) => {
    const clock = clockAt(time);
    playInRange(clock, range, null);
    expect(clock.getSnapshot()).toMatchObject({
      time: range.start,
      playing: true,
      start: range.start - 1_800_000,
      end: range.end,
    });
    clock.dispose();
  });
  it('retains a linked time before the usual lead and resumes from it', () => {
    const clock = clockAt(1_000_000);
    playInRange(clock, range, 1_000_000);
    expect(clock.getSnapshot()).toMatchObject({ time: 1_000_000, start: 1_000_000, end: range.end, playing: true });
    clock.dispose();
  });
  it('clamps an earlier unlinked time to the thirty-minute lead', () => {
    const clock = clockAt(0);
    playInRange(clock, range, null);
    expect(clock.getSnapshot()).toMatchObject({ time: 8_200_000, start: 8_200_000, playing: true });
    clock.dispose();
  });
});
