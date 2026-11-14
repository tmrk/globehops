// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSavedTrips, type RemovedTrip } from './useSavedTrips.ts';
import {
  loadSavedTrips,
  MAX_SAVED_TRIPS,
  SAVED_TRIPS_KEY,
  storeSavedTrips,
  type SavedTrip,
} from '../state/savedTrips.ts';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function seed(id: string, query: string): SavedTrip {
  return { id, query, savedAt: 1, updatedAt: 1 };
}
async function mount(initial = { journeyQuery: '?route=CPH-LHR', generation: 1, ready: true }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let options = initial;
  let result: ReturnType<typeof useSavedTrips> | undefined;
  function Probe() {
    result = useSavedTrips(options);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const render = async (changes: Partial<typeof initial> = {}) => {
    options = { ...options, ...changes };
    await act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
  };
  await render();
  return {
    get value() {
      return result!;
    },
    render,
    unmount: () => act(() => root.unmount()),
  };
}

it('waits for ready, attaches the remembered plan, and saves edits without view changes', async () => {
  storeSavedTrips([seed('a', '?route=CPH-LHR')]);
  const hook = await mount({ journeyQuery: '?route=CPH-LHR', generation: 1, ready: false });
  try {
    expect(hook.value.currentId).toBeNull();
    await act(() => expect(hook.value.save()).toBe('failed'));
    await hook.render({ ready: true });
    expect(hook.value.currentId).toBe('a');
    const summary = hook.value.trips[0].summary;
    await hook.render({ journeyQuery: '?route=CPH-LHR&play=1' });
    expect(hook.value.trips[0].summary).toBe(summary);
    await hook.render({ journeyQuery: '?route=CPH-JFK' });
    expect(loadSavedTrips()[0].query).toBe('?route=CPH-JFK');
    expect(hook.value.currentId).toBe('a');
    await hook.render({ journeyQuery: '' });
    expect(loadSavedTrips()[0].query).toBe('?route=CPH-JFK');
  } finally {
    await hook.unmount();
  }
});

it('detaches on replacement without overwriting the old entry and finds identical loaded plans', async () => {
  storeSavedTrips([seed('a', '?route=CPH-LHR'), seed('b', '?route=JFK-LAX')]);
  const hook = await mount();
  try {
    const bSummary = hook.value.trips[1].summary;
    await hook.render({ generation: 2, journeyQuery: '?route=BUD-NRT' });
    expect(hook.value.currentId).toBeNull();
    expect(loadSavedTrips().find((trip) => trip.id === 'a')!.query).toBe('?route=CPH-LHR');
    await hook.render({ generation: 3, journeyQuery: '?route=JFK-LAX' });
    expect(hook.value.currentId).toBe('b');
    expect(hook.value.trips.find((trip) => trip.id === 'b')!.summary).toBe(bSummary);
    await act(() => hook.value.markOpening('a'));
    await hook.render({ generation: 4, journeyQuery: '?route=CPH-LHR' });
    expect(hook.value.currentId).toBe('a');
    await hook.render({ generation: 5, journeyQuery: '?route=BUD-NRT' });
    expect(hook.value.currentId).toBeNull();
  } finally {
    await hook.unmount();
  }
});

it('saves, removes and restores the current entry, and leaves other summaries memoized', async () => {
  const hook = await mount();
  try {
    await act(() => expect(hook.value.save()).toBe('saved'));
    const id = hook.value.currentId!;
    await act(() => expect(hook.value.save()).toBe('saved'));
    expect(hook.value.trips).toHaveLength(1);
    let removed: RemovedTrip | null = null;
    await act(() => {
      removed = hook.value.remove(id);
    });
    expect(hook.value.currentId).toBeNull();
    expect(hook.value.trips).toHaveLength(0);
    await act(() => hook.value.restore(removed!));
    expect(hook.value.currentId).toBe(id);
    await act(() => {
      removed = hook.value.remove(id);
    });
    await hook.render({ generation: 2, journeyQuery: '?route=BUD-NRT' });
    await act(() => hook.value.restore(removed!));
    expect(hook.value.currentId).toBeNull();
    await hook.render({ generation: 3, journeyQuery: '?route=CPH-LHR' });
    await act(() => hook.value.unsave());
    expect(hook.value.trips).toHaveLength(0);
    expect(hook.value.currentId).toBeNull();
  } finally {
    await hook.unmount();
  }
});

it('stores a normalized opened query immediately so a reload attaches to the same trip', async () => {
  const normalized = '?dep1=2026-11-20T08:15&route=CPH-LHR';
  storeSavedTrips([seed('a', '?route=EKCH-EGLL&dep1=2026-11-20T08:15')]);
  const hook = await mount({ journeyQuery: '?route=JFK-LAX', generation: 1, ready: true });
  try {
    await act(() => hook.value.markOpening('a'));
    await hook.render({ generation: 2, journeyQuery: normalized });
    expect(hook.value.currentId).toBe('a');
    expect(hook.value.trips[0].query).toBe(normalized);
    expect(hook.value.trips[0].summary.alternatives).toEqual([[['CPH', 'LHR']]]);
    expect(loadSavedTrips()[0].query).toBe(normalized);
  } finally {
    await hook.unmount();
  }
  const reloaded = await mount({ journeyQuery: normalized, generation: 1, ready: true });
  try {
    expect(reloaded.value.currentId).toBe('a');
  } finally {
    await reloaded.unmount();
  }
});

it('does not replace an opened trip with an empty query or an unsuccessful normalization write', async () => {
  storeSavedTrips([seed('a', '?route=EKCH-EGLL')]);
  const hook = await mount();
  try {
    await act(() => hook.value.markOpening('a'));
    await hook.render({ generation: 2, journeyQuery: '' });
    expect(loadSavedTrips()[0].query).toBe('?route=EKCH-EGLL');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await act(() => hook.value.markOpening('a'));
    await hook.render({ generation: 3, journeyQuery: '?route=CPH-LHR' });
    expect(hook.value.currentId).toBe('a');
    expect(hook.value.trips[0].query).toBe('?route=EKCH-EGLL');
    expect(loadSavedTrips()[0].query).toBe('?route=EKCH-EGLL');
  } finally {
    await hook.unmount();
  }
});

it('reloads cross-tab changes and keeps the attachment only while its id exists', async () => {
  storeSavedTrips([seed('a', '?route=CPH-LHR')]);
  const hook = await mount();
  const notify = () => act(() => window.dispatchEvent(new StorageEvent('storage', { key: SAVED_TRIPS_KEY })));
  try {
    storeSavedTrips([seed('a', '?route=BUD-NRT'), seed('b', '?route=JFK-LAX')]);
    await notify();
    expect(hook.value.currentId).toBe('a');
    expect(hook.value.trips[0].query).toBe('?route=BUD-NRT');
    expect(loadSavedTrips()[0].query).toBe('?route=BUD-NRT');
    storeSavedTrips([seed('b', '?route=JFK-LAX')]);
    await notify();
    expect(hook.value.currentId).toBeNull();
    expect(hook.value.trips).toHaveLength(1);
    localStorage.clear();
    await act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(hook.value.trips).toHaveLength(0);
  } finally {
    await hook.unmount();
  }
});

it('reports full and failed storage, without pretending an unsuccessful write saved content', async () => {
  storeSavedTrips(Array.from({ length: MAX_SAVED_TRIPS }, (_, i) => seed(String(i), `?route=CPH-LHR&label=${i}`)));
  const hook = await mount();
  try {
    await act(() => expect(hook.value.save()).toBe('full'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await hook.render({ journeyQuery: '?route=CPH-LHR&label=0', generation: 2 });
    expect(hook.value.currentId).toBe('0');
    await hook.render({ journeyQuery: '?route=BUD-NRT' });
    expect(hook.value.trips.find((trip) => trip.id === '0')!.query).toContain('CPH-LHR');
    await act(() => expect(hook.value.remove('0')).toBeNull());
    setItem.mockRestore();
    await act(() => hook.value.remove('1'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await act(() => expect(hook.value.save()).toBe('failed'));
    expect(hook.value.trips).toHaveLength(MAX_SAVED_TRIPS - 1);
  } finally {
    await hook.unmount();
  }
});
