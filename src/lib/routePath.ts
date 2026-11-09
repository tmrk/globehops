/** Polylines of great-circle arcs: lengths and positions by distance fraction. */
import type { LatLng } from '../types.ts';
import { EARTH_RADIUS_KM, fromVec3, slerpVec, toVec3, type Vec3 } from './geo.ts';

export interface PathMetrics {
  vectors: Vec3[];
  /** Cumulative central angle (radians) at each vertex; starts at 0. */
  cumulative: number[];
  total: number;
}

const angleBetween = (a: Vec3, b: Vec3) =>
  Math.atan2(
    Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]),
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  );

// Paths are immutable once routed; playback reads them every frame.
const cache = new WeakMap<readonly LatLng[], PathMetrics>();
export function pathMetrics(path: readonly LatLng[]): PathMetrics {
  let metrics = cache.get(path);
  if (!metrics) {
    const vectors = path.map(toVec3);
    const cumulative = [0];
    for (let i = 1; i < vectors.length; i++)
      cumulative.push(cumulative[i - 1] + angleBetween(vectors[i - 1], vectors[i]));
    metrics = { vectors, cumulative, total: cumulative.at(-1) ?? 0 };
    cache.set(path, metrics);
  }
  return metrics;
}

export function pathLengthKm(path: readonly LatLng[]): number {
  return pathMetrics(path).total * EARTH_RADIUS_KM;
}

/** Fractions (0 … 1) of the path's length at each vertex. */
export function pathVertexFractions(path: readonly LatLng[]): number[] {
  const { cumulative, total } = pathMetrics(path);
  return cumulative.map((c) => (total > 0 ? c / total : 0));
}

/** Unit vector at fraction `f` of the path's length. */
export function vectorAlongPath(path: readonly LatLng[], f: number): Vec3 {
  const { vectors, cumulative, total } = pathMetrics(path);
  if (vectors.length < 2 || !(total > 0)) return [...(vectors[0] ?? [1, 0, 0])];
  const target = Math.min(1, Math.max(0, f)) * total;
  let lo = 0;
  let hi = cumulative.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const span = cumulative[lo + 1] - cumulative[lo];
  return slerpVec(vectors[lo], vectors[lo + 1], span > 0 ? Math.min(1, (target - cumulative[lo]) / span) : 1);
}

export function pointAlongPath(path: readonly LatLng[], f: number): LatLng {
  return fromVec3(vectorAlongPath(path, f));
}

/** Sorted union of two sorted fraction lists, dropping near-duplicates. */
export function mergeFractions(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const next = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
    if (!out.length || next - out[out.length - 1] > 1e-9) out.push(next);
  }
  return out;
}

/** Short stable signature of a path's shape (0.01° resolution), for change detection. */
export function pathSignature(path: readonly LatLng[]): string {
  let hash = 0x811c9dc5;
  for (const { lat, lng } of path)
    for (const value of [Math.round(lat * 100), Math.round(lng * 100)]) {
      hash ^= value & 0xffff;
      hash = Math.imul(hash, 0x01000193);
      hash ^= value >>> 16;
      hash = Math.imul(hash, 0x01000193);
    }
  return `${path.length.toString(36)}${(hash >>> 0).toString(36)}`;
}
