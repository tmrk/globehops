/**
 * Decisions for the mobile journey sheet's drag gesture. Offsets are in CSS pixels (positive = down),
 * velocities in px/ms.
 */
export interface SheetRelease {
  /** How far the sheet has been dragged from its resting position. */
  offset: number;
  /** Recent finger velocity, smoothed. */
  velocity: number;
  /** Height of the expanded sheet. */
  height: number;
  collapsed: boolean;
}

export type SheetAction = 'collapse' | 'expand' | 'stay';

/** A flick or a drag past about a third of the sheet (at most 140 px) collapses it; a small lift expands it. */
export function sheetRelease({ offset, velocity, height, collapsed }: SheetRelease): SheetAction {
  if (collapsed) return offset < -24 || (velocity < -0.35 && offset < -4) ? 'expand' : 'stay';
  if (velocity > 0.45 && offset > 12) return 'collapse';
  if (velocity < -0.3) return 'stay';
  return offset > Math.min(140, height * 0.3) ? 'collapse' : 'stay';
}

/** Offset applied while dragging: free downwards when expanded, resisted in the direction it cannot go. */
export function sheetDragOffset(delta: number, collapsed: boolean): number {
  const resist = (d: number) => Math.sign(d) * Math.min(28, Math.abs(d) * 0.25);
  if (collapsed) return delta < 0 ? Math.max(-90, delta * 0.6) : resist(delta);
  return delta > 0 ? delta : resist(delta);
}
