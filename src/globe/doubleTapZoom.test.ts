import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_RADIUS_PX,
  DRAG_THRESHOLD_PX,
  DoubleTapZoom,
  TAP_MAX_MS,
  ZOOM_PER_PX,
  dragDistance,
  type TouchSample,
} from './doubleTapZoom.ts';

const touch = (time: number, x = 100, y = 200, pointerId = 1): TouchSample => ({
  pointerType: 'touch',
  pointerId,
  x,
  y,
  time,
});

/** A completed first tap at t = 0..50. */
function firstTap(z: DoubleTapZoom, x = 100, y = 200) {
  z.pointerDown(touch(0, x, y), 0, 5);
  return z.pointerUp(touch(50, x, y));
}

describe('dragDistance', () => {
  it('zooms in when dragging down and out when dragging up', () => {
    expect(dragDistance(5, 100, 1, 20)).toBeLessThan(5);
    expect(dragDistance(5, -100, 1, 20)).toBeGreaterThan(5);
    expect(dragDistance(5, 0, 1, 20)).toBe(5);
  });

  it('is exponential, so equal drags scale by equal ratios', () => {
    const once = dragDistance(8, 40, 0.1, 100);
    const twice = dragDistance(once, 40, 0.1, 100);
    expect(twice / once).toBeCloseTo(once / 8, 10);
    expect(dragDistance(8, 100, 0.1, 100)).toBeCloseTo(8 * Math.exp(-100 * ZOOM_PER_PX), 10);
  });

  it('clamps to the minimum and maximum', () => {
    expect(dragDistance(5, 10_000, 1.5, 20)).toBe(1.5);
    expect(dragDistance(5, -10_000, 1.5, 20)).toBe(20);
  });
});

describe('DoubleTapZoom recognition', () => {
  it('turns a short still touch into a candidate tap', () => {
    expect(firstTap(new DoubleTapZoom())).toBe('tap');
  });

  it('starts the gesture on a second touch within the window and radius', () => {
    const z = new DoubleTapZoom();
    firstTap(z);
    const start = z.pointerDown(touch(50 + DOUBLE_TAP_MS, 100 + DOUBLE_TAP_RADIUS_PX, 200, 2), 0, 5);
    expect(start).toBe(true);
    expect(z.active).toBe(true);
    expect(z.gestureId).toBe(2);
  });

  it('does not start it after the window or beyond the radius', () => {
    const late = new DoubleTapZoom();
    firstTap(late);
    expect(late.pointerDown(touch(50 + DOUBLE_TAP_MS + 1, 100, 200, 2), 0, 5)).toBe(false);
    expect(late.active).toBe(false);

    const far = new DoubleTapZoom();
    firstTap(far);
    expect(far.pointerDown(touch(100, 100 + DOUBLE_TAP_RADIUS_PX + 1, 200, 2), 0, 5)).toBe(false);
  });

  it('never starts for mouse or pen, and does not record them as taps', () => {
    const z = new DoubleTapZoom();
    for (const pointerType of ['mouse', 'pen']) {
      z.pointerDown({ ...touch(0), pointerType }, 0, 5);
      expect(z.pointerUp({ ...touch(50), pointerType })).toBe('none');
      expect(z.pointerDown({ ...touch(100, 100, 200, 2), pointerType }, 0, 5)).toBe(false);
    }
    expect(z.active).toBe(false);
  });

  it('treats a touch that lands while another is down as a pinch', () => {
    const z = new DoubleTapZoom();
    firstTap(z);
    expect(z.pointerDown(touch(100, 100, 200, 2), 1, 5)).toBe(false);
    z.pointerUp(touch(120, 100, 200, 2));
    expect(z.pointerDown(touch(150, 100, 200, 3), 0, 5)).toBe(false);
  });

  it('does not count long or moving touches as taps', () => {
    const slow = new DoubleTapZoom();
    slow.pointerDown(touch(0), 0, 5);
    expect(slow.pointerUp(touch(TAP_MAX_MS + 1))).toBe('none');
    expect(slow.pointerDown(touch(TAP_MAX_MS + 50, 100, 200, 2), 0, 5)).toBe(false);

    const drag = new DoubleTapZoom();
    drag.pointerDown(touch(0), 0, 5);
    expect(drag.pointerUp(touch(50, 100, 260))).toBe('none');
    expect(drag.pointerDown(touch(100, 100, 260, 2), 0, 5)).toBe(false);
  });

  it('uses each tap only once', () => {
    const z = new DoubleTapZoom();
    firstTap(z);
    z.pointerDown(touch(100, 100, 200, 2), 0, 5);
    z.pointerUp(touch(150, 100, 200, 2));
    expect(z.pointerDown(touch(200, 100, 200, 3), 0, 5)).toBe(false);
  });
});

