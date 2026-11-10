import type { Airport, Layover, Leg, LocalTimeInput, RouteState, Stop } from '../types.ts';
import { legTrack, normalizeTrack, reverseTrack, sameTrack, type CustomTrack } from '../lib/track.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';
import { estimateFlightMinutes } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN, isValidLayover } from '../lib/layover.ts';
import { MAX_STOPS } from '../agent/contract.ts';
export { MAX_STOPS } from '../agent/contract.ts';
export type RouteAction =
  | { type: 'setAirport'; index: number; airportId: number | null }
  | { type: 'setTrack'; index: number; track: CustomTrack | null }
  | { type: 'addStop' }
  | { type: 'insertStop'; index: number }
  | { type: 'removeStop'; index: number }
  | { type: 'moveStop'; from: number; to: number }
  | { type: 'reverse' }
  | { type: 'selectLeg'; leg: number | null }
  | { type: 'setLayover'; index: number; minutes: number | null }
  | { type: 'setTime'; index: number; field: 'arrival' | 'departure'; value: LocalTimeInput | null }
  | { type: 'clearTimes' }
  | {
      type: 'load';
      airportIds: (number | null)[];
      tracks?: (CustomTrack | null)[];
      layovers?: (number | null)[];
      arrivals?: (LocalTimeInput | null)[];
      departures?: (LocalTimeInput | null)[];
    };
let nextKey = 0;
/** Stored layovers are null when they equal the default, so only real changes reach the URL. */
const normalizeLayover = (minutes: number | null | undefined): number | null =>
  isValidLayover(minutes) && minutes !== DEFAULT_LAYOVER_MIN ? minutes : null;
const stop = (
  airportId: number | null,
  layoverMin: number | null = null,
  arrival: LocalTimeInput | null = null,
  departure: LocalTimeInput | null = null,
): Stop => ({
  key: `s${++nextKey}`,
  airportId,
  layoverMin: normalizeLayover(layoverMin),
  arrival,
  departure,
});
export function createRouteState(
  airportIds: (number | null)[] = [],
  layovers: (number | null)[] = [],
  arrivals: (LocalTimeInput | null)[] = [],
  departures: (LocalTimeInput | null)[] = [],
  tracks: (CustomTrack | null)[] = [],
): RouteState {
  const ids = airportIds.slice(0, MAX_STOPS);
  while (ids.length < 2) ids.push(null);
  const stops = ids.map((id, i) => stop(id, layovers[i], arrivals[i], departures[i]));
  stops.forEach((s, i) => {
    const to = stops.slice(i + 1).find((next) => next.airportId !== null);
    const track = tracks[i] ? normalizeTrack(tracks[i]!).track : null;
    if (s.airportId !== null && to && track) s.track = { track, to: to.key };
  });
  return { stops, selectedLeg: null };
}
const validIndex = (index: number, length: number) => Number.isInteger(index) && index >= 0 && index < length;
export function routeReducer(state: RouteState, action: RouteAction): RouteState {
  const stops = state.stops;
  const changed = (next: Stop[]): RouteState => ({
    stops: next.map((s, i) => {
      if (!s.track) return s;
      const oldIndex = stops.findIndex((p) => p.key === s.key);
      const oldEnd = stops.findIndex((p) => p.key === s.track!.to);
      const to = next.slice(i + 1).find((p) => p.airportId !== null);
      const old = stops[oldIndex];
      const valid =
        old &&
        old.airportId === s.airportId &&
        to?.key === s.track.to &&
        to.airportId === stops[oldEnd]?.airportId &&
        stops
          .slice(oldIndex, oldEnd + 1)
          .map((p) => p.key)
          .join(',') ===
          next
            .slice(i, next.indexOf(to) + 1)
            .map((p) => p.key)
            .join(',');
      return valid ? s : { ...s, track: null };
    }),
    selectedLeg: null,
  });
  switch (action.type) {
    case 'setTrack': {
      const s = stops[action.index];
      const to = stops.slice(action.index + 1).find((p) => p.airportId !== null);
      if (!validIndex(action.index, stops.length) || s.airportId === null || !to) return state;
      const track = action.track ? normalizeTrack(action.track).track : null;
      if (sameTrack(s.track?.track, track)) return state;
      return {
        ...state,
        stops: stops.map((p, i) => (i === action.index ? { ...p, track: track ? { track, to: to.key } : null } : p)),
      };
    }
    case 'selectLeg': {
      const leg = action.leg !== null && action.leg < 0 ? null : action.leg;
      return leg === state.selectedLeg ? state : { ...state, selectedLeg: leg };
    }
    case 'setTime': {
      if (!validIndex(action.index, stops.length) || sameTime(stops[action.index][action.field], action.value))
        return state;
      return {
        ...state,
        stops: stops.map((s, i) => (i === action.index ? { ...s, [action.field]: action.value } : s)),
      };
    }
    case 'clearTimes':
      return hasEnteredTimes(stops)
        ? { ...state, stops: stops.map((s) => ({ ...s, arrival: null, departure: null })) }
        : state;
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
    case 'reverse': {
      const next = stops
        .slice()
        .reverse()
        .map((s) => ({ ...s, arrival: null, departure: null, track: null as Stop['track'] }));
      for (const from of stops) {
        if (!from.track) continue;
        const track = reverseTrack(from.track.track);
        const departure = next.find((p) => p.key === from.track!.to);
        if (track && departure) departure.track = { track, to: from.key };
      }
      return { stops: next, selectedLeg: null };
    }
    case 'load': {
      const ids = action.airportIds.slice(0, MAX_STOPS);
      while (ids.length < 2) ids.push(null);
      const layovers = ids.map((_, i) => normalizeLayover(action.layovers?.[i]));
      return ids.length === stops.length &&
        ids.every(
          (id, i) =>
            id === stops[i].airportId &&
            layovers[i] === stops[i].layoverMin &&
            sameTime(stops[i].arrival, action.arrivals?.[i] ?? null) &&
            sameTime(stops[i].departure, action.departures?.[i] ?? null) &&
            sameTrack(
              stops[i].track?.track,
              id !== null && ids.slice(i + 1).some((v) => v !== null) && action.tracks?.[i]
                ? normalizeTrack(action.tracks[i]!).track
                : null,
            ),
        ) &&
        state.selectedLeg === null
        ? state
        : createRouteState(ids, layovers, action.arrivals, action.departures, action.tracks);
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
      track = stops[from.i].track?.to === stops[to.i].key ? legTrack(stops[from.i].track!.track) : undefined,
      distanceKm = track?.distanceKm ?? greatCircleDistanceKm(from.airport, to.airport);
    return {
      index,
      from: from.airport,
      to: to.airport,
      fromStop: from.i,
      toStop: to.i,
      distanceKm,
      ...(track ? { track, pathKind: track.kind } : {}),
      durationMin: track?.times
        ? Math.round((track.times.at(-1)! - track.times[0]) / 60000)
        : estimateFlightMinutes(distanceKm),
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

const sameTime = (a: LocalTimeInput | null, b: LocalTimeInput | null): boolean =>
  a === b || (a !== null && b !== null && a.local === b.local && a.offsetMin === b.offsetMin);
export function hasEnteredTimes(stops: Stop[]): boolean {
  return stops.some((s) => s.arrival !== null || s.departure !== null);
}
