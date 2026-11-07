import type { LocalTimeInput, RouteState } from '../types.ts';
import { MAX_LABEL_LENGTH } from '../lib/journeyLabel.ts';
import { MAX_JOURNEYS } from '../lib/compare.ts';
import { createRouteState, routeReducer, type RouteAction } from './route.ts';

export interface JourneyDraft {
  key: string;
  label: string | null;
  route: RouteState;
}
export interface CompareState {
  journeys: JourneyDraft[];
  active: number;
}
type LoadedJourney = {
  label?: string | null;
  airportIds: (number | null)[];
  layovers?: (number | null)[];
  arrivals?: (LocalTimeInput | null)[];
  departures?: (LocalTimeInput | null)[];
};
export type CompareAction =
  | { type: 'route'; action: RouteAction; index?: number }
  | { type: 'add' }
  | { type: 'remove'; index: number }
  | { type: 'activate'; index: number }
  | { type: 'setLabel'; index: number; label: string | null }
  | { type: 'load'; journeys: LoadedJourney[] };
let nextKey = 0;
const sameTime = (a: LocalTimeInput | null, b: LocalTimeInput | null) =>
  a === b || (a?.local === b?.local && a?.offsetMin === b?.offsetMin);
const normalizeLabel = (label: string | null | undefined) =>
  Array.from(label?.trim() ?? '')
    .slice(0, MAX_LABEL_LENGTH)
    .join('') || null;
function draft(source?: LoadedJourney): JourneyDraft {
  return {
    key: `j${++nextKey}`,
    label: normalizeLabel(source?.label),
    route: createRouteState(source?.airportIds, source?.layovers, source?.arrivals, source?.departures),
  };
}
export function createCompareState(): CompareState {
  return { journeys: [draft()], active: 0 };
}
export function compareReducer(state: CompareState, action: CompareAction): CompareState {
  const valid = (index: number) => Number.isInteger(index) && index >= 0 && index < state.journeys.length;
  switch (action.type) {
    case 'route': {
      const index = action.index ?? state.active;
      if (!valid(index)) return state;
      const route = routeReducer(state.journeys[index].route, action.action);
      if (route === state.journeys[index].route) return state;
      return {
        ...state,
        journeys: state.journeys.map((journey, i) => (i === index ? { ...journey, route } : journey)),
      };
    }
    case 'add':
      // A new journey starts empty; App offers similar routes rather than a copy of an existing one.
      if (state.journeys.length >= MAX_JOURNEYS) return state;
      return { journeys: [...state.journeys, draft()], active: state.journeys.length };
    case 'remove': {
      if (!valid(action.index) || state.journeys.length === 1) return state;
      return {
        journeys: state.journeys.filter((_, index) => index !== action.index),
        active: action.index <= state.active ? Math.max(0, state.active - 1) : state.active,
      };
    }
    case 'activate':
      return valid(action.index) && action.index !== state.active ? { ...state, active: action.index } : state;
    case 'setLabel': {
      const label = normalizeLabel(action.label);
      if (!valid(action.index) || state.journeys[action.index].label === label) return state;
      return {
        ...state,
        journeys: state.journeys.map((journey, i) => (i === action.index ? { ...journey, label } : journey)),
      };
    }
    case 'load': {
      const journeys = action.journeys.slice(0, MAX_JOURNEYS);
      const loaded = journeys.length ? journeys.map(draft) : [draft()];
      const unchanged =
        state.active === 0 &&
        loaded.length === state.journeys.length &&
        loaded.every((journey, index) => {
          const previous = state.journeys[index];
          return (
            journey.label === previous.label &&
            previous.route.selectedLeg === null &&
            journey.route.stops.length === previous.route.stops.length &&
            journey.route.stops.every((stop, stopIndex) => {
              const old = previous.route.stops[stopIndex];
              return (
                stop.airportId === old.airportId &&
                stop.layoverMin === old.layoverMin &&
                sameTime(stop.arrival, old.arrival) &&
                sameTime(stop.departure, old.departure)
              );
            })
          );
        });
      return unchanged ? state : { journeys: loaded, active: 0 };
    }
  }
}
