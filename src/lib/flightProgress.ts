import { altitudeProfile, DEFAULT_ALTITUDE_MODEL } from './altitude.ts';
export interface ProgressModel {
  durationMin: number;
  distanceKm: number;
  climbMin: number;
  descentMin: number;
  climbKm: number;
  descentKm: number;
}
export function progressModel(distanceKm: number, durationMin: number, model = DEFAULT_ALTITUDE_MODEL): ProgressModel {
  const profile = altitudeProfile(distanceKm, model);
  const duration = Number.isFinite(durationMin) ? Math.max(0, durationMin) : 0;
  const tc = (profile.climbKm / model.climbSpeedKmh) * 60;
  const td = (profile.descentKm / model.descentSpeedKmh) * 60;
  const cruise = Math.max(0, profile.distanceKm - profile.climbKm - profile.descentKm);
  const scale = tc + td > 0 ? (cruise < 1e-9 ? duration / (tc + td) : Math.min(1, (0.8 * duration) / (tc + td))) : 0;
  return {
    durationMin: duration,
    distanceKm: profile.distanceKm,
    climbMin: tc * scale,
    descentMin: td * scale,
    climbKm: profile.climbKm,
    descentKm: profile.descentKm,
  };
}
export function distanceFractionAt(m: ProgressModel, elapsedMin: number): number {
  if (elapsedMin <= 0) return 0;
  if (elapsedMin >= m.durationMin) return 1;
  if (m.distanceKm <= 0) return elapsedMin / m.durationMin;
  let distance: number;
  if (elapsedMin < m.climbMin) distance = (m.climbKm * elapsedMin) / m.climbMin;
  else if (elapsedMin >= m.durationMin - m.descentMin)
    distance = m.distanceKm - (m.descentKm * (m.durationMin - elapsedMin)) / m.descentMin;
  else {
    const cruiseMin = m.durationMin - m.climbMin - m.descentMin;
    distance = m.climbKm + ((m.distanceKm - m.climbKm - m.descentKm) * (elapsedMin - m.climbMin)) / cruiseMin;
  }
  return Math.min(1, Math.max(0, distance / m.distanceKm));
}
export function flightPhaseAt(m: ProgressModel, elapsedMin: number): 'climb' | 'cruise' | 'descent' {
  if (elapsedMin < m.climbMin) return 'climb';
  return elapsedMin >= m.durationMin - m.descentMin ? 'descent' : 'cruise';
}
