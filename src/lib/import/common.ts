import { isValidLatLng } from '../geo.ts';
import type { TrackPoint } from '../track.ts';
import type { ImportErrorCode, ImportIssue, ImportWarningCode } from './types.ts';

export const MAX_TEXT_BYTES = 20 * 1024 * 1024;
export const MAX_POINTS = 250_000;
export class ImportFailure extends Error {
  readonly code: ImportErrorCode;
  readonly params: Record<string, string | number>;
  constructor(code: ImportErrorCode, message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.code = code;
    this.params = params;
  }
}
export function invalid(reason: string): never {
  throw new ImportFailure('invalid', `Invalid route file: ${reason}`, { reason });
}
export const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
export const string = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
export function number(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
/** No host-zone interpretation: zone-less ISO dates/times are UTC. */
export function timestamp(value: unknown): number | null {
  const numeric = number(value);
  if (numeric !== null) {
    const ms = Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric;
    return Math.abs(ms) <= 8.64e15 ? ms : null;
  }
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.test(s)) return null;
  s = s.replace(' ', 'T');
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) s += s.includes('T') ? 'Z' : 'T00:00:00Z';
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}
export function coordinateTime(value: unknown): number | null {
  const n = number(value);
  // A fourth GeoJSON ordinate may instead be a measure. Only credible modern epochs count.
  return n !== null && Math.abs(n) >= 1e8 && Math.abs(n) <= 1e14 ? timestamp(n) : null;
}
export class ParseState {
  points = 0;
  droppedPoints = 0;
  warnings: ImportIssue<ImportWarningCode>[] = [];
  warn(code: ImportWarningCode, message: string, params: Record<string, string | number> = {}): void {
    this.warnings.push({ code, message, params });
  }
  point(lat: unknown, lng: unknown, alt?: unknown, time?: unknown, name?: string | null): TrackPoint | null {
    if (this.points >= MAX_POINTS) throw new ImportFailure('too_large', 'More than 250,000 points in this import.');
    this.points++;
    const y = number(lat),
      x = number(lng);
    if (y === null || x === null || !isValidLatLng({ lat: y, lng: x })) {
      this.droppedPoints++;
      return null;
    }
    const altM = number(alt);
    if (alt != null && alt !== '' && altM === null && !this.warnings.some((w) => w.code === 'altitude_dropped'))
      this.warn('altitude_dropped', 'Unusable altitudes were treated as unknown.');
    return {
      lat: y,
      lng: x,
      altM,
      time: typeof time === 'number' && Number.isFinite(time) ? time : timestamp(time),
      ...(name ? { name } : {}),
    };
  }
}
