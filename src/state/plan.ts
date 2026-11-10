/**
 * The visitor's plan: one journey, alternatives to compare (A–D), a trip of sequential journeys separated
 * by stays, or alternative trips to compare (each the same number of journeys, e.g. out and back).
 * Alternatives are compared side by side, while a trip's journeys follow one another; a journey is never
 * compared with a later journey of the same trip.
 *
 * Journeys are stored flat, alternative by alternative: journey `s` of alternative `o` is
 * `journeys[o * sections + s]`.
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
  /** True when each alternative is a trip of sequential journeys (sections) rather than one journey. */
  trip: boolean;
  /** Journeys per alternative: 1 unless `trip`; a single trip has them all. */
  sections: number;
}
export type PlanKind = 'single' | 'compare' | 'trip' | 'compareTrips';
export function planKind(state: PlanState): PlanKind {
  if (state.journeys.length < 2) return 'single';
  if (!state.trip) return 'compare';
  return state.sections < state.journeys.length ? 'compareTrips' : 'trip';
}
/** Alternatives, journeys per alternative, and the alternative and journey being edited. */
export function planShape(state: PlanState) {
  const sections = state.trip ? state.sections : 1;
  return {
    sections,
    options: Math.max(1, state.journeys.length / sections),
    option: Math.floor(state.active / sections),
    section: state.active % sections,
  };
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
  /**
   * One journey becomes a trip with a return, from its destination back to its origin; compared
   * journeys each get theirs and become compared trips.
   */
  | { type: 'addReturn' }
  /** Trip: another journey, starting where the last one ends. */
  | { type: 'addSection' }
  | { type: 'remove'; index: number }
  /** Compared trips: an alternative with all its journeys. */
  | { type: 'removeOption'; option: number }
  /** Compared trips: one journey (e.g. the return) from every alternative. */
  | { type: 'removeSection'; section: number }
  | { type: 'activate'; index: number }
  | { type: 'setLabel'; index: number; label: string | null }
  | { type: 'setStay'; index: number; minutes: number | null }
  /** `journeys` alternative by alternative; with `trip`, `sections` per alternative (default: all of them). */
  | { type: 'load'; journeys: LoadedJourney[]; trip?: boolean; sections?: number };
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
  return { journeys: [draft()], active: 0, trip: false, sections: 1 };
}
const ends = (journey: JourneyDraft) => {
  const ids = filledAirportIds(journey.route.stops);
  return ids.length >= 2 && ids[0] !== ids[ids.length - 1] ? { first: ids[0], last: ids[ids.length - 1] } : null;
};
export function planReducer(state: PlanState, action: PlanAction): PlanState {
  const valid = (index: number) => Number.isInteger(index) && index >= 0 && index < state.journeys.length;
  const kind = planKind(state);
  const shape = planShape(state);
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
      // A new alternative starts empty; App offers similar routes rather than a copy of an existing one.
      if (shape.options >= MAX_JOURNEYS) return state;
      if (state.trip)
        return {
          ...state,
          journeys: [...state.journeys, ...Array.from({ length: shape.sections }, () => draft())],
          active: state.journeys.length,
        };
      return { journeys: [...state.journeys, draft()], active: state.journeys.length, trip: false, sections: 1 };
    case 'addReturn': {
      if (kind === 'single') {
        const journey = ends(state.journeys[0]);
        if (!journey) return state;
        return {
          journeys: [state.journeys[0], draft({ airportIds: [journey.last, journey.first] })],
          active: 1,
          trip: true,
          sections: 2,
        };
      }
      if (kind !== 'compare') return state;
      // Every alternative comes home its own way; one without a route yet gets an empty return.
      return {
        journeys: state.journeys.flatMap((journey) => {
          const route = ends(journey);
          return [journey, draft(route ? { airportIds: [route.last, route.first] } : undefined)];
        }),
        active: state.active * 2 + 1,
        trip: true,
        sections: 2,
      };
    }
    case 'addSection': {
      if (kind !== 'trip' || state.journeys.length >= MAX_SECTIONS) return state;
      const last = filledAirportIds(state.journeys[state.journeys.length - 1].route.stops).at(-1) ?? null;
      return {
        ...state,
        journeys: [...state.journeys, draft({ airportIds: [last, null] })],
        active: state.journeys.length,
        sections: state.journeys.length + 1,
      };
    }
    case 'remove': {
      if (!valid(action.index) || state.journeys.length === 1 || kind === 'compareTrips') return state;
      const journeys = state.journeys.filter((_, index) => index !== action.index);
      // The journey that now leads a trip has no stay before it.
      if (state.trip && action.index === 0) journeys[0] = { ...journeys[0], stayMin: null };
      const trip = state.trip && journeys.length > 1;
      return {
        journeys,
        active: action.index <= state.active ? Math.max(0, state.active - 1) : state.active,
        trip,
        sections: trip ? journeys.length : 1,
      };
    }
    case 'removeOption': {
      const { options, sections, option, section } = shape;
      if (kind !== 'compareTrips' || !Number.isInteger(action.option) || action.option < 0 || action.option >= options)
        return state;
      const journeys = state.journeys.filter((_, index) => Math.floor(index / sections) !== action.option);
      const next = action.option <= option ? Math.max(0, option - 1) : option;
      // One trip left is simply a trip.
      return { journeys, active: next * sections + section, trip: true, sections };
    }
    case 'removeSection': {
      const { options, sections, option, section } = shape;
      if (
        kind !== 'compareTrips' ||
        !Number.isInteger(action.section) ||
        action.section < 0 ||
        action.section >= sections
      )
        return state;
      const left = sections - 1;
      // Each alternative's new first journey has no stay before it.
      const journeys = state.journeys
        .filter((_, index) => index % sections !== action.section)
        .map((journey, index) => (index % left === 0 ? { ...journey, stayMin: null } : journey));
      const kept = action.section <= section ? Math.max(0, section - 1) : section;
      return {
        journeys,
        active: Math.min(options * left - 1, option * left + kept),
        trip: left > 1,
        sections: left,
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
      if (!state.trip || !valid(action.index) || action.index % shape.sections === 0) return state;
      return state.journeys[action.index].stayMin === stayMin ? state : update(action.index, { stayMin });
    }
    case 'load': {
      const multi = !!action.trip && action.journeys.length > 1;
      const per = multi ? Math.min(MAX_SECTIONS, Math.max(1, action.sections ?? action.journeys.length)) : 1;
      // Compared trips keep whole alternatives; a lone trip keeps its first six journeys.
      const limit = per > 1 && per < action.journeys.length ? MAX_JOURNEYS * per : multi ? MAX_SECTIONS : MAX_JOURNEYS;
      const count = Math.max(1, Math.floor(Math.min(limit, action.journeys.length) / per)) * per;
      const journeys = action.journeys.slice(0, count);
      const sections = per > 1 ? Math.min(per, journeys.length) : 1;
      const trip = sections > 1;
      const loaded = journeys.length ? journeys.map(draft) : [draft()];
      if (trip) loaded.forEach((journey, index) => index % sections === 0 && (journey.stayMin = null));
      const unchanged =
        state.active === 0 &&
        state.trip === trip &&
        state.sections === (trip ? sections : 1) &&
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
      return unchanged ? state : { journeys: loaded, active: 0, trip, sections: trip ? sections : 1 };
    }
  }
}
