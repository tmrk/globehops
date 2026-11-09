// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { decodeAirspace } from '../data/airspace.ts';
import { decodeDiversionAirports } from '../data/diversion.ts';
import rawAirspace from '../data/generated/airspace.json';
import rawDiversion from '../data/generated/diversion-airports.json';
import type { Routing } from './useRouting.ts';
const mocks = vi.hoisted(() => ({ airspace: vi.fn(), diversion: vi.fn() }));
vi.mock('../data/airspace.ts', async (original) => ({
  ...(await original<typeof import('../data/airspace.ts')>()),
  loadAirspace: mocks.airspace,
}));
vi.mock('../data/diversion.ts', async (original) => ({
  ...(await original<typeof import('../data/diversion.ts')>()),
  loadDiversionAirports: mocks.diversion,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('loads only enabled data, shares one promise across StrictMode/toggles, and settles a failed feature', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.airspace.mockResolvedValue(decodeAirspace(rawAirspace));
  mocks.diversion.mockRejectedValue(new Error('offline'));
  const { useRouting } = await import('./useRouting.ts');
  let state: Routing | undefined;
  function Probe({ airspace, diversion }: { airspace: boolean; diversion: boolean }) {
    state = useRouting(airspace, diversion);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const render = async (airspace: boolean, diversion: boolean) => {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { airspace, diversion }))));
  };
  try {
    await render(false, false);
    expect(state!.router).not.toBeNull();
    expect(mocks.airspace).not.toHaveBeenCalled();
    expect(mocks.diversion).not.toHaveBeenCalled();
    await render(true, false);
    await vi.waitFor(() => expect(state!.router?.airspace?.reviewed).toBe(rawAirspace.reviewed));
    expect(state!.airspaceReviewed).toBe(rawAirspace.reviewed);
    expect(mocks.diversion).not.toHaveBeenCalled();
    await render(true, true);
    await vi.waitFor(() => expect(state!.failed.diversion).toBe(true));
    expect(state!.router!.airspace).not.toBeNull();
    expect(state!.router!.diversion).toBeNull();
    await render(false, false);
    expect(state!.failed).toEqual({ airspace: false, diversion: false });
    await render(true, true);
    expect(state!.failed).toEqual({ airspace: false, diversion: true });
    expect(mocks.airspace).toHaveBeenCalledTimes(1);
    expect(mocks.diversion).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
  }
});
it('waits for both enabled features and keeps successful diversion data if airspace fails', async () => {
  vi.resetModules();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resolveDiversion: ((data: ReturnType<typeof decodeDiversionAirports>) => void) | undefined;
  mocks.airspace.mockRejectedValue(new Error('offline'));
  mocks.diversion.mockReturnValue(
    new Promise((resolve) => {
      resolveDiversion = resolve;
    }),
  );
  const { useRouting } = await import('./useRouting.ts');
  let state: Routing | undefined;
  function Probe() {
    state = useRouting(true, true);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(createElement(Probe)));
    await vi.waitFor(() => expect(mocks.diversion).toHaveBeenCalledTimes(1));
    expect(state!.router).toBeNull();
    await act(async () => resolveDiversion!(decodeDiversionAirports(rawDiversion)));
    expect(state!.router!.diversion!.airports.length).toBeGreaterThan(1000);
    expect(state!.router!.airspace).toBeNull();
    expect(state!.failed).toEqual({ airspace: true, diversion: false });
  } finally {
    await act(() => root.unmount());
  }
});
