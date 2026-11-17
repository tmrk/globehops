/** Camera distance (in globe radii) of the ordinary closest zoom, where the original speed curve ends. */
export const ORIGINAL_MIN_DISTANCE = 1.32;

/** Speed at the ordinary closest zoom. */
const SPEED_AT_ORIGINAL_MIN = 0.12;

/**
 * OrbitControls `rotateSpeed` for a camera `distance` (globe radius 1).
 *
 * From the ordinary closest zoom outwards this is the original curve. Closer than that, which is
 * only possible with Full-resolution imagery, the speed falls in proportion to the height above
 * the surface, so the drag keeps the same feel relative to the ground as at the ordinary limit.
 */
export function orbitRotateSpeed(distance: number): number {
  if (distance >= ORIGINAL_MIN_DISTANCE) return Math.max(SPEED_AT_ORIGINAL_MIN, Math.min(0.75, (distance - 1) * 0.28));
  const altitude = Math.max(distance - 1, 1e-3);
  return (SPEED_AT_ORIGINAL_MIN * altitude) / (ORIGINAL_MIN_DISTANCE - 1);
}
