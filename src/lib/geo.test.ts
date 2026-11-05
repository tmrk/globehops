import { describe, it, expect } from 'vitest';
import {
  centralAngle,
  enclosingCap,
  fromVec3,
  greatCircleDistanceKm,
  greatCirclePath,
  initialBearing,
  interpolateGreatCircle,
  isValidLatLng,
  normalizeLng,
  slerpVec,
  toVec3,
  EARTH_RADIUS_KM as R,
} from './geo.ts';
import type { LatLng } from '../types.ts';
const rad = Math.PI / 180;
const cph = { lat: 55.618, lng: 12.656 },
  lhr = { lat: 51.471, lng: -0.462 },
  jfk = { lat: 40.64, lng: -73.779 };
// Airport coordinates imply ~979.5 km CPH–LHR and ~5540 km LHR–JFK;
// the task's 956/5555 km examples do not fit these coordinates.
// Independently implemented formulas, with their own known conditioning limits.
function haversine(a: LatLng, b: LatLng) {
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function cosine(a: LatLng, b: LatLng) {
  return (
    R *
    Math.acos(
      Math.sin(a.lat * rad) * Math.sin(b.lat * rad) +
        Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((a.lng - b.lng) * rad),
    )
  );
}
describe('spherical geometry', () => {
  it('matches independent distance formulas and reference distances', () => {
    for (const [a, b, reference, tolerance] of [
      [cph, lhr, 979.5, 3],
      [lhr, jfk, 5540, 10],
      [{ lat: -33.946, lng: 151.177 }, { lat: 33.943, lng: -118.408 }, 12050, 25],
    ] as const) {
      const d = greatCircleDistanceKm(a, b);
      expect(Math.abs(d - reference)).toBeLessThan(tolerance);
      expect(d).toBeCloseTo(haversine(a, b), 7);
      expect(d).toBeCloseTo(cosine(a, b), 7);
    }
    expect(greatCircleDistanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 90 })).toBeCloseTo((Math.PI * R) / 2, 8);
  });
  it('uses the short arc at the antimeridian and the pole', () => {
    const a = { lat: 0, lng: 179 },
      b = { lat: 0, lng: -179 };
    expect(greatCircleDistanceKm(a, b)).toBeCloseTo(222.39, 1);
    const path = greatCirclePath(a, b);
    for (let i = 1; i < path.length; i++)
      expect(centralAngle(fromVec3(path[i - 1]), fromVec3(path[i]))).toBeLessThan(2 * rad);
    const p = { lat: 89, lng: 0 },
      q = { lat: 89, lng: 180 };
    expect(centralAngle(p, q)).toBeCloseTo(2 * rad, 12);
    expect(interpolateGreatCircle(p, q, 0.5).lat).toBeCloseTo(90, 8);
  });
  it('handles identical, tiny, nearly antipodal and exactly antipodal arcs', () => {
    expect(greatCircleDistanceKm(cph, cph)).toBe(0);
    for (const v of greatCirclePath(cph, cph)) expect(v).toEqual(toVec3(cph));
    expect(centralAngle({ lat: 0, lng: 0 }, { lat: 0, lng: 1e-12 })).toBeCloseTo(1e-12 * rad, 20);
    const a = { lat: 0, lng: 0 };
    for (const lng of [179.9999, 180]) {
      const b = { lat: 0, lng };
      expect(greatCircleDistanceKm(a, b)).toBeCloseTo(Math.PI * R, 1);
      const path = greatCirclePath(a, b);
      expect(path).toEqual(greatCirclePath(a, b));
      expect(path[0]).toEqual(toVec3(a));
      expect(path.at(-1)).toEqual(toVec3(b));
      for (const v of path) {
        expect(Math.hypot(...v)).toBeCloseTo(1, 10);
        expect(v.every(Number.isFinite)).toBe(true);
      }
    }
    expect(fromVec3(slerpVec([1, 0, 0], [-1, 0, 0], 0.5)).lat).toBeCloseTo(90, 10);
    expect(slerpVec([0, 0, 1], [0, 0, -1], 0.5)[0]).toBeCloseTo(1);
  });
  it('validates coordinates and preserves conversion conventions and endpoints', () => {
    for (const p of [
      { lat: NaN, lng: 0 },
      { lat: 91, lng: 0 },
      { lat: 0, lng: -181 },
      { lat: 0, lng: Infinity },
    ])
      expect(isValidLatLng(p)).toBe(false);
    expect(isValidLatLng({ lat: -90, lng: 180 })).toBe(true);
    expect(normalizeLng(540)).toBe(-180);
    expect(normalizeLng(-181)).toBe(179);
    expect(toVec3({ lat: 0, lng: 0 })).toEqual([1, 0, 0]);
    expect(fromVec3(toVec3(cph)).lat).toBeCloseTo(cph.lat, 10);
    expect(fromVec3(toVec3(cph)).lng).toBeCloseTo(cph.lng, 10);
    expect(initialBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 90 })).toBe(90);
    const a = toVec3(cph),
      b = toVec3(lhr);
    expect(slerpVec(a, b, 0)).toEqual(a);
    expect(slerpVec(a, b, 1)).toEqual(b);
    expect(greatCirclePath(cph, lhr, 4)).toHaveLength(5);
  });
  it('encloses points with a true maximum angular radius', () => {
    expect(() => enclosingCap([])).toThrow();
    expect(enclosingCap([[1, 0, 0]]).radius).toBe(0);
    const cap = enclosingCap([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(cap.radius).toBeCloseTo(Math.PI / 4, 10);
    expect(fromVec3(cap.center).lng).toBeCloseTo(45, 10);
    const tetra = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ].map((v) => v.map((x) => x / Math.sqrt(3)) as [number, number, number]);
    const wide = enclosingCap(tetra);
    expect(wide.radius).toBeGreaterThan(Math.PI / 2);
    expect(wide.radius).toBeCloseTo(Math.acos(-1 / 3), 2);
    const close = enclosingCap([toVec3({ lat: 0, lng: -10 }), toVec3({ lat: 0, lng: 10 }), toVec3({ lat: 5, lng: 0 })]);
    expect(Math.abs(close.radius - 10 * rad)).toBeLessThan(rad);
  });
  it('encloses long multi-leg routes quickly and accurately', () => {
    // London → Dubai → Singapore → Sydney, densely sampled: once took seconds in WebKit.
    const stops = [
      { lat: 51.47, lng: -0.4614 },
      { lat: 25.2528, lng: 55.3644 },
      { lat: 1.35019, lng: 103.994 },
      { lat: -33.9461, lng: 151.177 },
    ];
    const points = stops.slice(1).flatMap((to, i) => greatCirclePath(stops[i], to, 120));
    const start = performance.now();
    const cap = enclosingCap(points);
    expect(performance.now() - start).toBeLessThan(250);
    const farthest = Math.max(
      ...points.map((p) =>
        Math.acos(
          Math.min(
            1,
            p.reduce((s, x, j) => s + x * cap.center[j], 0),
          ),
        ),
      ),
    );
    expect(farthest).toBeCloseTo(cap.radius, 6);
    // Halfway between the most distant pair is a lower bound for any enclosing cap.
    expect(cap.radius).toBeGreaterThanOrEqual(centralAngle(stops[0], stops[3]) / 2 - 1e-9);
    expect(cap.radius).toBeLessThan(1.35);
  });
});
