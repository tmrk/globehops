/**
 * Momentum for dragging the globe: after the finger or mouse lets go, the globe glides on at the
 * speed it was released with and slows to a stop under friction, as in map apps.
 *
 * Positions are the camera's orbit angles (radians). Speeds are checked in screen pixels per second,
 * via the drag's pixels-per-radian at the moment of release, so the glide feels the same at every zoom.
 */

/** Samples older than this, measured from the release, are dropped. */
export const INERTIA_BUFFER_MS = 160;
/** The release speed is measured over this much time before the release. */
export const INERTIA_WINDOW_MS = 80;
/** The glide's speed halves every this many milliseconds. */
export const INERTIA_HALF_LIFE_MS = 120;
/** Releases slower than this do not glide. */
export const INERTIA_MIN_SPEED_PX = 80;
/** Faster releases glide as if released at this speed. */
export const INERTIA_MAX_SPEED_PX = 2000;
/** The glide ends once it has slowed to this speed. */
export const INERTIA_STOP_SPEED_PX = 10;

const TAU_MS = INERTIA_HALF_LIFE_MS / Math.LN2;

export interface InertiaSample {
  time: number;
  theta: number;
  phi: number;
}

export interface Glide {
  /** Starting speed, radians per millisecond. */
  vTheta: number;
  vPhi: number;
  /** Milliseconds until the glide has slowed to the stop speed. */
  duration: number;
}

/** Undoes the jump of an angle wrapping round at plus or minus pi, so differences stay small. */
function unwrap(previous: number, next: number): number {
  let d = next - previous;
  d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
  return previous + d;
}

/**
 * The glide that continues a drag released at `releaseTime`, or null if it was too slow.
 *
 * The speed runs up to the release rather than to the last movement, so a finger held still
 * before lifting glides little or not at all.
 */
export function glideFromSamples(
  samples: readonly InertiaSample[],
  releaseTime: number,
  pxPerRadian: number,
): Glide | null {
  const recent = samples.filter((s) => releaseTime - s.time <= INERTIA_BUFFER_MS);
  if (recent.length < 2) return null;
  let first = recent.length - 2;
  while (first > 0 && releaseTime - recent[first - 1].time <= INERTIA_WINDOW_MS) first--;
  const from = recent[first];
  const to = recent[recent.length - 1];
  const elapsed = releaseTime - from.time;
  if (!(elapsed > 0) || !(pxPerRadian > 0)) return null;
  let vTheta = (to.theta - from.theta) / elapsed;
  let vPhi = (to.phi - from.phi) / elapsed;
  const speedPx = Math.hypot(vTheta, vPhi) * pxPerRadian * 1000;
  if (!(speedPx >= INERTIA_MIN_SPEED_PX)) return null;
  const capped = Math.min(speedPx, INERTIA_MAX_SPEED_PX);
  vTheta *= capped / speedPx;
  vPhi *= capped / speedPx;
  return { vTheta, vPhi, duration: INERTIA_HALF_LIFE_MS * Math.log2(capped / INERTIA_STOP_SPEED_PX) };
}

/** Share of the starting speed (times milliseconds) travelled from `t0` to `t1` into the glide. */
function travelled(t0: number, t1: number): number {
  return TAU_MS * (Math.exp(-t0 / TAU_MS) - Math.exp(-t1 / TAU_MS));
}

/** Records a drag and plays out the glide after it, a frame at a time. */
export class DragInertia {
  private samples: InertiaSample[] = [];
  private tracking = false;
  private glide: Glide | null = null;
  private glideTime = 0;
  /** Reused for each step, so the glide leaves no garbage per frame. */
  private readonly turn = { dTheta: 0, dPhi: 0 };

  /** A glide is playing. */
  get active(): boolean {
    return this.glide !== null;
  }

  /** A drag is being recorded. */
  get dragging(): boolean {
    return this.tracking;
  }

  /** A new drag starts: any glide stops at once. */
  begin() {
    this.cancel();
    this.tracking = true;
  }

  record(time: number, theta: number, phi: number) {
    if (!this.tracking) return;
    const last = this.samples[this.samples.length - 1];
    if (last && time <= last.time) return;
    this.samples.push({ time, theta: last ? unwrap(last.theta, theta) : theta, phi });
    while (this.samples.length > 2 && time - this.samples[0].time > INERTIA_BUFFER_MS) this.samples.shift();
  }

  /** The drag ends; returns whether a glide starts. */
  release(time: number, pxPerRadian: number): boolean {
    const glide = this.tracking ? glideFromSamples(this.samples, time, pxPerRadian) : null;
    this.cancel();
    this.glide = glide;
    return glide !== null;
  }

  /** Stops any glide and forgets the drag. */
  cancel() {
    this.samples = [];
    this.tracking = false;
    this.glide = null;
    this.glideTime = 0;
  }

  /** Advances the glide by `elapsed` milliseconds and returns how far it turns (an object reused on each call), or null when there is no glide. */
  step(elapsed: number): { dTheta: number; dPhi: number } | null {
    const glide = this.glide;
    if (!glide) return null;
    const t0 = this.glideTime;
    const t1 = Math.min(glide.duration, t0 + Math.max(0, elapsed));
    this.glideTime = t1;
    if (t1 >= glide.duration) this.glide = null;
    const share = travelled(t0, t1);
    this.turn.dTheta = glide.vTheta * share;
    this.turn.dPhi = glide.vPhi * share;
    return this.turn;
  }
}
