/** Pure Natural Earth GeoJSON extraction, quantisation, delta encoding and validation. */

export const BORDER_SOURCE = 'Natural Earth 1:50m Admin 0 boundary lines (land) v5.1.2';
export const BORDER_SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_boundary_lines_land.geojson';
export const BORDER_PRECISION = 100;
export const MIN_BORDER_LINES = 200;
export const MIN_BORDER_POINTS = 10_000;

export interface BorderDataset {
  format: 1;
  source: string;
  url: string;
  precision: typeof BORDER_PRECISION;
  lines: number[][];
}

export interface BorderCounts {
  lines: number;
  points: number;
}

export interface BorderValidation {
  /** Override production thresholds only for small, synthetic fixtures. */
  minLines?: number;
  minPoints?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeLine(coordinates: unknown, context: string): number[] {
  if (!Array.isArray(coordinates)) throw new Error(`${context}: expected a coordinate array`);
  const encoded: number[] = [];
  let previousLng = 0;
  let previousLat = 0;
  for (const [index, point] of coordinates.entries()) {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      throw new Error(`${context}, point ${index}: expected finite longitude and latitude`);
    }
    const [lng, lat] = point as number[];
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new Error(`${context}, point ${index}: coordinate out of range (${lng}, ${lat})`);
    }
    const nextLng = Math.round(lng * BORDER_PRECISION);
    const nextLat = Math.round(lat * BORDER_PRECISION);
    if (encoded.length === 0) {
      encoded.push(nextLng, nextLat);
    } else if (nextLng !== previousLng || nextLat !== previousLat) {
      encoded.push(nextLng - previousLng, nextLat - previousLat);
    }
    previousLng = nextLng;
    previousLat = nextLat;
  }
  return encoded.length >= 4 ? encoded : [];
}

/** Preserves source line order and all points that survive 0.01° quantisation. */
export function buildBorders(raw: unknown): BorderDataset {
  if (!isRecord(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    throw new Error('Borders source must be a GeoJSON FeatureCollection');
  }
  const lines: number[][] = [];
  for (const [index, feature] of raw.features.entries()) {
    if (!isRecord(feature) || feature.type !== 'Feature') throw new Error(`Invalid GeoJSON feature ${index}`);
    const geometry: unknown = feature.geometry;
    if (geometry === null) continue;
    if (!isRecord(geometry) || typeof geometry.type !== 'string') {
      throw new Error(`Invalid geometry in feature ${index}`);
    }
    if (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') continue;
    if (!Array.isArray(geometry.coordinates)) throw new Error(`Missing coordinates in feature ${index}`);
    const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    for (const [part, coordinates] of parts.entries()) {
      const line = encodeLine(coordinates, `Feature ${index}, part ${part}`);
      if (line.length) lines.push(line);
    }
  }
  return { format: 1, source: BORDER_SOURCE, url: BORDER_SOURCE_URL, precision: BORDER_PRECISION, lines };
}

/** Checks decoded coordinates and detects truncated production data before any write. */
export function validateBorders(dataset: BorderDataset, validation: BorderValidation = {}): BorderCounts {
  let points = 0;
  for (const [index, line] of dataset.lines.entries()) {
    if (line.length < 4 || line.length % 2 !== 0) throw new Error(`Border line ${index}: expected at least two pairs`);
    let lng = 0;
    let lat = 0;
    let hasDistinctPoints = false;
    for (let offset = 0; offset < line.length; offset += 2) {
      const deltaLng = line[offset];
      const deltaLat = line[offset + 1];
      if (!Number.isSafeInteger(deltaLng) || !Number.isSafeInteger(deltaLat)) {
        throw new Error(`Border line ${index}, point ${offset / 2}: expected finite integers`);
      }
      lng += deltaLng;
      lat += deltaLat;
      if (
        lng < -180 * BORDER_PRECISION ||
        lng > 180 * BORDER_PRECISION ||
        lat < -90 * BORDER_PRECISION ||
        lat > 90 * BORDER_PRECISION
      ) {
        throw new Error(`Border line ${index}, point ${offset / 2}: decoded coordinate out of range`);
      }
      if (offset > 0 && (deltaLng !== 0 || deltaLat !== 0)) hasDistinctPoints = true;
      points++;
    }
    if (!hasDistinctPoints) throw new Error(`Border line ${index}: fewer than two distinct points`);
  }
  const minLines = validation.minLines ?? MIN_BORDER_LINES;
  const minPoints = validation.minPoints ?? MIN_BORDER_POINTS;
  if (dataset.lines.length < minLines) {
    throw new Error(`Too few border lines: ${dataset.lines.length}; expected at least ${minLines}`);
  }
  if (points < minPoints) throw new Error(`Too few border points: ${points}; expected at least ${minPoints}`);
  return { lines: dataset.lines.length, points };
}
