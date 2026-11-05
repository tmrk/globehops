import type { Airport, Layover, Leg, RouteState, Stop } from '../types.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';
import { estimateFlightMinutes } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN, isValidLayover } from '../lib/layover.ts';
export const MAX_STOPS = 10;
export type RouteAction =
  | { type: 'setAirport'; index: number; airportId: number | null }
  | { type: 'addStop' }
  | { type: 'insertStop'; index: number }
  | { type: 'removeStop'; index: number }
  | { type: 'moveStop'; from: number; to: number }
  | { type: 'reverse' }
  | { type: 'clear' }
  | { type: 'selectLeg'; leg: number | null }
  | { type: 'setLayover'; index: number; minutes: number | null }
  | { type: 'load'; airportIds: (number | null)[]; layovers?: (number | null)[] };
let nextKey = 0;
/** Stored layovers are null when they equal the default, so only real changes reach the URL. */
const normalizeLayover = (minutes: number | null | undefined): number | null =>
  isValidLayover(minutes) && minutes !== DEFAULT_LAYOVER_MIN ? minutes : null;
const stop = (airportId: number | null, layoverMin: number | null = null): Stop => ({
  key: `s${++nextKey}`,
  airportId,
  layoverMin: normalizeLayover(layoverMin),
});
export function createRouteState(airportIds: (number | null)[] = [], layovers: (number | null)[] = []): RouteState {
  const ids = airportIds.slice(0, MAX_STOPS);
  while (ids.length < 2) ids.push(null);
  return { stops: ids.map((id, i) => stop(id, layovers[i])), selectedLeg: null };
}
const validIndex = (index: number, length: number) => Number.isInteger(index) && index >= 0 && index < length;
export function routeReducer(state: RouteState, action: RouteAction): RouteState {
  const stops = state.stops;
  const changed = (next: Stop[]): RouteState => ({ stops: next, selectedLeg: null });
  switch (action.type) {
    case 'selectLeg': {
      const leg = action.leg !== null && action.leg < 0 ? null : action.leg;
      return leg === state.selectedLeg ? state : { ...state, selectedLeg: leg };
    }
    case 'setLayover': {
      const minutes = normalizeLayover(action.minutes);
      if (!validIndex(action.index, stops.length) || stops[action.index].layoverMin === minutes) return state;
      // Ground time doesn't change the geometry, so the selected flight stays selected.
      return { ...state, stops: stops.map((s, i) => (i === action.index ? { ...s, layoverMin: minutes } : s)) };
    }
    case 'setAirport':
      if (!validIndex(action.index, stops.length) || stops[action.index].airportId === action.airportId) return state;
      return changed(stops.map((s, i) => (i === action.index ? { ...s, airportId: action.airportId } : s)));
    case 'addStop':
      return stops.length >= MAX_STOPS ? state : changed([...stops, stop(null)]);
    case 'insertStop':
      if (stops.length >= MAX_STOPS || !validIndex(action.index, stops.length + 1)) return state;
      return changed([...stops.slice(0, action.index), stop(null), ...stops.slice(action.index)]);
    case 'removeStop':
      if (!validIndex(action.index, stops.length)) return state;
      if (stops.length <= 2) return routeReducer(state, { type: 'setAirport', index: action.index, airportId: null });
      return changed(stops.filter((_, i) => i !== action.index));
    case 'moveStop': {
      if (!validIndex(action.from, stops.length) || !validIndex(action.to, stops.length) || action.from === action.to)
        return state;
      const next = [...stops];
      const [moved] = next.splice(action.from, 1);
      next.splice(action.to, 0, moved);
      return changed(next);
    }
    case 'reverse':
      return changed([...stops].reverse());
    case 'clear':
      return stops.length === 2 && stops.every((s) => s.airportId === null) && state.selectedLeg === null
        ? state
        : createRouteState();
    case 'load': {
      const ids = action.airportIds.slice(0, MAX_STOPS);
      while (ids.length < 2) ids.push(null);
      const layovers = ids.map((_, i) => normalizeLayover(action.layovers?.[i]));
      return ids.length === stops.length &&
        ids.every((id, i) => id === stops[i].airportId && layovers[i] === stops[i].layoverMin) &&
        state.selectedLeg === null
        ? state
        : createRouteState(ids, layovers);
    }
  }
}
export function filledAirportIds(stops: Stop[]): number[] {
  return stops.flatMap((s) => (s.airportId === null ? [] : [s.airportId]));
}
export function computeLegs(stops: Stop[], lookup: (id: number) => Airport | undefined): Leg[] {
  const filled = stops.flatMap((s, i) => {
    const airport = s.airportId === null ? undefined : lookup(s.airportId);
    return airport ? [{ airport, i }] : [];
  });
  return filled.slice(1).map((to, index) => {
    const from = filled[index],
      distanceKm = greatCircleDistanceKm(from.airport, to.airport);
    return {
      index,
      from: from.airport,
      to: to.airport,
      fromStop: from.i,
      toStop: to.i,
      distanceKm,
      durationMin: estimateFlightMinutes(distanceKm),
    };
  });
}
/** Layovers at each transfer: the stop where one leg ends and the next begins. */
export function computeLayovers(stops: Stop[], legs: Leg[]): Layover[] {
  return legs.slice(0, -1).map((leg) => {
    const custom = stops[leg.toStop]?.layoverMin ?? null;
    return {
      stopIndex: leg.toStop,
      airport: leg.to,
      minutes: custom ?? DEFAULT_LAYOVER_MIN,
      custom: custom !== null,
    };
  });
}
