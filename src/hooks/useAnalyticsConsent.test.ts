// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { disableAnalytics, enableAnalytics } from '../analytics.ts';
import { useAnalyticsConsent, type AnalyticsConsentState } from './useAnalyticsConsent.ts';

vi.mock('../analytics.ts', () => ({
  analyticsAvailableHere: () => true,
  disableAnalytics: vi.fn(),
  enableAnalytics: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  localStorage.setItem('globehops:analytics', 'granted');
});
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['idle', 'timeout', 'missing cancel'] as const)(
  'cancels deferred measurement on denial and unmount with %s scheduling',
  async (scheduling) => {
    const requestIdle = vi.fn(function (this: Window, run: IdleRequestCallback) {
      expect(this).toBe(window);
      return window.setTimeout(() => run({ didTimeout: false, timeRemaining: () => 50 }), 2000);
    });
    vi.stubGlobal('requestIdleCallback', scheduling === 'timeout' ? undefined : requestIdle);
    vi.stubGlobal('cancelIdleCallback', scheduling === 'idle' ? (id: number) => window.clearTimeout(id) : undefined);
    let state: AnalyticsConsentState | null = null;
    function Probe() {
      state = useAnalyticsConsent();
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
      expect(vi.getTimerCount()).toBe(1);
      if (scheduling !== 'idle') expect(requestIdle).not.toHaveBeenCalled();
      await act(() => state?.choose('denied'));
      expect(disableAnalytics).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      await act(() => vi.runAllTimers());
      expect(enableAnalytics).not.toHaveBeenCalled();
      await act(() => state?.choose('granted'));
      await act(() => vi.runAllTimers());
      expect(enableAnalytics).toHaveBeenCalledOnce();
      await act(() => state?.choose('denied'));
      await act(() => state?.choose('granted'));
      expect(vi.getTimerCount()).toBe(1);
      await act(() => root.unmount());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await act(() => root.unmount());
    }
  },
);
