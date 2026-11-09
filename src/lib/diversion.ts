/** Illustrative still-air OEI coverage on the same sphere as the route geometry. */
import type { LatLng } from '../types.ts';
import type { DiversionDataset } from '../data/diversion.ts';
import { EARTH_RADIUS_KM, toVec3, slerpVec, fromVec3, centralAngle, type Vec3 } from './geo.ts';
export interface DiversionProfile {
  id: string;
  version: number;
  maxDiversionMin: number;
  oeiSpeedKt: number;
}
export const DIVERSION_MODEL_VERSION = 1;
export const DIVERSION_THRESHOLD_MIN = 60;
export const DEFAULT_DIVERSION_PROFILE: DiversionProfile = Object.freeze({
  id: 'twin-180',
  version: DIVERSION_MODEL_VERSION,
  maxDiversionMin: 180,
  oeiSpeedKt: 400,
});
export function diversionProfile(minutes: number, oeiSpeedKt = 400): DiversionProfile {
  if (!Number.isFinite(minutes) || minutes < 60 || minutes > 370 || !Number.isFinite(oeiSpeedKt) || oeiSpeedKt <= 0)
    throw new Error('Diversion profile requires 60–370 minutes and a positive finite OEI speed');
  return { id: `twin-${minutes}`, version: DIVERSION_MODEL_VERSION, maxDiversionMin: minutes, oeiSpeedKt };
}
export function diversionRadiusKm(profile: DiversionProfile): number {
  diversionProfile(profile.maxDiversionMin, profile.oeiSpeedKt);
  if (!profile.id.trim() || !Number.isSafeInteger(profile.version) || profile.version < 1)
    throw new Error('Invalid diversion profile identity');
  const km = (profile.maxDiversionMin / 60) * profile.oeiSpeedKt * 1.852;
  if (!Number.isFinite(km)) throw new Error('Invalid diversion radius');
  return km;
}
/** Coverage may add at most this much flying to the route without the constraint. */
export const coverageAllowanceKm = (baselineKm: number): number => Math.max(150, 0.08 * baselineKm);
const RAD = Math.PI / 180;
export const COVERAGE_GRID_RES = 0.5;
export const COVERAGE_GRID_WIDTH = 720;
export const COVERAGE_GRID_HEIGHT = 360;
/** > half the diagonal of a 0.5° cell everywhere on the sphere (39.32 km). */
export const COVERAGE_CELL_MARGIN_KM = 40;
export const COVERAGE_SAMPLE_DEG = 0.1;
interface IndexedPoint {
  lat: number;
  v: Vec3;
}
/** Latitude-sorted exact nearest index; latitude separation bounds spherical distance from below. */
export class DiversionIndex {
  private readonly points: IndexedPoint[];
  constructor(points: readonly LatLng[]) {
    this.points = points.map((p) => ({ lat: p.lat * RAD, v: toVec3(p) })).sort((a, b) => a.lat - b.lat);
  }
  nearestKm(point: LatLng): number {
    return this.nearestVectorKm(toVec3(point));
  }
  nearestVectorKm(v: Vec3): number {
    const lat = Math.atan2(v[2], Math.hypot(v[0], v[1]));
    const pts = this.points;
    let lo = 0,
      hi = pts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (pts[mid].lat < lat) lo = mid + 1;
      else hi = mid;
    }
    let left = lo - 1,
      right = lo,
      best = Math.PI,
      bestDot = -Infinity;
    let nearest: Vec3 | null = null;
    while (left >= 0 || right < pts.length) {
      const dl = left >= 0 ? lat - pts[left].lat : Infinity;
      const dr = right < pts.length ? pts[right].lat - lat : Infinity;
      if (Math.min(dl, dr) > best) break;
      const p = dl <= dr ? pts[left--] : pts[right++];
      const dot = v[0] * p.v[0] + v[1] * p.v[1] + v[2] * p.v[2];
      if (dot > bestDot) {
        bestDot = dot;
        nearest = p.v;
        best = Math.acos(Math.max(-1, Math.min(1, dot)));
      }
    }
    if (!nearest) return Infinity;
    const n = nearest;
    return (
      Math.atan2(Math.hypot(v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]), bestDot) *
      EARTH_RADIUS_KM
    );
  }
}

