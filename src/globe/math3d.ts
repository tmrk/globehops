import { Vector3 } from 'three';
import type { Vec3 } from '../lib/geo.ts';

const DEG = Math.PI / 180;

/**
 * Scene convention (Three.js, y-up): lat/lng (0,0) → +X, north pole → +Y, lng 90°W → +Z.
 * This matches SphereGeometry's default UV layout for an equirectangular texture whose
 * left edge is longitude −180°.
 */
export function latLngToVector3(lat: number, lng: number, radius = 1, target = new Vector3()): Vector3 {
  const phi = lat * DEG;
  const lambda = lng * DEG;
  const c = Math.cos(phi);
  return target.set(radius * c * Math.cos(lambda), radius * Math.sin(phi), -radius * c * Math.sin(lambda));
}

/** Converts a math/ECEF unit vector (x→0°,0°; y→0°,90°E; z→north) to scene space. */
export function ecefToScene(v: Vec3, radius = 1, target = new Vector3()): Vector3 {
  return target.set(v[0] * radius, v[2] * radius, -v[1] * radius);
}

export function sceneToEcef(v: Vector3): Vec3 {
  const l = v.length() || 1;
  return [v.x / l, -v.z / l, v.y / l];
}

/** Spherical linear interpolation between two unit vectors (robust for tiny angles). */
export function slerpUnit(a: Vector3, b: Vector3, t: number, target = new Vector3()): Vector3 {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  const theta = Math.acos(dot);
  if (theta < 1e-6) return target.copy(a);
  // Perpendicular component of b relative to a.
  const w = new Vector3().copy(b).addScaledVector(a, -dot);
  if (w.lengthSq() < 1e-12) {
    // Antipodal: rotate through any perpendicular, preferring one through the vertical axis.
    w.set(0, 1, 0).addScaledVector(a, -a.y);
    if (w.lengthSq() < 1e-12) w.set(1, 0, 0);
  }
  w.normalize();
  return target
    .copy(a)
    .multiplyScalar(Math.cos(theta * t))
    .addScaledVector(w, Math.sin(theta * t));
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
