import { describe, expect, it } from 'vitest';
import { compareReducer, createCompareState } from './compare.ts';
import { routeReducer } from './route.ts';

describe('comparison editor', () => {
  it('starts with one empty journey and delegates route actions to the active journey', () => {
    const state = createCompareState();
    expect(state.active).toBe(0);
    expect(state.journeys[0].route.stops.map((stop) => stop.airportId)).toEqual([null, null]);
    const action = { type: 'setAirport', index: 0, airportId: 12 } as const;
    const expected = routeReducer(state.journeys[0].route, action);
    const next = compareReducer(state, { type: 'route', action });
    expect(next.journeys[0].route).toEqual(expected);
    expect(next.journeys[0].key).toBe(state.journeys[0].key);
    expect(compareReducer(next, { type: 'route', action })).toBe(next);
  });
  it('adds an empty journey, activates it, and stops at four', () => {
    let state = compareReducer(createCompareState(), {
      type: 'load',
      journeys: [
        {
          airportIds: [1, null, 2, 3],
          label: ' A ',
          layovers: [null, null, 180],
          departures: [{ local: '2026-11-20T08:00', offsetMin: null }],
        },
      ],
    });
    state = compareReducer(state, { type: 'add' });
    expect(state.active).toBe(1);
    expect(state.journeys[1].route.stops.map((stop) => stop.airportId)).toEqual([null, null]);
    expect(
      state.journeys[1].route.stops.every(
        (stop) => stop.arrival === null && stop.departure === null && stop.layoverMin === null,
      ),
    ).toBe(true);
    expect(state.journeys[1].label).toBeNull();
    expect(new Set(state.journeys.map((journey) => journey.key)).size).toBe(2);
    state = compareReducer(compareReducer(state, { type: 'add' }), { type: 'add' });
    expect(compareReducer(state, { type: 'add' })).toBe(state);
    expect(
      compareReducer(createCompareState(), { type: 'add' }).journeys[1].route.stops.map((stop) => stop.airportId),
    ).toEqual([null, null]);
  });
  it('preserves active identity when removing before/after it and selects the previous journey when removed', () => {
    const loaded = compareReducer(createCompareState(), {
      type: 'load',
      journeys: [1, 2, 3, 4].map((id) => ({ airportIds: [id, 10] })),
    });
    const state = compareReducer(loaded, { type: 'activate', index: 2 });
    const before = compareReducer(state, { type: 'remove', index: 0 });
    expect(before.active).toBe(1);
    expect(before.journeys[before.active]).toBe(state.journeys[2]);
    expect(compareReducer(state, { type: 'remove', index: 3 }).active).toBe(2);
    expect(compareReducer(state, { type: 'remove', index: 2 }).active).toBe(1);
    const single = createCompareState();
    expect(compareReducer(single, { type: 'remove', index: 0 })).toBe(single);
  });
  it('normalizes labels and retains identity for no-ops and invalid indices', () => {
    const state = createCompareState();
    const named = compareReducer(state, { type: 'setLabel', index: 0, label: '  Direct  ' });
    expect(named.journeys[0].label).toBe('Direct');
    expect(compareReducer(named, { type: 'setLabel', index: 0, label: ' Direct ' })).toBe(named);
    expect(compareReducer(named, { type: 'setLabel', index: 0, label: 'x'.repeat(50) }).journeys[0].label).toHaveLength(
      40,
    );
    expect(compareReducer(state, { type: 'setLabel', index: 0, label: ' ' })).toBe(state);
    expect(compareReducer(state, { type: 'activate', index: 0 })).toBe(state);
    for (const index of [-1, 9, 0.5, NaN]) {
      expect(compareReducer(state, { type: 'activate', index })).toBe(state);
      expect(compareReducer(state, { type: 'remove', index })).toBe(state);
      expect(compareReducer(state, { type: 'setLabel', index, label: 'a' })).toBe(state);
      expect(compareReducer(state, { type: 'route', index, action: { type: 'reverse' } })).toBe(state);
    }
  });
  it('loads up to four journeys, normalizes an empty load and allows indexed edits', () => {
    const state = compareReducer(createCompareState(), {
      type: 'load',
      journeys: [1, 2, 3, 4, 5].map((id) => ({ airportIds: [id, 10] })),
    });
    expect(state.journeys).toHaveLength(4);
    const next = compareReducer(state, {
      type: 'route',
      index: 2,
      action: { type: 'setAirport', index: 0, airportId: 30 },
    });
    expect(next.active).toBe(0);
    expect(next.journeys[0]).toBe(state.journeys[0]);
    expect(next.journeys[2].route.stops[0].airportId).toBe(30);
    expect(compareReducer(state, { type: 'load', journeys: [] }).journeys).toHaveLength(1);
    const empty = createCompareState();
    expect(compareReducer(empty, { type: 'load', journeys: [] })).toBe(empty);
  });
});
