import { describe, expect, it } from 'vitest';
import {
  DragInertia,
  INERTIA_HALF_LIFE_MS,
  INERTIA_MAX_SPEED_PX,
  INERTIA_STOP_SPEED_PX,
  glideFromSamples,
} from './dragInertia.ts';

/** 1000 pixels per radian keeps the arithmetic readable: 1 rad/s is 1000 px/s. */
const PX_PER_RAD = 1000;
const TAU = INERTIA_HALF_LIFE_MS / Math.LN2;

/** A drag at `pxPerSecond` sideways, sampled every `frameMs` up to `end`. */
function drag(inertia: DragInertia, pxPerSecond: number, end: number, frameMs = 1000 / 60) {
  inertia.begin();
  for (let t = 0; t <= end + 1e-9; t += frameMs) inertia.record(t, (pxPerSecond / PX_PER_RAD / 1000) * t, 1);
}

function glideTotal(inertia: DragInertia, frameMs: number) {
  let theta = 0;
  let phi = 0;
  let steps = 0;
  while (inertia.active && steps < 10_000) {
    const d = inertia.step(frameMs)!;
    theta += d.dTheta;
    phi += d.dPhi;
    steps++;
  }
  return { theta, phi, steps };
}

describe('glideFromSamples', () => {
  it('measures the speed just before the release', () => {
    const samples = [0, 20, 40, 60, 80, 100].map((t) => ({ time: t, theta: t / 1000, phi: 0.5 }));
    const glide = glideFromSamples(samples, 100, PX_PER_RAD)!;
    expect(glide.vTheta * 1000).toBeCloseTo(1, 9);
    expect(glide.vPhi).toBe(0);
  });

  it('does not glide when the pointer was held still before letting go', () => {
    const samples = [0, 20, 40, 60].map((t) => ({ time: t, theta: t / 1000, phi: 0 }));
    expect(glideFromSamples(samples, 400, PX_PER_RAD)).toBeNull();
  });

  it('glides more slowly after a short pause', () => {
    const samples = [0, 20, 40, 60].map((t) => ({ time: t, theta: t / 1000, phi: 0 }));
    const quick = glideFromSamples(samples, 60, PX_PER_RAD)!;
    const paused = glideFromSamples(samples, 120, PX_PER_RAD)!;
    expect(paused.vTheta).toBeLessThan(quick.vTheta / 2);
  });

  it('ignores slow releases', () => {
    const samples = [0, 20, 40].map((t) => ({ time: t, theta: (t / 1000) * 0.05, phi: 0 }));
    expect(glideFromSamples(samples, 40, PX_PER_RAD)).toBeNull();
  });

  it('caps the speed of a hard flick', () => {
    const samples = [0, 10, 20].map((t) => ({ time: t, theta: (t / 1000) * 30, phi: (t / 1000) * 40 }));
    const glide = glideFromSamples(samples, 20, PX_PER_RAD)!;
    expect(Math.hypot(glide.vTheta, glide.vPhi) * PX_PER_RAD * 1000).toBeCloseTo(INERTIA_MAX_SPEED_PX, 6);
    expect(glide.vPhi / glide.vTheta).toBeCloseTo(4 / 3, 9);
  });

  it('is the same flick at any zoom once scaled to pixels', () => {
    const slow = [0, 20, 40].map((t) => ({ time: t, theta: (t / 1000) * 0.05, phi: 0 }));
    expect(glideFromSamples(slow, 40, PX_PER_RAD)).toBeNull();
    expect(glideFromSamples(slow, 40, PX_PER_RAD * 10)).not.toBeNull();
  });

  it('handles the angle wrapping round', () => {
    const inertia = new DragInertia();
    inertia.begin();
    inertia.record(0, Math.PI - 0.01, 1);
    inertia.record(20, -Math.PI + 0.01, 1);
    expect(inertia.release(20, PX_PER_RAD)).toBe(true);
    expect(inertia.step(1)!.dTheta).toBeGreaterThan(0);
  });
});

describe('DragInertia', () => {
  it('glides a modest distance and then stops', () => {
    const inertia = new DragInertia();
    drag(inertia, 1000, 200);
    expect(inertia.release(200, PX_PER_RAD)).toBe(true);
    const { theta, phi } = glideTotal(inertia, 1000 / 60);
    // Starting at 1000 px/s, the glide covers about 1000 * tau = 173 px before it stops.
    expect(theta * PX_PER_RAD).toBeCloseTo((TAU * (1000 - INERTIA_STOP_SPEED_PX)) / 1000, 3);
    expect(phi).toBe(0);
    expect(inertia.active).toBe(false);
    expect(inertia.step(16)).toBeNull();
  });

  it('starts at the release speed so the motion carries on smoothly', () => {
    const inertia = new DragInertia();
    drag(inertia, 1000, 200);
    inertia.release(200, PX_PER_RAD);
    expect(inertia.step(1)!.dTheta * PX_PER_RAD).toBeCloseTo(1, 2);
  });

  it('plays out the same at any frame rate', () => {
    const at = (frameMs: number) => {
      const inertia = new DragInertia();
      drag(inertia, 1500, 200);
      inertia.release(200, PX_PER_RAD);
      return glideTotal(inertia, frameMs);
    };
    const a = at(1000 / 60);
    const b = at(1000 / 144);
    const c = at(37);
    expect(b.theta).toBeCloseTo(a.theta, 12);
    expect(c.theta).toBeCloseTo(a.theta, 12);
    expect(b.steps).toBeGreaterThan(a.steps);
  });

  it('lasts under a second even for the hardest flick', () => {
    const inertia = new DragInertia();
    drag(inertia, 50_000, 100);
    inertia.release(100, PX_PER_RAD);
    const { steps } = glideTotal(inertia, 1);
    expect(steps).toBeLessThan(1000);
    expect(steps).toBeGreaterThan(300);
  });

  it('stops at once when a new drag begins or it is cancelled', () => {
    const inertia = new DragInertia();
    drag(inertia, 1000, 200);
    inertia.release(200, PX_PER_RAD);
    inertia.begin();
    expect(inertia.active).toBe(false);
    drag(inertia, 1000, 200);
    inertia.release(200, PX_PER_RAD);
    inertia.cancel();
    expect(inertia.active).toBe(false);
    expect(inertia.step(16)).toBeNull();
  });

  it('does not glide without a recorded drag', () => {
    const inertia = new DragInertia();
    inertia.record(0, 0, 1);
    inertia.record(20, 1, 1);
    expect(inertia.release(20, PX_PER_RAD)).toBe(false);
    drag(inertia, 1000, 200);
    inertia.release(200, PX_PER_RAD);
    expect(inertia.release(220, PX_PER_RAD)).toBe(false);
  });
});
