import type { Airport, Leg, RouteState, Stop } from '../types.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';
import { estimateFlightMinutes } from '../lib/flightTime.ts';
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
  | { type: 'load'; airportIds: (number | null)[] };
let nextKey = 0;
const stop = (airportId: number | null): Stop => ({ key: `s${++nextKey}`, airportId });
export function createRouteState(airportIds: (number | null)[] = []): RouteState {
  const ids = airportIds.slice(0, MAX_STOPS);
  while (ids.length < 2) ids.push(null);
  return { stops: ids.map(stop), selectedLeg: null };
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
      return ids.length === stops.length &&
        ids.every((id, i) => id === stops[i].airportId) &&
        state.selectedLeg === null
        ? state
        : createRouteState(ids);
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
