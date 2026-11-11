import { Vector3, type PerspectiveCamera } from 'three';
import type { Vec3 } from '../lib/geo.ts';
import type { LatLng } from '../types.ts';

const DEG = Math.PI / 180;
export const LABEL_RADIUS = 1.002;
export const LABEL_FADE_START = 0.02;
export const LABEL_FADE_RANGE = 0.12;

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

/** Earth-fixed sunlight uses exactly the same scene coordinates as geographic markers. */
export function sunDirectionScene(subsolar: LatLng, target = new Vector3()): Vector3 {
  return latLngToVector3(subsolar.lat, subsolar.lng, 1, target);
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
  // Scalars keep this safe when target aliases either input, without allocating a scratch vector.
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  let wx = b.x - ax * dot;
  let wy = b.y - ay * dot;
  let wz = b.z - az * dot;
  if (wx * wx + wy * wy + wz * wz < 1e-12) {
    // Antipodal: prefer a perpendicular through the vertical axis.
    wx = -ax * ay;
    wy = 1 - ay * ay;
    wz = -az * ay;
    if (wx * wx + wy * wy + wz * wz < 1e-12) {
      wx = 1;
      wy = 0;
      wz = 0;
    }
  }
  const length = Math.sqrt(wx * wx + wy * wy + wz * wz);
  const c = Math.cos(theta * t);
  const s = Math.sin(theta * t);
  return target.set(ax * c + (wx / length) * s, ay * c + (wy / length) * s, az * c + (wz / length) * s);
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The most pixels the globe draws each frame, about a 4K UHD screen. Multisampled (antialiased) drawing costs
 * the GPU far more than its pixel count beyond about 9 million: on a 144 Hz 5K display a maximised window
 * (13 million at 2x) took ~10 ms a frame against a 6.9 ms budget and dropped every third frame, while 8.3
 * million took ~2.5 ms.
 */
export const MAX_CANVAS_PIXELS = 3840 * 2160;

/**
 * The globe canvas's pixel ratio: the device's, at most 2 (finer adds nothing visible), and lowered towards 1
 * so that a large window stays within MAX_CANVAS_PIXELS.
 */
export function canvasPixelRatio(devicePixelRatio: number, width: number, height: number): number {
  const device = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio, 2) : 1;
  const fit = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height));
  return Math.min(device, Math.max(1, fit));
}

/** Projects into a caller-owned buffer; false means the point is beyond the far clip plane. */
export function projectToScreen(
  point: Vector3,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  target: Vector3,
): boolean {
  target.copy(point).project(camera);
  if (target.z > 1) return false;
  target.x = ((target.x + 1) / 2) * width;
  target.y = ((1 - target.y) / 2) * height;
  return true;
}

/** Cosine between a surface normal and its sightline to the camera. */
export function surfaceFacing(point: Vector3, cameraPosition: Vector3): number {
  const x = cameraPosition.x - point.x;
  const y = cameraPosition.y - point.y;
  const z = cameraPosition.z - point.z;
  const length = Math.sqrt(x * x + y * y + z * z) * point.length();
  return length ? (point.x * x + point.y * y + point.z * z) / length : 0;
}

export function labelOpacity(facing: number): number {
  return clamp01((facing - LABEL_FADE_START) / LABEL_FADE_RANGE);
}
