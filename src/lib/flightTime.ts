/**
 * An estimate, not a schedule: average airborne speed including climb/descent is
 * about 850 km/h, plus a fixed 30-minute allowance for take-off, climb, approach,
 * landing and short taxi. This intentionally simple model ignores winds, ATC,
 * actual routing and aircraft type; every assumption is configurable.
 */
export interface FlightTimeModel {
  cruiseSpeedKmh: number;
  overheadMinutes: number;
  roundingMinutes: number;
}
export const DEFAULT_FLIGHT_TIME_MODEL: FlightTimeModel = {
  cruiseSpeedKmh: 850,
  overheadMinutes: 30,
  roundingMinutes: 5,
};
export function estimateFlightMinutes(distanceKm: number, model = DEFAULT_FLIGHT_TIME_MODEL): number | null {
  if (distanceKm < 1) return null;
  if (
    !Number.isFinite(distanceKm) ||
    !Number.isFinite(model.cruiseSpeedKmh) ||
    model.cruiseSpeedKmh <= 0 ||
    !Number.isFinite(model.overheadMinutes) ||
    !Number.isFinite(model.roundingMinutes) ||
    model.roundingMinutes <= 0
  ) {
    throw new RangeError('Flight time requires a finite distance and valid model');
  }
  return Math.max(
    model.roundingMinutes,
    Math.round((model.overheadMinutes + (distanceKm / model.cruiseSpeedKmh) * 60) / model.roundingMinutes) *
      model.roundingMinutes,
  );
}
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
export function sumDurations(values: (number | null)[]): number {
  return values.reduce<number>((sum, n) => sum + (n ?? 0), 0);
}
