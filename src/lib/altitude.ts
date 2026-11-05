/**
 * Simplified vertical profile of an airliner flight, used to draw the route arcs.
 *
 * A flight climbs to a typical cruising altitude in a typical climb time, holds that altitude, and
 * leaves it only for the descent, which starts a typical descent time before landing. Legs too
 * short to reach cruise climb and descend over proportionally shorter distances and peak lower,
 * as short real flights do. Horizontal distances are true to scale; the renderer exaggerates the
 * vertical axis so the profile is visible at globe scale.
 */
import { EARTH_RADIUS_KM } from './geo.ts';

export interface AltitudeModel {
  /** Typical jet cruising altitude (≈ FL360). */
  cruiseAltitudeKm: number;
  /** Time from take-off to top of climb. */
  climbMinutes: number;
  /** Average ground speed during the climb. */
  climbSpeedKmh: number;
  /** Time from top of descent to touchdown. */
  descentMinutes: number;
  /** Average ground speed during the descent and approach. */
  descentSpeedKmh: number;
}

export const DEFAULT_ALTITUDE_MODEL: AltitudeModel = {
  cruiseAltitudeKm: 11,
  climbMinutes: 20,
  climbSpeedKmh: 600,
  descentMinutes: 25,
  descentSpeedKmh: 550,
};

/** Vertical exaggeration applied when drawing: true altitude would be under a pixel at globe scale. */
export const ALTITUDE_EXAGGERATION = 12;

export interface AltitudeProfile {
  distanceKm: number;
  /** Horizontal distance of the climb (from take-off to the highest altitude). */
  climbKm: number;
  /** Horizontal distance of the descent (from leaving the highest altitude to touchdown). */
  descentKm: number;
  /** Highest altitude reached: the cruising altitude unless the leg is too short. */
  peakKm: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Climb shape: steep after take-off, levelling off smoothly into cruise (zero slope at the top). */
const climbShape = (x: number) => Math.sin((Math.PI / 2) * clamp01(x));

export function climbDistanceKm(model = DEFAULT_ALTITUDE_MODEL): number {
  return (model.climbMinutes / 60) * model.climbSpeedKmh;
}

export function descentDistanceKm(model = DEFAULT_ALTITUDE_MODEL): number {
  return (model.descentMinutes / 60) * model.descentSpeedKmh;
}

export function altitudeProfile(distanceKm: number, model = DEFAULT_ALTITUDE_MODEL): AltitudeProfile {
  const distance = Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const climb = climbDistanceKm(model);
  const descent = descentDistanceKm(model);
  if (distance >= climb + descent)
    return { distanceKm: distance, climbKm: climb, descentKm: descent, peakKm: model.cruiseAltitudeKm };
  // Too short to reach cruise: both phases shrink in proportion and the climb is cut off early.
  const k = climb + descent > 0 ? distance / (climb + descent) : 0;
  return {
    distanceKm: distance,
    climbKm: climb * k,
    descentKm: descent * k,
    peakKm: model.cruiseAltitudeKm * climbShape(k),
  };
}

/** Altitude (km) after travelling `alongKm` of the leg. */
export function altitudeAt(profile: AltitudeProfile, alongKm: number): number {
  const { distanceKm, climbKm, descentKm, peakKm } = profile;
  const s = Math.min(distanceKm, Math.max(0, alongKm));
  if (s < climbKm) return peakKm * climbShape(s / climbKm);
  const remaining = distanceKm - s;
  if (remaining < descentKm) return peakKm * climbShape(remaining / descentKm);
  return peakKm;
}

/** Altitude as a fraction of the Earth's radius after vertical exaggeration (scene units for a unit globe). */
export function exaggeratedLift(altitudeKm: number, exaggeration = ALTITUDE_EXAGGERATION): number {
  return (altitudeKm / EARTH_RADIUS_KM) * exaggeration;
}

export interface SamplingOptions {
  /** Segments used for each of the climb and descent (they curve, so they need dense sampling). */
  phaseSegments?: number;
  /** Longest step across the cruise. */
  maxCruiseStepKm?: number;
  /** Upper bound for cruise segments on very long legs. */
  maxCruiseSegments?: number;
}

/**
 * Strictly increasing fractions (0 … 1) of the leg at which to sample the drawn arc: dense through
 * the climb and descent, evenly spaced across the cruise.
 */
export function profileFractions(profile: AltitudeProfile, options: SamplingOptions = {}): number[] {
  const { phaseSegments = 14, maxCruiseStepKm = 60, maxCruiseSegments = 240 } = options;
  const d = profile.distanceKm;
  if (!(d > 0)) return [0, 1];
  const climbEnd = profile.climbKm / d;
  const descentStart = 1 - profile.descentKm / d;
  const cruiseKm = Math.max(0, d * (descentStart - climbEnd));
  const cruiseSegments = Math.min(maxCruiseSegments, Math.max(1, Math.ceil(cruiseKm / maxCruiseStepKm)));
  const out: number[] = [];
  const push = (f: number) => {
    if (!out.length || f - out[out.length - 1] > 1e-9) out.push(f);
  };
  for (let i = 0; i <= phaseSegments; i++) push((climbEnd * i) / phaseSegments);
  for (let i = 1; i <= cruiseSegments; i++) push(climbEnd + ((descentStart - climbEnd) * i) / cruiseSegments);
  for (let i = 1; i <= phaseSegments; i++) push(descentStart + ((1 - descentStart) * i) / phaseSegments);
  out[out.length - 1] = 1;
  return out;
}

/**
 * Locates fraction `f` within sorted sample fractions: the segment index and the position within
 * it (0 … 1). Used to place the plane and reveal arcs by distance rather than by sample count.
 */
export function locateFraction(fractions: number[], f: number): { index: number; t: number } {
  const last = fractions.length - 2;
  if (last < 0) return { index: 0, t: 0 };
  const x = Math.min(1, Math.max(0, f));
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fractions[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  const span = fractions[lo + 1] - fractions[lo];
  return { index: lo, t: span > 0 ? Math.min(1, Math.max(0, (x - fractions[lo]) / span)) : 1 };
}
