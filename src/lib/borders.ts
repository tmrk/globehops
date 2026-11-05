/** Decodes compact land borders and linearly subdivides them for globe rendering. */

import type { LatLng } from '../types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decodes the generated format; throws Error on malformed metadata or coordinates. */
export function decodeBorders(raw: unknown): LatLng[][] {
  if (
    !isRecord(raw) ||
    raw.format !== 1 ||
    raw.precision !== 100 ||
    typeof raw.source !== 'string' ||
    !raw.source.trim() ||
    typeof raw.url !== 'string' ||
    !raw.url.trim() ||
    !Array.isArray(raw.lines)
  ) {
    throw new Error('Invalid borders dataset: expected format 1, precision 100, source, url and lines');
  }
  const precision = raw.precision;
  return Array.from(raw.lines, (encoded: unknown, index: number): LatLng[] => {
    if (!Array.isArray(encoded) || encoded.length < 4 || encoded.length % 2 !== 0) {
      throw new Error(`Invalid border line ${index}: expected at least two coordinate pairs`);
    }
    const line: LatLng[] = [];
    let lng = 0;
    let lat = 0;
    let hasDistinctPoints = false;
    for (let offset = 0; offset < encoded.length; offset += 2) {
      const deltaLng: unknown = encoded[offset];
      const deltaLat: unknown = encoded[offset + 1];
      if (
        typeof deltaLng !== 'number' ||
        typeof deltaLat !== 'number' ||
        !Number.isSafeInteger(deltaLng) ||
        !Number.isSafeInteger(deltaLat)
      ) {
        throw new Error(`Invalid border line ${index}, point ${offset / 2}: expected finite integers`);
      }
      lng += deltaLng;
      lat += deltaLat;
      if (lng < -18000 || lng > 18000 || lat < -9000 || lat > 9000) {
        throw new Error(`Invalid border line ${index}, point ${offset / 2}: decoded coordinate out of range`);
      }
      if (offset > 0 && (deltaLng !== 0 || deltaLat !== 0)) hasDistinctPoints = true;
      line.push({ lat: lat / precision, lng: lng / precision });
    }
    if (!hasDistinctPoints) throw new Error(`Invalid border line ${index}: fewer than two distinct points`);
    return line;
  });
}

/** Subdivides in lat/lng degrees, preserving parallels, meridians and antimeridian crossings. */
export function densifyLine(line: LatLng[], maxStepDeg: number): LatLng[] {
  if (!Number.isFinite(maxStepDeg) || maxStepDeg <= 0) throw new Error('maxStepDeg must be finite and positive');
  const result: LatLng[] = [];
  for (let index = 0; index < line.length; index++) {
    const point = line[index];
    if (index > 0) {
      const previous = line[index - 1];
      const deltaLng = point.lng - previous.lng;
      const deltaLat = point.lat - previous.lat;
      if (Math.abs(deltaLng) <= 180) {
        const steps = Math.ceil(Math.max(Math.abs(deltaLng), Math.abs(deltaLat)) / maxStepDeg);
        for (let step = 1; step < steps; step++) {
          const fraction = step / steps;
          result.push({ lat: previous.lat + deltaLat * fraction, lng: previous.lng + deltaLng * fraction });
        }
      }
    }
    result.push({ ...point });
  }
  return result;
}

/** Total number of adjacent point pairs, for sizing rendering buffers. */
export function countSegments(lines: LatLng[][]): number {
  return lines.reduce((count, line) => count + Math.max(0, line.length - 1), 0);
}
