// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFeel } from './nativeFeel.ts';

afterEach(() => vi.restoreAllMocks());
it('prevents only browser zoom defaults and preserves canvas wheel, gestures and keyboard propagation', () => {
  const documentListener = vi.spyOn(document, 'addEventListener');
  const windowListener = vi.spyOn(window, 'addEventListener');
  nativeFeel();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const wheelReceived = vi.fn();
  canvas.addEventListener('wheel', wheelReceived);
  for (const ctrlKey of [false, true]) {
    const event = new WheelEvent('wheel', { ctrlKey, deltaY: -100, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(ctrlKey);
  }
  expect(wheelReceived).toHaveBeenCalledTimes(2);
  const gestureReceived = vi.fn();
  window.addEventListener('gesturestart', gestureReceived);
  const gesture = new Event('gesturestart', { bubbles: true, cancelable: true });
  canvas.dispatchEvent(gesture);
  expect(gesture.defaultPrevented).toBe(true);
  expect(gestureReceived).toHaveBeenCalledTimes(1);
  const keyboard = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true });
  canvas.dispatchEvent(keyboard);
  expect(keyboard.defaultPrevented).toBe(false);
  // Remove listeners installed by this invocation.
  for (const [type, listener] of documentListener.mock.calls) {
    if (listener) document.removeEventListener(type, listener);
  }
  for (const [type, listener] of windowListener.mock.calls) {
    if (listener) window.removeEventListener(type, listener);
  }
  canvas.remove();
});
