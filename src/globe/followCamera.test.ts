import { describe, expect, it } from 'vitest';
import { followAngularRoom, followBlend, followDistance, followLead } from './followCamera.ts';

const halfFov = Math.PI / 12;
describe('aircraft camera composition', () => {
  it('stays close at airports and pulls back for long-haul cruise', () => {
    expect(followDistance(1.5, 0, false, halfFov)).toBeCloseTo(1.52);
    expect(followDistance(1.5, 0, true, halfFov)).toBeCloseTo(1.52);
    expect(followDistance(1.5, 1, true, halfFov)).toBeCloseTo(1.52);
    const short = followDistance(0.1, 0.5, true, halfFov);
    const long = followDistance(1.5, 0.5, true, halfFov);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThan(2.4);
    expect(followDistance(1.5, 0.5, true, halfFov / 2)).toBeGreaterThan(long);
  });
  it('has continuous phase zoom including at the endpoints of a short hop', () => {
    for (const angle of [0, 0.002, 0.1, 1, Math.PI]) {
      for (let i = 1; i <= 1000; i++) {
        const distance = followDistance(angle, i / 1000, true, halfFov);
        expect(Number.isFinite(distance)).toBe(true);
        const justBefore = followDistance(angle, i / 1000 - 1e-7, true, halfFov);
        expect(Math.abs(distance - justBefore)).toBeLessThan(0.0001);
      }
    }
  });
  it('composes the same smoothing over 30, 60 and 120 fps and settles without overshoot', () => {
    for (const fps of [30, 60, 120]) {
      let value = 0;
      for (let frame = 0; frame < fps; frame++) value += (1 - value) * followBlend(1 / fps);
      expect(value).toBeCloseTo(followBlend(1), 12);
      expect(value).toBeLessThan(1);
    }
    expect(followBlend(0)).toBe(0);
    expect(followBlend(-1)).toBe(0);
    expect(followBlend(10)).toBeCloseTo(1);
  });
  it('leads ahead, compensates for playback velocity and bounds endpoints and tiny legs', () => {
    const still = followLead(1, 0.5, 0, 2, halfFov);
    const moving = followLead(1, 0.5, 0.2, 2, halfFov);
    expect(still.fraction).toBeGreaterThan(0.5);
    expect(moving.fraction).toBeGreaterThan(still.fraction);
    expect(moving.response).toBeLessThanOrEqual(0.35);
    expect(followLead(1, 0.99, 1, 2, halfFov).fraction).toBe(1);
    expect(followLead(0, 0.5, 1, 2, halfFov).fraction).toBe(0.5);
    // Predicted lag remains within half the available viewport even at extreme playback speed.
    const fast = followLead(2, 0.3, 0.5, 1.6, halfFov);
    expect(fast.response * 2 * 0.5).toBeLessThanOrEqual(followAngularRoom(1.6, halfFov, 0.5));
  });
});
