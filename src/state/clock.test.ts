import { describe, it, expect, vi } from 'vitest';
import { AMBIENT_TICK_MS, playbackRate, SimulationClock, TRACKING_TICK_MS } from './clock.ts';
function fakeClock() {
  let now = 1000,
    id = 0;
  const frames = new Map<number, (t: number) => void>();
  const intervals = new Map<ReturnType<typeof setTimeout>, () => void>();
  const cadences: number[] = [];
  const clock = new SimulationClock({
    now: () => now,
    requestFrame: (cb) => {
      frames.set(++id, cb);
      return id;
    },
    cancelFrame: (key) => {
      frames.delete(key);
    },
    setTimeout: (cb, ms) => {
      cadences.push(ms);
      const key = ++id as unknown as ReturnType<typeof setTimeout>;
      intervals.set(key, () => {
        intervals.delete(key);
        cb();
      });
      return key;
    },
    clearTimeout: (key) => {
      intervals.delete(key);
    },
  });
  return {
    clock,
    frames,
    intervals,
    cadences,
    setNow: (value: number) => {
      now = value;
    },
    frame: (t: number) => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((cb) => cb(t));
    },
    liveTick: () => [...intervals.values()].forEach((cb) => cb()),
  };
}
describe('playback rate', () => {
  it('fits auto to about 15 seconds including multi-day layovers', () => {
    const span = 3 * 86400000;
    expect(span / playbackRate('auto', span)).toBe(15000);
  });
  it.each([1800, 3600, 7200] as const)('caps fixed speed %i so playback lasts at least five seconds', (speed) => {
    for (const span of [60000, 3600000, 86400000]) {
      const rate = playbackRate(speed, span);
      expect(rate).toBeLessThanOrEqual(speed);
      expect(span / rate).toBeGreaterThanOrEqual(5000);
    }
    expect(playbackRate(speed, 100)).toBe(1);
  });
  it('always has a rate of at least one for empty spans', () => {
    expect(playbackRate('auto', 0)).toBe(1);
    expect(playbackRate(1800, -1)).toBe(1);
  });
});
describe('simulation clock', () => {
  it('retains snapshot identity until an observable change and supports unsubscribe', () => {
    const { clock } = fakeClock();
    const listener = vi.fn();
    const unsub = clock.subscribe(listener);
    const a = clock.getSnapshot();
    expect(clock.getSnapshot()).toBe(a);
    clock.setSpeed('auto');
    clock.seek(1000);
    clock.pause();
    expect(clock.getSnapshot()).toBe(a);
    expect(listener).not.toHaveBeenCalled();
    clock.setSpeed(1800);
    expect(clock.getSnapshot()).not.toBe(a);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    clock.seek(2000);
    expect(listener).toHaveBeenCalledTimes(1);
    clock.dispose();
  });
  it('clamps seeks and range changes, and rejects invalid input', () => {
    const { clock } = fakeClock();
    clock.setRange(100, 200);
    expect(clock.getSnapshot().time).toBe(200);
    clock.seek(0);
    expect(clock.getSnapshot().time).toBe(100);
    clock.seek(999);
    expect(clock.getSnapshot().time).toBe(200);
    const snapshot = clock.getSnapshot();
    clock.seek(NaN);
    clock.setRange(200, 100);
    clock.setRange(Infinity, null);
    expect(clock.getSnapshot()).toBe(snapshot);
    clock.setRange(null, null);
    clock.seek(-500);
    expect(clock.getSnapshot().time).toBe(-500);
  });
  it('plays exactly to the end, pauses, then restarts on play', () => {
    const { clock, frame, frames } = fakeClock();
    clock.setRange(0, 10000);
    clock.seek(0);
    clock.play();
    clock.play();
    expect(frames.size).toBe(1);
    frame(0);
    for (let t = 100; t <= 10000; t += 100) frame(t);
    expect(clock.getSnapshot()).toMatchObject({ time: 10000, playing: false });
    expect(frames.size).toBe(0);
    clock.play();
    expect(clock.getSnapshot()).toMatchObject({ time: 0, playing: true });
    expect(frames.size).toBe(1);
    clock.pause();
    expect(frames.size).toBe(0);
    clock.toggle();
    expect(clock.getSnapshot().playing).toBe(true);
    clock.toggle();
    expect(clock.getSnapshot().playing).toBe(false);
  });
  it('caps frame dt at 100ms and uses the selected speed immediately', () => {
    const { clock, frame } = fakeClock();
    clock.setRange(0, 100000000);
    clock.seek(0);
    clock.setSpeed(1800);
    clock.play();
    frame(0);
    frame(10000);
    expect(clock.getSnapshot().time).toBe(100 * 1800);
    clock.setSpeed(3600);
    frame(10050);
    expect(clock.getSnapshot().time).toBe(100 * 1800 + 50 * 3600);
    frame(10040); // Nonmonotonic frame timestamps cannot move simulation backwards.
    expect(clock.getSnapshot().time).toBe(100 * 1800 + 50 * 3600);
    clock.pause();
    clock.play();
    frame(999999);
    expect(clock.getSnapshot().time).toBe(100 * 1800 + 50 * 3600);
    clock.dispose();
  });
  it('ticks live time every 30s without rAF and leaves live on seek/play', () => {
    const { clock, frames, intervals, frame, liveTick, setNow } = fakeClock();
    clock.setRange(0, 500);
    clock.goLive();
    expect(clock.getSnapshot()).toMatchObject({ time: 1000, live: true, playing: false });
    expect(frames.size).toBe(0);
    expect(intervals.size).toBe(1);
    setNow(31000);
    liveTick();
    expect(clock.getSnapshot().time).toBe(31000);
    clock.goLive();
    expect(intervals.size).toBe(1);
    clock.seek(100);
    expect(clock.getSnapshot()).toMatchObject({ time: 100, live: false });
    expect(intervals.size).toBe(0);
    clock.goLive();
    clock.play();
    expect(clock.getSnapshot()).toMatchObject({ time: 0, live: false, playing: true });
    expect(intervals.size).toBe(0);
    expect(frames.size).toBe(1);
    frame(0);
    clock.goLive();
    expect(frames.size).toBe(0);
    clock.dispose();
    expect(intervals.size).toBe(0);
  });
  it('follows the wall clock twice a minute for the globe and every second while tracking', () => {
    const { clock, intervals, cadences, liveTick, setNow } = fakeClock();
    setNow(0);
    clock.goLive();
    clock.goLive(TRACKING_TICK_MS);
    expect(clock.liveTickMs).toBe(TRACKING_TICK_MS);
    expect(cadences).toEqual([AMBIENT_TICK_MS, TRACKING_TICK_MS]);
    expect(intervals.size).toBe(1);
    setNow(2000);
    liveTick();
    expect(clock.getSnapshot()).toMatchObject({ time: 2000, live: true });
    // Leaving live keeps the moment that was showing.
    clock.seek(clock.getSnapshot().time);
    expect(clock.getSnapshot()).toMatchObject({ time: 2000, live: false });
    expect(intervals.size).toBe(0);
  });
  it('turns live time over on the wall clock’s own second and half-minute boundaries', () => {
    const { clock, intervals, cadences, liveTick, setNow } = fakeClock();
    setNow(12_345);
    clock.goLive(TRACKING_TICK_MS);
    expect(cadences).toEqual([655]);
    setNow(13_000);
    liveTick();
    expect(clock.getSnapshot().time).toBe(13_000);
    // A late timer still aims for the next boundary rather than drifting a whole tick behind it.
    expect(cadences.at(-1)).toBe(1000);
    setNow(14_040);
    liveTick();
    expect(cadences.at(-1)).toBe(960);
    setNow(44_000);
    clock.goLive();
    expect(cadences.at(-1)).toBe(16_000);
    expect(intervals.size).toBe(1);
    clock.seek(0);
    expect(intervals.size).toBe(0);
  });
  it('disposes every timer and prevents later activity', () => {
    const { clock, frames, intervals, frame } = fakeClock();
    const listener = vi.fn();
    clock.subscribe(listener);
    clock.play();
    clock.dispose();
    expect(frames.size).toBe(0);
    expect(intervals.size).toBe(0);
    const snapshot = clock.getSnapshot(),
      calls = listener.mock.calls.length;
    frame(100);
    clock.play();
    clock.goLive();
    clock.seek(0);
    clock.setSpeed(7200);
    expect(clock.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(calls);
  });
  it('does not schedule a loop for an empty range', () => {
    const { clock, frames } = fakeClock();
    clock.setRange(42, 42);
    clock.play();
    expect(clock.getSnapshot()).toMatchObject({ time: 42, playing: false });
    expect(frames.size).toBe(0);
  });
});
