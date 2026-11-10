// @vitest-environment jsdom
import { act, createElement, StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBottomSheet } from './useBottomSheet.ts';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('finishes only the panel transform and cancels pending collapse on disable or unmount', async () => {
  const setCollapsed = vi.fn();
  let collapse = () => {};
  function Probe({ enabled = true, reducedMotion = false }) {
    const ref = useRef<HTMLDivElement>(null);
    const sheet = useBottomSheet(ref, {
      enabled,
      reducedMotion,
      detent: 'half',
      onDetent: (detent) => setCollapsed(detent === 'peek'),
      peek: 'route',
    });
    collapse = sheet.collapse;
    return createElement('div', { ref }, createElement('span'));
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (props = {}) => act(() => root.render(createElement(StrictMode, null, createElement(Probe, props))));
  const transition = (element: Element, propertyName: string) => {
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: propertyName });
    element.dispatchEvent(event);
  };
  try {
    await render();
    const panel = container.firstElementChild;
    if (!(panel instanceof HTMLElement) || !panel.firstElementChild) throw new Error('Missing sheet');
    Object.defineProperty(panel, 'offsetHeight', { value: 400 });
    await act(() => collapse());
    expect(panel.style.transform).toBe('translateY(326px)');
    await act(() => {
      transition(panel.firstElementChild as Element, 'transform');
      transition(panel, 'opacity');
    });
    expect(setCollapsed).not.toHaveBeenCalled();
    await act(() => transition(panel, 'transform'));
    expect(setCollapsed).toHaveBeenCalledExactlyOnceWith(true);
    expect(vi.getTimerCount()).toBe(0);

    setCollapsed.mockClear();
    await act(() => collapse());
    await render({ enabled: false });
    expect(panel.style.transform).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.runAllTimers());
    expect(setCollapsed).not.toHaveBeenCalled();

    await render();
    await act(() => collapse());
    await render({ reducedMotion: true });
    expect(vi.getTimerCount()).toBe(0);
    await act(() => collapse());
    expect(setCollapsed).toHaveBeenCalledExactlyOnceWith(true);

    setCollapsed.mockClear();
    await render();
    await act(() => collapse());
    await act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.runAllTimers());
    expect(setCollapsed).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
  }
});

it('grows to another height at once and glides its top from where it was', async () => {
  const detents: string[] = [];
  let goTo: ReturnType<typeof useBottomSheet>['goTo'] = () => {};
  function Probe({ detent }: { detent: 'peek' | 'half' | 'full' }) {
    const ref = useRef<HTMLDivElement>(null);
    const sheet = useBottomSheet(ref, {
      enabled: true,
      reducedMotion: false,
      detent,
      onDetent: (next) => detents.push(next),
      peek: 'launcher',
    });
    goTo = sheet.goTo;
    return createElement('div', { ref }, createElement('span'));
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(() => root.render(createElement(Probe, { detent: 'half' })));
    const panel = container.firstElementChild as HTMLElement;
    let top = 400;
    panel.getBoundingClientRect = () => ({ top }) as DOMRect;
    await act(() => goTo('full'));
    expect(detents).toEqual(['full']);
    // The full sheet's top is higher; it starts where the half sheet's was and slides up into place.
    top = 60;
    const starts: string[] = [];
    const style = panel.style;
    const set = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'transform')?.set;
    Object.defineProperty(style, 'transform', {
      configurable: true,
      get: () => style.getPropertyValue('transform'),
      set: (value: string) => {
        starts.push(value);
        if (set) set.call(style, value);
        else style.setProperty('transform', value);
      },
    });
    await act(() => root.render(createElement(Probe, { detent: 'full' })));
    expect(starts).toContain('translateY(340px)');
    expect(style.transition).toContain('transform');
    await act(() => vi.runAllTimers());
    expect(style.transform).toBe('');
    expect(style.transition).toBe('');
    // Moving to the current height only settles the sheet.
    await act(() => goTo('full'));
    expect(detents).toEqual(['full']);
  } finally {
    await act(() => root.unmount());
  }
});
