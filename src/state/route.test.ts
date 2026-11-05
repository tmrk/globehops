import { describe, it, expect } from 'vitest';
import raw from '../data/generated/airports.json';
import { decodeDataset } from '../data/airports.ts';
import { computeLegs, createRouteState, filledAirportIds, MAX_STOPS, routeReducer as reduce } from './route.ts';
import type { RouteAction } from './route.ts';
const data = decodeDataset(raw);
describe('route reducer', () => {
  it('creates padded routes with unique stable keys and a maximum length', () => {
    const a = createRouteState([1]),
      b = createRouteState();
    expect(a.stops.map((s) => s.airportId)).toEqual([1, null]);
    expect(new Set([...a.stops, ...b.stops].map((s) => s.key)).size).toBe(4);
    expect(createRouteState(Array(20).fill(1)).stops).toHaveLength(MAX_STOPS);
    const set = reduce(a, { type: 'setAirport', index: 0, airportId: 2 });
    expect(set.stops[0].key).toBe(a.stops[0].key);
    expect(a.stops[0].airportId).toBe(1);
  });
  it('adds, inserts, removes, moves, reverses, clears and loads', () => {
    let s = createRouteState([1, 2]);
    s = reduce(s, { type: 'addStop' });
    expect(s.stops.map((s) => s.airportId)).toEqual([1, 2, null]);
    s = reduce(s, { type: 'insertStop', index: 1 });
    expect(s.stops.map((s) => s.airportId)).toEqual([1, null, 2, null]);
    s = reduce(s, { type: 'removeStop', index: 3 });
    s = reduce(s, { type: 'moveStop', from: 0, to: 2 });
    expect(s.stops.map((s) => s.airportId)).toEqual([null, 2, 1]);
    s = reduce(s, { type: 'reverse' });
    expect(filledAirportIds(s.stops)).toEqual([1, 2]);
    s = reduce(s, { type: 'load', airportIds: [3] });
    expect(s.stops.map((s) => s.airportId)).toEqual([3, null]);
    s = reduce(s, { type: 'removeStop', index: 0 });
    expect(s.stops.map((s) => s.airportId)).toEqual([null, null]);
    expect(reduce(createRouteState([1, 2, 3]), { type: 'clear' }).stops.map((s) => s.airportId)).toEqual([null, null]);
  });
  it('resets leg selection on each structural edit', () => {
    const actions: RouteAction[] = [
      { type: 'setAirport', index: 0, airportId: 4 },
      { type: 'addStop' },
      { type: 'insertStop', index: 0 },
      { type: 'removeStop', index: 1 },
      { type: 'moveStop', from: 0, to: 2 },
      { type: 'reverse' },
      { type: 'clear' },
      { type: 'load', airportIds: [4, 5] },
    ];
    for (const action of actions) {
      const s = reduce(createRouteState([1, 2, 3]), { type: 'selectLeg', leg: 99 });
      expect(s.selectedLeg).toBe(99);
      expect(reduce(s, action).selectedLeg, action.type).toBeNull();
    }
    expect(reduce(createRouteState(), { type: 'selectLeg', leg: -1 }).selectedLeg).toBeNull();
  });
  it('preserves state identity on no-ops and invalid indices', () => {
    const s = createRouteState([1, null]);
    for (const action of [
      { type: 'setAirport', index: 0, airportId: 1 },
      { type: 'setAirport', index: -1, airportId: 2 },
      { type: 'removeStop', index: 1 },
      { type: 'removeStop', index: 5 },
      { type: 'insertStop', index: 4 },
      { type: 'moveStop', from: 0, to: 0 },
      { type: 'moveStop', from: 0, to: 2 },
      { type: 'moveStop', from: -1, to: 0 },
      { type: 'selectLeg', leg: null },
      { type: 'load', airportIds: [1] },
    ] as RouteAction[])
      expect(reduce(s, action)).toBe(s);
    const full = createRouteState(Array(10).fill(1));
    expect(reduce(full, { type: 'addStop' })).toBe(full);
    expect(reduce(full, { type: 'insertStop', index: 0 })).toBe(full);
    const empty = createRouteState();
    expect(reduce(empty, { type: 'clear' })).toBe(empty);
  });
  it('connects consecutive filled stops across gaps, retaining zero-distance legs', () => {
    const cph = data.airports.find((a) => a.iata === 'CPH')!,
      lhr = data.airports.find((a) => a.iata === 'LHR')!;
    const state = createRouteState([cph.id, null, lhr.id, lhr.id]);
    const legs = computeLegs(state.stops, (id) => data.byId.get(id));
    expect(legs).toHaveLength(2);
    expect(legs[0].fromStop).toBe(0);
    expect(legs[0].toStop).toBe(2);
    expect(legs[0].distanceKm).toBeGreaterThan(950);
    expect(legs[0].durationMin).toBe(100);
    expect(legs[1].index).toBe(1);
    expect(legs[1].distanceKm).toBe(0);
    expect(legs[1].durationMin).toBeNull();
    expect(computeLegs(createRouteState([999999999]).stops, (id) => data.byId.get(id))).toEqual([]);
  });
});
