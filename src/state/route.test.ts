import { describe, it, expect } from 'vitest';
import raw from '../data/generated/airports.json';
import { decodeDataset } from '../data/airports.ts';
import {
  computeLayovers,
  computeLegs,
  createRouteState,
  filledAirportIds,
  hasEnteredTimes,
  MAX_STOPS,
  routeReducer as reduce,
} from './route.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';
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
  });
  it('resets leg selection on each structural edit', () => {
    const actions: RouteAction[] = [
      { type: 'setAirport', index: 0, airportId: 4 },
      { type: 'addStop' },
      { type: 'insertStop', index: 0 },
      { type: 'removeStop', index: 1 },
      { type: 'moveStop', from: 0, to: 2 },
      { type: 'reverse' },
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
  it('stores custom layovers per stop, keeps them with their stop and keeps the selection', () => {
    let s = reduce(createRouteState([1, 2, 3]), { type: 'selectLeg', leg: 1 });
    s = reduce(s, { type: 'setLayover', index: 1, minutes: 180 });
    expect(s.stops.map((x) => x.layoverMin)).toEqual([null, 180, null]);
    expect(s.selectedLeg).toBe(1);
    expect(reduce(s, { type: 'setLayover', index: 1, minutes: 180 })).toBe(s);
    for (const invalid of [-5, 1.5, 99999])
      expect(reduce(s, { type: 'setLayover', index: 1, minutes: invalid }).stops[1].layoverMin).toBeNull();
    expect(reduce(s, { type: 'setLayover', index: 1, minutes: DEFAULT_LAYOVER_MIN }).stops[1].layoverMin).toBeNull();
    expect(reduce(s, { type: 'setLayover', index: 7, minutes: 60 })).toBe(s);
    const reversed = reduce(reduce(s, { type: 'addStop' }), { type: 'reverse' });
    expect(reversed.stops.map((x) => [x.airportId, x.layoverMin])).toEqual([
      [null, null],
      [3, null],
      [2, 180],
      [1, null],
    ]);
    const loaded = reduce(s, { type: 'load', airportIds: [4, 5, 6], layovers: [null, 45, DEFAULT_LAYOVER_MIN] });
    expect(loaded.stops.map((x) => x.layoverMin)).toEqual([null, 45, null]);
    expect(reduce(loaded, { type: 'load', airportIds: [4, 5, 6], layovers: [null, 45] })).toBe(loaded);
    expect(reduce(loaded, { type: 'load', airportIds: [4, 5, 6] }).stops[1].layoverMin).toBeNull();
  });
  it('derives layovers at transfers only, skipping empty stops', () => {
    const [cph, lhr, jfk] = ['CPH', 'LHR', 'JFK'].map((c) => data.airports.find((a) => a.iata === c)!);
    let state = createRouteState([cph.id, lhr.id, null, jfk.id], [null, 150, 60, null]);
    const lookup = (id: number) => data.byId.get(id);
    expect(computeLayovers(state.stops, computeLegs(state.stops, lookup))).toEqual([
      { stopIndex: 1, airport: lhr, minutes: 150, custom: true },
    ]);
    state = reduce(state, { type: 'setLayover', index: 1, minutes: null });
    expect(computeLayovers(state.stops, computeLegs(state.stops, lookup))[0]).toMatchObject({
      minutes: DEFAULT_LAYOVER_MIN,
      custom: false,
    });
    expect(computeLayovers(state.stops, [])).toEqual([]);
  });
});

describe('stop-based journey times', () => {
  const departure = { local: '2026-11-20T08:15', offsetMin: 60 };
  const arrival = { local: '2026-11-20T13:50', offsetMin: -300 };
  it('initializes every time to null and preserves selection while editing or clearing times', () => {
    let s = reduce(createRouteState([1, 2]), { type: 'selectLeg', leg: 0 });
    expect(s.stops.every((stop) => stop.arrival === null && stop.departure === null)).toBe(true);
    s = reduce(s, { type: 'setTime', index: 0, field: 'departure', value: departure });
    expect(s.selectedLeg).toBe(0);
    expect(s.stops[0].departure).toEqual(departure);
    expect(reduce(s, { type: 'setTime', index: 0, field: 'departure', value: { ...departure } })).toBe(s);
    expect(reduce(s, { type: 'setTime', index: -1, field: 'arrival', value: arrival })).toBe(s);
    expect(reduce(s, { type: 'setTime', index: 5, field: 'arrival', value: arrival })).toBe(s);
    const cleared = reduce(s, { type: 'clearTimes' });
    expect(cleared.selectedLeg).toBe(0);
    expect(cleared.stops[0].departure).toBeNull();
    expect(reduce(cleared, { type: 'clearTimes' })).toBe(cleared);
    expect(s.stops[0].departure).toEqual(departure);
  });
  it('keeps facts attached to their stop when inserting, moving and removing', () => {
    let s = createRouteState([1, 2], [], [null, arrival], [departure]);
    s = reduce(s, { type: 'insertStop', index: 1 });
    expect(s.stops[0].departure).toEqual(departure);
    expect(s.stops[2].arrival).toEqual(arrival);
    expect(s.stops[1].arrival).toBeNull();
    s = reduce(s, { type: 'moveStop', from: 2, to: 1 });
    expect(s.stops[1].arrival).toEqual(arrival);
    s = reduce(s, { type: 'removeStop', index: 2 });
    expect(s.stops[1].arrival).toEqual(arrival);
  });
  it('includes wall time and chosen offset in load equality and clears times when omitted', () => {
    const action: RouteAction = {
      type: 'load',
      airportIds: [1, 2],
      arrivals: [null, arrival],
      departures: [departure],
    };
    const s = reduce(createRouteState(), action);
    expect(reduce(s, action)).toBe(s);
    expect(reduce(s, { ...action, departures: [{ ...departure, offsetMin: 120 }] })).not.toBe(s);
    expect(reduce(s, { ...action, arrivals: [null, { ...arrival, local: '2026-11-21T13:50' }] })).not.toBe(s);
    expect(reduce(s, { type: 'load', airportIds: [1, 2] }).stops.every((s) => !s.arrival && !s.departure)).toBe(true);
  });
  it('clears times on reverse, preserving airport/layover behavior', () => {
    const s = createRouteState([1, 2, 3], [null, 180], [null, null, arrival], [departure]);
    const reversed = reduce(s, { type: 'reverse' });
    expect(reversed.stops.map((s) => s.airportId)).toEqual([3, 2, 1]);
    expect(reversed.stops[1].layoverMin).toBe(180);
    expect(reversed.stops.every((s) => !s.arrival && !s.departure)).toBe(true);
  });
});

it('detects entered times including date-only inputs on empty stops', () => {
  expect(hasEnteredTimes(createRouteState().stops)).toBe(false);
  const state = reduce(createRouteState(), {
    type: 'setTime',
    index: 0,
    field: 'departure',
    value: { local: '2026-11-20', offsetMin: null },
  });
  expect(hasEnteredTimes(state.stops)).toBe(true);
});