describe('DoubleTapZoom gesture', () => {
  function started() {
    const z = new DoubleTapZoom();
    firstTap(z);
    z.pointerDown(touch(100, 100, 200, 2), 0, 5);
    return z;
  }

  it('ignores movement below the drag threshold', () => {
    const z = started();
    expect(z.pointerMove(2, 100, 200 + DRAG_THRESHOLD_PX, 1, 20)).toBeNull();
    expect(z.pointerUp(touch(160, 100, 200 + DRAG_THRESHOLD_PX, 2))).toBe('tapZoom');
    expect(z.active).toBe(false);
  });

  it('zooms from the start distance by the total vertical movement', () => {
    const z = started();
    expect(z.pointerMove(2, 100, 300, 1, 20)).toBeCloseTo(dragDistance(5, 100, 1, 20), 10);
    expect(z.pointerMove(2, 100, 100, 1, 20)).toBeCloseTo(dragDistance(5, -100, 1, 20), 10);
    expect(z.pointerMove(2, 100, 100000, 1.5, 20)).toBe(1.5);
  });

  it('stays a drag once it has moved, even if the finger returns', () => {
    const z = started();
    z.pointerMove(2, 100, 260, 1, 20);
    expect(z.pointerMove(2, 100, 200, 1, 20)).toBe(5);
    expect(z.pointerUp(touch(300, 100, 200, 2))).toBe('dragEnd');
  });

  it('ignores other pointers', () => {
    const z = started();
    expect(z.pointerMove(9, 100, 300, 1, 20)).toBeNull();
    expect(z.pointerUp(touch(160, 100, 200, 9))).toBe('none');
    expect(z.active).toBe(true);
  });

  it('treats a sideways slide past the threshold as a drag, not a tap zoom', () => {
    const z = started();
    expect(z.pointerMove(2, 100 + DRAG_THRESHOLD_PX + 1, 200, 1, 20)).toBe(5);
    expect(z.pointerUp(touch(300, 100 + DRAG_THRESHOLD_PX + 1, 200, 2))).toBe('dragEnd');
  });

  it('cancel drops a contact or gesture without clearing a candidate tap', () => {
    const contact = new DoubleTapZoom();
    contact.pointerDown(touch(0), 0, 5);
    contact.cancel(1);
    expect(contact.pointerUp(touch(50))).toBe('none');

    const z = new DoubleTapZoom();
    firstTap(z);
    z.cancel(99);
    expect(z.pointerDown(touch(100, 100, 200, 2), 0, 5)).toBe(true);
    z.cancel(2);
    expect(z.active).toBe(false);
  });

  it('reset clears the candidate and the gesture', () => {
    const z = started();
    z.reset();
    expect(z.active).toBe(false);
    expect(z.pointerMove(2, 100, 300, 1, 20)).toBeNull();

    const candidate = new DoubleTapZoom();
    firstTap(candidate);
    candidate.reset();
    expect(candidate.pointerDown(touch(100, 100, 200, 2), 0, 5)).toBe(false);
  });
});
