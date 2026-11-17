/** Smallest height above the surface (in globe radii) the speed is computed for. */
export const MIN_ALTITUDE = 1e-3;

/**
 * OrbitControls `rotateSpeed` that keeps the surface point under the centre of the view roughly
 * under the pointer while dragging.
 *
 * OrbitControls turns a drag of `px` pixels into `2 * PI * px * rotateSpeed / clientHeight`
 * radians, and orbiting the camera by `a` radians moves the nadir (at `distance - 1` from the
 * camera, globe radius 1) by a visual angle of about `a / (distance - 1)`. The viewport height
 * spans `fovDegrees`, so the pixel height cancels and the speed is `(distance - 1) * fov / 360`.
 *
 * Points towards the limb still slip a little, which no constant speed can avoid.
 */
export function orbitRotateSpeed(distance: number, fovDegrees: number): number {
  return (Math.max(distance - 1, MIN_ALTITUDE) * fovDegrees) / 360;
}
