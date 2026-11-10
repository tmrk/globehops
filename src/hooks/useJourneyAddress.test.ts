// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useJourneyAddress, useJourneyAddressWithReduction } from './useJourneyAddress.ts';
import { useJourneyModel } from './useJourneyModel.ts';
import { useViewPreferences } from './useViewPreferences.ts';
import { createPlanState, planReducer } from '../state/plan.ts';
import { decodeDataset } from '../data/airports.ts';
import raw from '../data/generated/airports.json';
import type { CustomTrack } from '../lib/track.ts';
vi.mock('../i18n/I18nProvider.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../analytics.ts', () => ({ replaceUrl: vi.fn() }));
it('keeps the string hook compatible and exposes reduction from the companion hook', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  const dataset = decodeDataset(raw);
  const track: CustomTrack = {
    kind: 'planned',
    source: { format: 'document', name: null },
    points: Array.from({ length: 20000 }, (_, i) => ({
      lat: 50 + Math.sin(i / 20),
      lng: -80 + i / 1000,
      altM: 11000,
      time: null,
    })),
  };
  const plan = planReducer(createPlanState(), {
    type: 'load',
    journeys: [{ airportIds: dataset.airports.slice(0, 2).map((a) => a.id), tracks: [track] }],
  });
  let url = '',
    result: ReturnType<typeof useJourneyAddressWithReduction> | undefined;
  const updatePickerAddress = vi.fn();
  function Probe() {
    const model = useJourneyModel(plan, { dataset, zones: null, lookup: (id) => dataset.byId.get(id) }, false, null);
    const preferences = useViewPreferences();
    const options = {
      model,
      preferences,
      plan,
      timeOpen: false,
      playing: false,
      live: false,
      pausedTime: null,
      speed: 'auto' as const,
      initialized: true,
      updatePickerAddress,
    };
    result = useJourneyAddressWithReduction(options);
    url = useJourneyAddress(options);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(() => root.render(createElement(Probe)));
    expect(url).toBe(result!.shareUrl);
    expect(url.length).toBeLessThanOrEqual(8000);
    expect(result!.shareReduction?.total).toBe(20000);
    expect(result!.shareReduction!.kept).toBeLessThan(20000);
    expect(updatePickerAddress).toHaveBeenCalled();
    expect(track.points).toHaveLength(20000);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});
