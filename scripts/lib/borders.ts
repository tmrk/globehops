/** Pure Natural Earth GeoJSON extraction, simplification, quantisation, delta encoding and validation. */

export const BORDER_SOURCE = 'Natural Earth 1:50m Admin 0 boundary lines (land) v5.1.2';
export const BORDER_SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_boundary_lines_land.geojson';
export const BORDER_PRECISION = 100;
export const MIN_BORDER_LINES = 200;
export const MIN_BORDER_POINTS = 10_000;

export const COAST_SOURCE = 'Natural Earth 1:50m coastline v5.1.2';
export const COAST_SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_coastline.geojson';
/**
 * Coastlines are simplified to 0.02° (about 2 km), well below a pixel at the closest globe zoom;
 * that removes 40% of the points (about 115 KB → 80 KB gzipped).
 */
export const COAST_SIMPLIFY_DEG = 0.02;
export const MIN_COAST_LINES = 1000;
export const MIN_COAST_POINTS = 25_000;

export interface LineLayerSource {
  source: string;
  url: string;
  /** Douglas–Peucker tolerance in degrees; 0 keeps every point. */
  simplifyDeg: number;
}

export const BORDER_LAYER: LineLayerSource = { source: BORDER_SOURCE, url: BORDER_SOURCE_URL, simplifyDeg: 0 };
export const COAST_LAYER: LineLayerSource = {
  source: COAST_SOURCE,
  url: COAST_SOURCE_URL,
  simplifyDeg: COAST_SIMPLIFY_DEG,
};

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

/**
 * Douglas–Peucker simplification in plain longitude/latitude degrees. Keeps both ends and every
 * point that deviates more than `toleranceDeg` from the simplified line. Input is not modified.
 */
export function simplifyLine<T extends readonly number[]>(points: readonly T[], toleranceDeg: number): T[] {
  if (!(toleranceDeg > 0) || points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const limit = toleranceDeg * toleranceDeg;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    let farthest = -1;
    let farthestDistance = limit;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const distance = ex * ex + ey * ey;
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return points.filter((_, index) => keep[index] === 1);
}

function isValidPointArray(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === 'number' &&
        typeof point[1] === 'number' &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
    )
  );
}

/** Preserves source line order and all points that survive 0.01° quantisation. */
export function buildBorders(raw: unknown, layer: LineLayerSource = BORDER_LAYER): BorderDataset {
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
      // Malformed points still reach encodeLine, which reports them precisely.
      const simplified =
        layer.simplifyDeg > 0 && isValidPointArray(coordinates)
          ? simplifyLine(coordinates, layer.simplifyDeg)
          : coordinates;
      const line = encodeLine(simplified, `Feature ${index}, part ${part}`);
      if (line.length) lines.push(line);
    }
  }
  return { format: 1, source: layer.source, url: layer.url, precision: BORDER_PRECISION, lines };
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
