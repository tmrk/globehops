/**
 * Compared trips: two to four alternative trips (A–D), each a sequence of journeys separated by stays –
 * typically the same round trip flown different ways. Every alternative has the same journeys (outbound,
 * return, …), so journey k of one is compared with journey k of the others.
 *
 * As with compared journeys, entered times stay absolute. A trip without any entered time lines up with
 * the timed ones journey by journey (each journey departs with the earliest timed counterpart), keeping a
 * stay the traveller chose; with no timed trip at all, every trip starts at the assumed start.
 */
import {
  JOURNEY_IDS,
  MAX_JOURNEYS,
  journeyColor,
  journeyEstimated,
  winner,
  type JourneyId,
  type LegRouter,
} from './compare.ts';
import { computeTrip, STAY_ARRIVAL_MS, STAY_LEAD_MS, type Trip, type TripSectionInput } from './trip.ts';
import type { Journey } from './schedule.ts';

export interface TripComparisonInput {
  label: string | null;
  sections: TripSectionInput[];
}

export interface ComparedTrip {
  id: JourneyId;
  index: number;
  label: string | null;
  color: string;
  trip: Trip;
  /** `entered`: the trip has times of its own; `assumed`: lined up with another trip or the assumed start. */
  anchor: 'entered' | 'assumed' | 'none';
}

export function computeTripComparison(
  inputs: readonly TripComparisonInput[],
  opts: { assumedStart: number | null; now?: number; route?: LegRouter },
): ComparedTrip[] {
  const list = inputs.slice(0, MAX_JOURNEYS);
  const compute = (index: number, extra: { assumedStart: number | null; align?: (number | null)[] }) =>
    computeTrip(list[index].sections, { now: opts.now, route: opts.route, idPrefix: JOURNEY_IDS[index], ...extra });
  const own = list.map((_, index) => compute(index, { assumedStart: null }));
  const timed = own.filter((trip) => trip.dated);
  const count = Math.max(0, ...list.map((entry) => entry.sections.length));
  const align = Array.from({ length: count }, (_, k) => {
    const starts = timed.flatMap((trip) => {
      const journey = trip.sections[k]?.journey;
      return journey?.legs.length && journey.start ? [journey.start.epochMs] : [];
    });
    return starts.length ? Math.min(...starts) : null;
  });
  const starts = timed.flatMap((trip) => (trip.start ? [trip.start.epochMs] : []));
  const fallback = starts.length ? Math.min(...starts) : opts.assumedStart;
  return list.map((entry, index) => {
    const trip = own[index].dated
      ? own[index]
      : compute(index, timed.length ? { assumedStart: fallback, align } : { assumedStart: opts.assumedStart });
    return {
      id: JOURNEY_IDS[index],
      index,
      label: entry.label,
      color: journeyColor(index),
      trip,
      anchor: trip.dated ? 'entered' : trip.start ? 'assumed' : 'none',
    };
  });
}

export interface TripMetrics {
  id: JourneyId;
  /** Flights and connections across every journey, without the stays: the time spent travelling. */
  travelMin: number;
  flightMin: number;
  distanceKm: number;
  flights: number;
  transfers: number;
  start: number | null;
  end: number | null;
  estimated: boolean;
  /** Each journey's own time (flights and connections); null for a journey without flights. */
  sections: { journeyMin: number | null; estimated: boolean }[];
  /** Every journey (as many as the longest trip has) has a route and the times agree: the trip is ranked. */
  complete: boolean;
}
export interface TripComparisonMetrics {
  trips: TripMetrics[];
  /** Least time travelling over the whole trip; null with fewer than two complete trips or a tie. */
  fastest: JourneyId | null;
  deltaMin: Record<JourneyId, number>;
  /** Journey by journey (outbound, return, …): the fastest complete trip's and each one's extra time. */
  sections: { fastest: JourneyId | null; deltaMin: Record<JourneyId, number> }[];
}

const journeyMin = (journey: Journey): number | null =>
  journey.legs.length
    ? journey.start && journey.end
      ? journey.totals.journeyMin
      : journey.totals.flightMin + journey.totals.layoverMin
    : null;

export function compareTripMetrics(list: readonly ComparedTrip[]): TripComparisonMetrics {
  const count = Math.max(0, ...list.map(({ trip }) => trip.sections.length));
  const trips = list.map(({ id, trip }): TripMetrics => {
    const sections = trip.sections.map(({ journey }) => ({
      journeyMin: journeyMin(journey),
      estimated: journey.legs.length > 0 && (journeyEstimated(journey) || !journey.dated),
    }));
    return {
      id,
      travelMin: sections.reduce((sum, s) => sum + (s.journeyMin ?? 0), 0),
      flightMin: trip.totals.flightMin,
      distanceKm: trip.totals.distanceKm,
      flights: trip.totals.flights,
      transfers: trip.totals.connections,
      start: trip.start?.epochMs ?? null,
      end: trip.end?.epochMs ?? null,
      estimated: sections.some((s) => s.estimated),
      sections,
      complete:
        trip.sections.length === count &&
        trip.sections.every(({ journey }) => journey.stops.length >= 2) &&
        !trip.issues.length &&
        !trip.sections.some(({ journey }) => journey.issues.some((issue) => issue.severity === 'error')),
    };
  });
  const complete = trips.filter((trip) => trip.complete);
  const deltas = (value: (trip: TripMetrics) => number) => {
    const deltaMin: Record<JourneyId, number> = { A: 0, B: 0, C: 0, D: 0 };
    const minimum = complete.length ? Math.min(...complete.map(value)) : 0;
    for (const trip of complete) deltaMin[trip.id] = value(trip) - minimum;
    return { fastest: winner(complete.map((trip) => ({ id: trip.id, value: value(trip) }))), deltaMin };
  };
  return {
    trips,
    ...deltas((trip) => trip.travelMin),
    sections: Array.from({ length: count }, (_, k) => deltas((trip) => trip.sections[k]?.journeyMin ?? 0)),
  };
}

export interface TripComparisonTimeline {
  start: number;
  end: number;
  /** Times when every compared traveller is staying somewhere rather than travelling (sorted). */
  gaps: { start: number; end: number }[];
}

/** One clock for every trip: earliest departure to latest arrival, with the stays they all share. */
export function tripComparisonTimeline(list: readonly ComparedTrip[]): TripComparisonTimeline | null {
  const busy = list
    .flatMap(
      ({ trip }) => trip.timeline?.sections.map(({ timeline }) => ({ start: timeline.start, end: timeline.end })) ?? [],
    )
    .sort((a, b) => a.start - b.start);
  if (!busy.length) return null;
  const gaps: { start: number; end: number }[] = [];
  let reach = busy[0].end;
  for (const interval of busy.slice(1)) {
    if (interval.start > reach) gaps.push({ start: reach, end: interval.start });
    reach = Math.max(reach, interval.end);
  }
  return { start: busy[0].start, end: reach, gaps };
}

/** Shared stays that automatic playback skips, with the same margins as a single trip's stays. */
export function tripComparisonSkips(timeline: TripComparisonTimeline): { from: number; to: number }[] {
  return timeline.gaps.flatMap(({ start, end }) => {
    const from = start + STAY_ARRIVAL_MS,
      to = end - STAY_LEAD_MS;
    return to - from >= 60 * 60_000 ? [{ from, to }] : [];
  });
}
