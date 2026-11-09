/**
 * The visitor's plan: one journey, alternatives to compare (A–D), or a trip of sequential journeys
 * separated by stays. Comparison and trips never mix: alternatives are compared side by side, while a
 * trip's journeys follow one another.
 */
import type { LocalTimeInput, RouteState } from '../types.ts';
import { MAX_LABEL_LENGTH } from '../lib/journeyLabel.ts';
import { MAX_JOURNEYS } from '../lib/compare.ts';
import { MAX_SECTIONS, normalizeStay } from '../lib/trip.ts';
import { createRouteState, filledAirportIds, routeReducer, type RouteAction } from './route.ts';

export interface JourneyDraft {
  key: string;
  label: string | null;
  route: RouteState;
  /** In a trip, the stay before this journey; null for the default. Unused outside trips. */
  stayMin: number | null;
}
export interface PlanState {
  journeys: JourneyDraft[];
  active: number;
  /** True when the journeys are a trip's sequential sections rather than alternatives. */
  trip: boolean;
}
export type PlanKind = 'single' | 'compare' | 'trip';
export function planKind(state: PlanState): PlanKind {
  return state.journeys.length < 2 ? 'single' : state.trip ? 'trip' : 'compare';
}
type LoadedJourney = {
  label?: string | null;
  stayMin?: number | null;
  airportIds: (number | null)[];
  layovers?: (number | null)[];
  arrivals?: (LocalTimeInput | null)[];
  departures?: (LocalTimeInput | null)[];
};
export type PlanAction =
  | { type: 'route'; action: RouteAction; index?: number }
  /** Compare: another, empty alternative. */
  | { type: 'add' }
  /** One journey becomes a trip with a return: from its destination back to its origin. */
  | { type: 'addReturn' }
  /** Trip: another journey, starting where the last one ends. */
  | { type: 'addSection' }
  | { type: 'remove'; index: number }
  | { type: 'activate'; index: number }
  | { type: 'setLabel'; index: number; label: string | null }
  | { type: 'setStay'; index: number; minutes: number | null }
  | { type: 'load'; journeys: LoadedJourney[]; trip?: boolean };
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
    stayMin: normalizeStay(source?.stayMin),
  };
}
export function createPlanState(): PlanState {
  return { journeys: [draft()], active: 0, trip: false };
}
export function planReducer(state: PlanState, action: PlanAction): PlanState {
  const valid = (index: number) => Number.isInteger(index) && index >= 0 && index < state.journeys.length;
  const kind = planKind(state);
  const update = (index: number, change: Partial<JourneyDraft>): PlanState => ({
    ...state,
    journeys: state.journeys.map((journey, i) => (i === index ? { ...journey, ...change } : journey)),
  });
  switch (action.type) {
    case 'route': {
      const index = action.index ?? state.active;
      if (!valid(index)) return state;
      const route = routeReducer(state.journeys[index].route, action.action);
      if (route === state.journeys[index].route) return state;
      return update(index, { route });
    }
    case 'add':
      // A new journey starts empty; App offers similar routes rather than a copy of an existing one.
      if (kind === 'trip' || state.journeys.length >= MAX_JOURNEYS) return state;
      return { journeys: [...state.journeys, draft()], active: state.journeys.length, trip: false };
    case 'addReturn': {
      if (kind !== 'single') return state;
      const ids = filledAirportIds(state.journeys[0].route.stops);
      if (ids.length < 2 || ids[0] === ids[ids.length - 1]) return state;
      return {
        journeys: [state.journeys[0], draft({ airportIds: [ids[ids.length - 1], ids[0]] })],
        active: 1,
        trip: true,
      };
    }
    case 'addSection': {
      if (kind !== 'trip' || state.journeys.length >= MAX_SECTIONS) return state;
      const last = filledAirportIds(state.journeys[state.journeys.length - 1].route.stops).at(-1) ?? null;
      return {
        ...state,
        journeys: [...state.journeys, draft({ airportIds: [last, null] })],
        active: state.journeys.length,
      };
    }
    case 'remove': {
      if (!valid(action.index) || state.journeys.length === 1) return state;
      const journeys = state.journeys.filter((_, index) => index !== action.index);
      // The journey that now leads a trip has no stay before it.
      if (state.trip && action.index === 0) journeys[0] = { ...journeys[0], stayMin: null };
      return {
        journeys,
        active: action.index <= state.active ? Math.max(0, state.active - 1) : state.active,
        trip: state.trip && journeys.length > 1,
      };
    }
    case 'activate':
      return valid(action.index) && action.index !== state.active ? { ...state, active: action.index } : state;
    case 'setLabel': {
      const label = normalizeLabel(action.label);
      if (!valid(action.index) || state.journeys[action.index].label === label) return state;
      return update(action.index, { label });
    }
    case 'setStay': {
      const stayMin = normalizeStay(action.minutes);
      if (kind !== 'trip' || !valid(action.index) || action.index === 0) return state;
      return state.journeys[action.index].stayMin === stayMin ? state : update(action.index, { stayMin });
    }
    case 'load': {
      const trip = !!action.trip && action.journeys.length > 1;
      const journeys = action.journeys.slice(0, trip ? MAX_SECTIONS : MAX_JOURNEYS);
      const loaded = journeys.length ? journeys.map(draft) : [draft()];
      if (trip) loaded[0].stayMin = null;
      const unchanged =
        state.active === 0 &&
        state.trip === trip &&
        loaded.length === state.journeys.length &&
        loaded.every((journey, index) => {
          const previous = state.journeys[index];
          return (
            journey.label === previous.label &&
            journey.stayMin === previous.stayMin &&
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
      return unchanged ? state : { journeys: loaded, active: 0, trip };
    }
  }
}
