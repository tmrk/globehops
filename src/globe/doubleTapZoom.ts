/**
 * Double-tap-and-drag zoom for touch screens (the Google Maps gesture). Pure recognition and distance
 * maths; GlobeRenderer owns the camera and OrbitControls hand-over.
 */

/** A second tap must land this soon after the first one lifted. */
export const DOUBLE_TAP_MS = 300;
/** ...and this close to it, in CSS pixels. */
export const DOUBLE_TAP_RADIUS_PX = 30;
/** A tap is a short touch that barely moved. */
export const TAP_MAX_MS = 300;
export const TAP_MAX_MOVE_PX = 10;
/** Vertical travel before the second touch counts as a drag rather than a double tap. */
export const DRAG_THRESHOLD_PX = 8;
/**
 * Distance change per pixel of vertical drag: about 140 px halves the distance. Pinch applies the finger
 * spread ratio to the distance raised to OrbitControls' zoomSpeed (0.7), so this stays in the same range
 * as a pinch of a similar hand movement.
 */
export const ZOOM_PER_PX = 0.005;
/** Distance multiplier for a double tap without a drag; matches the keyboard zoom-in step. */
export const TAP_ZOOM_FACTOR = 0.8;

export interface TouchSample {
  pointerType: string;
  pointerId: number;
  x: number;
  y: number;
  time: number;
}

export type ReleaseKind = 'none' | 'tap' | 'tapZoom' | 'dragEnd';

interface Contact {
  id: number;
  x: number;
  y: number;
  time: number;
}

interface Gesture {
  id: number;
  startX: number;
  startY: number;
  startDistance: number;
  dragged: boolean;
}

/** Exponential distance for a vertical finger movement: down (positive dy) zooms in, up zooms out. */
export function dragDistance(startDistance: number, dy: number, min: number, max: number): number {
  const distance = startDistance * Math.exp(-dy * ZOOM_PER_PX);
  return Math.max(min, Math.min(max, distance));
}

export class DoubleTapZoom {
  private contact: Contact | null = null;
  private lastTap: { x: number; y: number; time: number } | null = null;
  private gesture: Gesture | null = null;

  get active(): boolean {
    return this.gesture !== null;
  }

  get gestureId(): number | null {
    return this.gesture?.id ?? null;
  }

  /**
   * Registers a pointer going down; `othersDown` is how many other touches are still down. Returns true
   * when this touch starts the double-tap gesture (a second tap in time and place, no other finger down).
   */
  pointerDown(p: TouchSample, othersDown: number, distance: number): boolean {
    if (p.pointerType !== 'touch') return false;
    if (othersDown > 0) {
      this.contact = null;
      this.lastTap = null;
      return false;
    }
    const tap = this.lastTap;
    this.lastTap = null;
    if (tap && p.time - tap.time <= DOUBLE_TAP_MS && Math.hypot(p.x - tap.x, p.y - tap.y) <= DOUBLE_TAP_RADIUS_PX) {
      this.contact = null;
      this.gesture = { id: p.pointerId, startX: p.x, startY: p.y, startDistance: distance, dragged: false };
      return true;
    }
    this.contact = { id: p.pointerId, x: p.x, y: p.y, time: p.time };
    return false;
  }

  /** The new camera distance for the gesture finger, or null while it has not moved past the threshold. */
  pointerMove(id: number, x: number, y: number, min: number, max: number): number | null {
    const g = this.gesture;
    if (!g || g.id !== id) return null;
    if (!g.dragged && Math.hypot(x - g.startX, y - g.startY) <= DRAG_THRESHOLD_PX) return null;
    g.dragged = true;
    return dragDistance(g.startDistance, y - g.startY, min, max);
  }

  /**
   * 'tapZoom' and 'dragEnd' end the gesture; 'tap' means a first tap that may still become a double tap
   * (the caller should hold back single-tap actions for DOUBLE_TAP_MS).
   */
  pointerUp(p: TouchSample): ReleaseKind {
    if (p.pointerType !== 'touch') return 'none';
    const g = this.gesture;
    if (g) {
      if (g.id !== p.pointerId) return 'none';
      this.gesture = null;
      return g.dragged ? 'dragEnd' : 'tapZoom';
    }
    const c = this.contact;
    if (!c || c.id !== p.pointerId) return 'none';
    this.contact = null;
    if (p.time - c.time > TAP_MAX_MS || Math.hypot(p.x - c.x, p.y - c.y) > TAP_MAX_MOVE_PX) {
      this.lastTap = null;
      return 'none';
    }
    this.lastTap = { x: p.x, y: p.y, time: p.time };
    return 'tap';
  }

  /** Drops a contact or gesture for this pointer, without clearing a candidate first tap. */
  cancel(id: number) {
    if (this.contact?.id === id) this.contact = null;
    if (this.gesture?.id === id) this.gesture = null;
  }

  /** Forgets any candidate tap and in-progress gesture. */
  reset() {
    this.contact = null;
    this.lastTap = null;
    this.gesture = null;
  }
}
