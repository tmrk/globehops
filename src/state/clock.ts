export type PlaybackSpeed = 'auto' | 1800 | 3600 | 7200;
/** Live time follows the wall clock: twice a minute for the ambient globe, every second while tracking a journey. */
export const AMBIENT_TICK_MS = 30_000;
export const TRACKING_TICK_MS = 1_000;
export const PLAYBACK_SPEEDS: { value: PlaybackSpeed; label: string; short: string }[] = [
  { value: 'auto', label: 'Auto (whole journey ≈ 15 s)', short: 'Auto' },
  { value: 1800, label: '0.5 hours per second', short: '0.5 h/s' },
  { value: 3600, label: '1 hour per second', short: '1 h/s' },
  { value: 7200, label: '2 hours per second', short: '2 h/s' },
];
export function playbackRate(speed: PlaybackSpeed, spanMs: number): number {
  return Math.max(1, speed === 'auto' ? spanMs / 15000 : Math.min(speed, spanMs / 5000));
}
export interface ClockSnapshot {
  time: number;
  playing: boolean;
  speed: PlaybackSpeed;
  live: boolean;
  start: number | null;
  end: number | null;
}
export interface ClockDependencies {
  now?: () => number;
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (id: number) => void;
  setTimeout?: (cb: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout?: (id: ReturnType<typeof globalThis.setTimeout>) => void;
}
export class SimulationClock {
  private snapshot: ClockSnapshot;
  private listeners = new Set<() => void>();
  private deps: Required<ClockDependencies>;
  private frame: number | null = null;
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private liveTick = AMBIENT_TICK_MS;
  private previousFrame: number | null = null;
  private disposed = false;
  constructor(deps: ClockDependencies = {}) {
    this.deps = {
      now: deps.now ?? Date.now,
      requestFrame: deps.requestFrame ?? ((cb) => globalThis.requestAnimationFrame(cb)),
      cancelFrame: deps.cancelFrame ?? ((id) => globalThis.cancelAnimationFrame(id)),
      setTimeout: deps.setTimeout ?? ((cb, ms) => globalThis.setTimeout(cb, ms)),
      clearTimeout: deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id)),
    };
    this.snapshot = { time: this.deps.now(), playing: false, speed: 'auto', live: false, start: null, end: null };
  }
  getSnapshot = (): ClockSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<ClockSnapshot>): void {
    if (this.disposed || Object.entries(next).every(([k, v]) => this.snapshot[k as keyof ClockSnapshot] === v)) return;
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }
  private stopTimers(): void {
    if (this.frame !== null) this.deps.cancelFrame(this.frame);
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.frame = this.timer = null;
    this.previousFrame = null;
  }
  private clamp(time: number): number {
    return Math.min(this.snapshot.end ?? Infinity, Math.max(this.snapshot.start ?? -Infinity, time));
  }
  setRange(start: number | null, end: number | null): void {
    if (
      (start !== null && !Number.isFinite(start)) ||
      (end !== null && !Number.isFinite(end)) ||
      (start !== null && end !== null && end < start)
    )
      return;
    this.update({ start, end });
    if (!this.snapshot.live) this.update({ time: this.clamp(this.snapshot.time) });
    if (this.snapshot.playing && end !== null && this.snapshot.time >= end) this.pause();
  }
  seek(epochMs: number): void {
    if (!Number.isFinite(epochMs)) return;
    const wasLive = this.snapshot.live;
    if (wasLive) this.stopTimers();
    this.update({ time: this.clamp(epochMs), live: false });
  }
  private tick = (t: number): void => {
    this.frame = null;
    if (!this.snapshot.playing || this.disposed) return;
    const delta = this.previousFrame === null ? 0 : Math.min(100, Math.max(0, t - this.previousFrame));
    this.previousFrame = t;
    const span =
      this.snapshot.start !== null && this.snapshot.end !== null ? this.snapshot.end - this.snapshot.start : 15000;
    const time = this.clamp(this.snapshot.time + delta * playbackRate(this.snapshot.speed, span));
    const ended = this.snapshot.end !== null && time >= this.snapshot.end;
    this.update({ time, playing: !ended });
    if (!ended && !this.disposed && this.snapshot.playing) this.frame = this.deps.requestFrame(this.tick);
    else this.previousFrame = null;
  };
  play(): void {
    if (this.disposed || this.snapshot.playing) return;
    this.stopTimers();
    let time = this.clamp(this.snapshot.time);
    if (this.snapshot.end !== null && time >= this.snapshot.end) time = this.snapshot.start ?? time;
    const playing = this.snapshot.end === null || time < this.snapshot.end;
    this.update({ live: false, playing, time });
    if (playing) this.frame = this.deps.requestFrame(this.tick);
  }
  pause(): void {
    if (this.snapshot.live) return;
    this.stopTimers();
    this.update({ playing: false });
  }
  toggle(): void {
    if (this.snapshot.playing) this.pause();
    else this.play();
  }
  setSpeed(speed: PlaybackSpeed): void {
    this.update({ speed });
  }
  /** How often live time follows the wall clock, while it does. */
  get liveTickMs(): number {
    return this.liveTick;
  }
  goLive(tickMs = AMBIENT_TICK_MS): void {
    if (this.disposed) return;
    this.stopTimers();
    this.liveTick = tickMs;
    this.update({ time: this.deps.now(), playing: false, live: true });
    this.scheduleLiveTick();
  }
  /**
   * Live ticks land on the wall clock's own boundaries (each whole second, each half minute), so a clock
   * showing live time turns over with the device's rather than up to a tick later.
   */
  private scheduleLiveTick(): void {
    const tick = this.liveTick;
    const delay = tick - (((this.deps.now() % tick) + tick) % tick);
    this.timer = this.deps.setTimeout(() => {
      this.timer = null;
      this.update({ time: this.deps.now() });
      if (this.snapshot.live && !this.disposed) this.scheduleLiveTick();
    }, delay);
  }
  dispose(): void {
    this.stopTimers();
    this.disposed = true;
    this.listeners.clear();
  }
}