/** Rasterises spherical caps row-wise; only centres at radius − 40 km are covered. */
export function rasteriseCoverage(
  points: readonly LatLng[],
  radiusKm: number,
  grid = new Uint8Array(720 * 360),
): Uint8Array {
  const theta = (radiusKm - COVERAGE_CELL_MARGIN_KM) / EARTH_RADIUS_KM;
  if (theta < 0) return grid;
  if (theta >= Math.PI) {
    if (points.length) grid.fill(1);
    return grid;
  }
  const cosTheta = Math.cos(theta),
    res = COVERAGE_GRID_RES;
  const fill = (row: number, first: number, last: number) => {
    if (last - first >= 719) {
      grid.fill(1, row * 720, (row + 1) * 720);
      return;
    }
    const start = ((first % 720) + 720) % 720,
      count = last - first + 1;
    if (count <= 0) return;
    grid.fill(1, row * 720 + start, row * 720 + Math.min(720, start + count));
    if (start + count > 720) grid.fill(1, row * 720, row * 720 + start + count - 720);
  };
  for (const p of points) {
    const phi = p.lat * RAD,
      sp = Math.sin(phi),
      cp = Math.cos(phi);
    const first = Math.max(0, Math.ceil((p.lat - theta / RAD + 90) / res - 0.5));
    const last = Math.min(359, Math.floor((p.lat + theta / RAD + 90) / res - 0.5));
    for (let r = first; r <= last; r++) {
      const lat = (-90 + (r + 0.5) * res) * RAD;
      const denominator = Math.cos(lat) * cp;
      const x =
        denominator > 1e-15 ? (cosTheta - Math.sin(lat) * sp) / denominator : Math.abs(lat - phi) <= theta ? -1 : 2;
      if (x > 1) continue;
      const half = x <= -1 ? 180 : Math.acos(x) / RAD;
      fill(r, Math.ceil((p.lng - half + 180) / res - 0.5), Math.floor((p.lng + half + 180) / res - 0.5));
    }
  }
  return grid;
}

/** Dataset-local, small LRU: endpoint caps are added to a copy, never retained per flight. */
export function createCoverageModel(dataset: DiversionDataset) {
  const grids = new Map<string, Uint8Array>();
  let builds = 0;
  return {
    get gridBuilds() {
      return builds;
    },
    get cachedGrids() {
      return grids.size;
    },
    airports(excluded: ReadonlySet<number>) {
      return dataset.airports.filter((a) => !excluded.has(a.id));
    },
    grid(radiusKm: number, excluded: ReadonlySet<number>, endpoints: readonly LatLng[]) {
      const key = `${dataset.meta.contentHash}|${radiusKm}|${[...excluded].sort((a, b) => a - b).join(',')}`;
      let base = grids.get(key);
      if (base) grids.delete(key);
      else {
        base = rasteriseCoverage(
          dataset.airports.filter((a) => !excluded.has(a.id)),
          radiusKm,
        );
        builds++;
      }
      grids.set(key, base);
      if (grids.size > 4) grids.delete(grids.keys().next().value!);
      return rasteriseCoverage(endpoints, radiusKm, base.slice());
    },
  };
}

/** Lipschitz certificate: every sample has half its arc's sample spacing of spare radius. */
export function pathCovered(points: readonly Vec3[], index: DiversionIndex, radiusKm: number): boolean {
  if (points.length === 1) return index.nearestVectorKm(points[0]) <= radiusKm;
  for (let i = 1; i < points.length; i++) {
    const a = fromVec3(points[i - 1]),
      b = fromVec3(points[i]);
    const angle = centralAngle(a, b),
      n = Math.max(1, Math.ceil(angle / (COVERAGE_SAMPLE_DEG * RAD)));
    const limit = radiusKm - (angle * EARTH_RADIUS_KM) / n / 2;
    for (let j = 0; j <= n; j++)
      if (index.nearestVectorKm(slerpVec(points[i - 1], points[i], j / n)) > limit) return false;
  }
  return true;
}
/** Route-distance metrics use ≤0.1° samples, with linear boundary interpolation between them. */
export function coverageMetrics(points: readonly LatLng[], index: DiversionIndex, profile: DiversionProfile) {
  const radius = diversionRadiusKm(profile),
    speed = (profile.oeiSpeedKt * 1.852) / 60;
  const threshold = DIVERSION_THRESHOLD_MIN * speed;
  let maxKm = index.nearestKm(points[0]),
    outsideKm = 0,
    beyondThresholdKm = 0;
  const fraction = (a: number, b: number, limit: number) => {
    if (a <= limit && b <= limit) return 0;
    if (a > limit && b > limit) return 1;
    return (Math.max(a, b) - limit) / Math.abs(b - a);
  };
  for (let i = 1; i < points.length; i++) {
    const a = toVec3(points[i - 1]),
      b = toVec3(points[i]);
    const angle = centralAngle(points[i - 1], points[i]);
    const n = Math.max(1, Math.ceil(angle / (COVERAGE_SAMPLE_DEG * RAD))),
      step = (angle * EARTH_RADIUS_KM) / n;
    let previous = index.nearestVectorKm(a);
    for (let j = 1; j <= n; j++) {
      const distance = index.nearestVectorKm(slerpVec(a, b, j / n));
      maxKm = Math.max(maxKm, distance);
      outsideKm += step * fraction(previous, distance, radius);
      beyondThresholdKm += step * fraction(previous, distance, threshold);
      previous = distance;
    }
  }
  return { maxMin: Math.ceil(maxKm / speed), outsideKm, beyondThresholdKm };
}
