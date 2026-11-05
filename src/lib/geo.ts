import type { LatLng } from '../types.ts';

export type Vec3 = [number, number, number];
export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(...a);
const unit = (a: Vec3): Vec3 => {
  const n = length(a);
  return n ? (a.map((x) => x / n) as Vec3) : [1, 0, 0];
};
const angle = (a: Vec3, b: Vec3) =>
  Math.atan2(Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]), dot(a, b));

export function isValidLatLng(p: { lat: number; lng: number }): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
export function toVec3(p: LatLng): Vec3 {
  const lat = p.lat * RAD,
    lng = p.lng * RAD;
  return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
}
export function fromVec3(v: Vec3): LatLng {
  return { lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD, lng: normalizeLng(Math.atan2(v[1], v[0]) / RAD) };
}
export function centralAngle(a: LatLng, b: LatLng): number {
  const p = a.lat * RAD,
    q = b.lat * RAD,
    d = (b.lng - a.lng) * RAD;
  // Vincenty's spherical special case retains precision at both ends of [0, pi].
  return Math.atan2(
    Math.hypot(Math.cos(q) * Math.sin(d), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d)),
    Math.sin(p) * Math.sin(q) + Math.cos(p) * Math.cos(q) * Math.cos(d),
  );
}
export function greatCircleDistanceKm(a: LatLng, b: LatLng): number {
  return EARTH_RADIUS_KM * centralAngle(a, b);
}
export function initialBearing(a: LatLng, b: LatLng): number {
  const p = a.lat * RAD,
    q = b.lat * RAD,
    d = (b.lng - a.lng) * RAD;
  return (
    (Math.atan2(Math.sin(d) * Math.cos(q), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d)) / RAD +
      360) %
    360
  );
}
export function slerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t === 0) return [...a];
  if (t === 1) return [...b];
  const d = dot(a, b);
  let w: Vec3 = [b[0] - a[0] * d, b[1] - a[1] * d, b[2] - a[2] * d];
  if (length(w) < 1e-14) {
    if (d >= 0) return [...a];
    // Antipodes have infinitely many arcs. Prefer the plane containing north;
    // at either pole the x-axis is the deterministic perpendicular instead.
    w = Math.abs(a[2]) > 1 - 1e-14 ? [1, 0, 0] : unit([-a[0] * a[2], -a[1] * a[2], 1 - a[2] ** 2]);
  } else w = unit(w);
  const theta = angle(a, b),
    c = Math.cos(t * theta),
    s = Math.sin(t * theta);
  return unit([a[0] * c + w[0] * s, a[1] * c + w[1] * s, a[2] * c + w[2] * s]);
}
export function greatCirclePath(a: LatLng, b: LatLng, segments?: number): Vec3[] {
  const count =
    segments === undefined
      ? Math.min(256, Math.max(8, Math.ceil(centralAngle(a, b) / RAD)))
      : Number.isFinite(segments)
        ? Math.max(1, Math.floor(segments))
        : 8;
  const u = toVec3(a),
    v = toVec3(b);
  return Array.from({ length: count + 1 }, (_, i) => slerpVec(u, v, i / count));
}
export function interpolateGreatCircle(a: LatLng, b: LatLng, f: number): LatLng {
  return fromVec3(slerpVec(toVec3(a), toVec3(b), f));
}

/** Deterministic multi-start spherical minimax search; also handles caps larger than a hemisphere. */
export function enclosingCap(points: Vec3[]): { center: Vec3; radius: number } {
  if (!points.length) throw new Error('Cannot enclose an empty set');
  if (points.length === 1) return { center: [...points[0]], radius: 0 };
  if (points.length === 2)
    return { center: slerpVec(points[0], points[1], 0.5), radius: angle(points[0], points[1]) / 2 };
  const mean: Vec3 = [0, 0, 0];
  for (const p of points) for (let j = 0; j < 3; j++) mean[j] += p[j];
  const starts: Vec3[] = [
    length(mean) > 1e-12 ? unit(mean) : points[0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  // Hot loop (thousands of evaluations): the farthest point has the smallest dot product, so compare
  // dot products and take one acos per evaluation instead of an atan2/hypot per point.
  const radius = (c: Vec3) => {
    let minDot = 1;
    for (const p of points) {
      const d = c[0] * p[0] + c[1] * p[1] + c[2] * p[2];
      if (d < minDot) minDot = d;
    }
    return Math.acos(Math.max(-1, minDot));
  };
  let best = { center: starts[0], radius: Infinity };
  for (const start of starts) {
    let center = start,
      r = radius(center);
    // Search tangent directions, reducing the angular step when no improvement
    // is possible. Multiple starts avoid the hemisphere assumption of mean-only methods.
    for (let step = Math.PI / 4; step > 1e-6;) {
      const axis: Vec3 = Math.abs(center[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const d = dot(center, axis);
      const u = unit(axis.map((x, j) => x - center[j] * d) as Vec3);
      const v: Vec3 = [
        center[1] * u[2] - center[2] * u[1],
        center[2] * u[0] - center[0] * u[2],
        center[0] * u[1] - center[1] * u[0],
      ];
      let next = center,
        nextR = r;
      for (let i = 0; i < 16; i++) {
        const phi = (i * Math.PI) / 8;
        const candidate = unit(
          center.map(
            (x, j) => x * Math.cos(step) + (u[j] * Math.cos(phi) + v[j] * Math.sin(phi)) * Math.sin(step),
          ) as Vec3,
        );
        const candidateR = radius(candidate);
        if (candidateR < nextR - 1e-12) {
          next = candidate;
          nextR = candidateR;
        }
      }
      if (next === center) step /= 2;
      else {
        center = next;
        r = nextR;
      }
    }
    if (r < best.radius) best = { center, radius: r };
  }
  return best;
}
