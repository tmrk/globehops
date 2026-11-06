import { altitudeAt, altitudeProfile } from '../lib/altitude.ts';
import { EARTH_RADIUS_KM } from '../lib/geo.ts';
import { clamp01 } from './math3d.ts';

export const FOLLOW_APPROACH_MS = 1500;
const FOLLOW_RESPONSE_SECONDS = 0.35;

/** Exponential response composes exactly across frame rates and cannot overshoot. */
export function followBlend(deltaSeconds: number, responseSeconds = FOLLOW_RESPONSE_SECONDS): number {
  return -Math.expm1(-Math.max(0, deltaSeconds) / responseSeconds);
}

/** Ground/climb/descent are intimate; long-haul cruise gets more geographic context. */
export function followDistance(
  legAngle: number,
  fraction: number,
  airborne: boolean,
  halfFov: number,
  profile = altitudeProfile(Math.max(0, legAngle) * EARTH_RADIUS_KM),
): number {
  const height =
    airborne && profile.peakKm > 0 ? altitudeAt(profile, clamp01(fraction) * profile.distanceKm) / profile.peakKm : 0;
  const phase = height * height * (3 - 2 * height);
  const cruise = 0.23 + Math.min(0.62, Math.max(0, legAngle) * 0.3);
  // Preserve the composition when panels narrow the available field of view.
  const insetScale = Math.max(1, Math.tan(Math.PI / 12) / Math.tan(Math.max(0.04, halfFov)));
  return 1 + (0.52 + cruise * phase) * insetScale;
}

/** Angular radius on the ground of a viewport fraction, safely inside the limb. */
export function followAngularRoom(distance: number, halfFov: number, portion: number): number {
  return Math.min(Math.acos(1 / Math.max(1.001, distance)) * 0.65, (distance - 1) * Math.tan(halfFov) * portion);
}

export function followLead(
  legAngle: number,
  fraction: number,
  fractionPerSecond: number,
  distance: number,
  halfFov: number,
  target = { fraction: 0, response: 0 },
): { fraction: number; response: number } {
  if (legAngle < 1e-8) {
    target.fraction = clamp01(fraction);
    target.response = FOLLOW_RESPONSE_SECONDS;
    return target;
  }
  const room = followAngularRoom(distance, halfFov, 0.5);
  const angularSpeed = Math.max(0, fractionPerSecond) * legAngle;
  // At extreme speeds shorten the response so stopping/starting never loses the aircraft.
  const response = Math.min(FOLLOW_RESPONSE_SECONDS, room / Math.max(1e-8, angularSpeed));
  const lead = followAngularRoom(distance, halfFov, 0.2);
  target.fraction = clamp01(fraction + lead / legAngle + Math.max(0, fractionPerSecond) * response);
  target.response = Math.max(0.015, response);
  return target;
}
