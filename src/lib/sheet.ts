/**
 * Decisions for the mobile journey sheet's drag gesture. Offsets are in CSS pixels (positive = down),
 * velocities in px/ms.
 *
 * The sheet rests at one of three heights (detents): `peek` (the globe with the play launcher or the
 * clock beneath it), `half` (the journey beside a still-visible globe) and `full` (nearly the whole
 * screen, for editing a journey that does not fit in half).
 */
export type SheetDetent = 'peek' | 'half' | 'full';

export interface SheetRelease {
  /** How far the sheet has been dragged from its resting position. */
  offset: number;
  /** Recent finger velocity, smoothed. */
  velocity: number;
  /** Height of the sheet at rest. */
  height: number;
  detent: SheetDetent;
  /** Whether the half sheet's content is taller than it, so there is a full height to grow to. */
  canGrow: boolean;
}

/**
 * Where a released drag comes to rest. A flick or a long enough drag moves one detent (a very long one
 * from full goes straight to peek); short movements and flicks the other way spring back.
 */
export function sheetRelease({ offset, velocity, height, detent, canGrow }: SheetRelease): SheetDetent {
  if (detent === 'peek') return offset < -24 || (velocity < -0.35 && offset < -4) ? 'half' : 'peek';
  if (detent === 'half') {
    if (velocity > 0.45 && offset > 12) return 'peek';
    if (velocity >= -0.3 && offset > Math.min(140, height * 0.3)) return 'peek';
    if (canGrow && (offset < -48 || (velocity < -0.35 && offset < -8))) return 'full';
    return 'half';
  }
  if (offset > height * 0.6 && velocity >= -0.3) return 'peek';
  if (velocity > 0.45 && offset > 12) return 'half';
  if (velocity < -0.3) return 'full';
  return offset > Math.min(160, height * 0.25) ? 'half' : 'full';
}

/**
 * Offset applied while dragging: free towards a detent the sheet can reach (the peek bar lifts with a
 * little damping), resisted in a direction it cannot go.
 */
export function sheetDragOffset(delta: number, detent: SheetDetent, canGrow = false): number {
  const resist = (d: number) => Math.sign(d) * Math.min(28, Math.abs(d) * 0.25);
  if (detent === 'peek') return delta < 0 ? Math.max(-90, delta * 0.6) : resist(delta);
  if (detent === 'half' && canGrow) return delta > 0 ? delta : Math.max(-260, delta * 0.85);
  return delta > 0 ? delta : resist(delta);
}
