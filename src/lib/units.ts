import type { DistanceUnit } from '../types.ts';
export const KM_PER_MILE = 1.609344;
export function convertDistance(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? km / KM_PER_MILE : km;
}
export function roundDistance(value: number): number {
  return value < 1000 ? Math.round(value) : Math.round(value / 10) * 10;
}
export function formatDistanceNumber(km: number, unit: DistanceUnit, locale = 'en-US'): string {
  return roundDistance(convertDistance(km, unit)).toLocaleString(locale);
}
export function formatDistance(km: number, unit: DistanceUnit, locale = 'en-US'): string {
  return `${formatDistanceNumber(km, unit, locale)} ${unit}`;
}
