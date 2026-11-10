// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useAppLinks } from './useAppLinks.ts';
import { createRouteState } from '../state/route.ts';
import { documentToLinkState } from '../agent/itinerary.ts';
import raw from '../data/generated/airports.json';
import zones from '../data/generated/timezones.json';
import { type PlanAction } from '../state/plan.ts';
vi.mock('../i18n/I18nProvider.tsx', () => ({
  useI18n: () => ({ locale: 'en', cityNames: null, t: (key: string) => key, setVisitLocale: vi.fn() }),
}));
vi.mock('../analytics.ts', () => ({ replaceUrl: vi.fn() }));
it('loads exact document tracks into plan journeys and never reassigns a path across an unknown endpoint', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(url.includes('timezones') ? zones : raw) }),
    ),
  );
  const planDispatch = vi.fn<(action: PlanAction) => void>();
  const options = {
    route: createRouteState(),
    planDispatch,
    setEditing: vi.fn(),
    resetPreferences: vi.fn(),
    applyView: vi.fn(),
    showToast: vi.fn(),
  };
  let links: ReturnType<typeof useAppLinks> | undefined;
  function Probe() {
    links = useAppLinks(options);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(createElement(Probe)));
    await vi.waitFor(() => expect(links!.index).not.toBeNull());
    const state = documentToLinkState({
      version: 1,
      stops: [
        {
          airport: 'CPH',
          track: {
            points: [
              [0, 0],
              [0, 1],
            ],
          },
        },
        { airport: 'LHR' },
      ],
    });
    await act(() => links!.applyLink(state, links!.index!, '?route=CPH-LHR'));
    const load = planDispatch.mock.calls.at(-1)![0];
    expect(load.type).toBe('load');
    if (load.type === 'load') expect(load.journeys[0].tracks?.[0]).toBe(state.stops?.[0].track);
    const skipped = { ...state, stops: [state.stops![0], { ...state.stops![1], code: 'ZZZZZZ' }, state.stops![1]] };
    await act(() => links!.applyLink(skipped, links!.index!, '?route=CPH-ZZZZZZ-LHR'));
    const next = planDispatch.mock.calls.at(-1)![0];
    if (next.type === 'load') expect(next.journeys[0].tracks?.[0]).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});
