// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery.ts';

it('reuses its media query between renders and cleans subscriptions when the query changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) => listeners.delete(listener)),
  };
  const matchMedia = vi.fn(() => media);
  vi.stubGlobal('matchMedia', matchMedia);
  function Probe({ query }: { query: string }) {
    return String(useMediaQuery(query));
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (query: string) =>
    act(() => root.render(createElement(StrictMode, null, createElement(Probe, { query }))));
  try {
    await render('(min-width: 760px)');
    expect(container.textContent).toBe('false');
    expect(listeners.size).toBe(1);
    matchMedia.mockClear();
    media.addEventListener.mockClear();
    await render('(min-width: 760px)');
    expect(matchMedia).not.toHaveBeenCalled();
    expect(media.addEventListener).not.toHaveBeenCalled();
    await act(() => {
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(container.textContent).toBe('true');
    await render('(pointer: coarse)');
    expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)');
    expect(listeners.size).toBe(1);
    await act(() => root.unmount());
    expect(listeners.size).toBe(0);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
