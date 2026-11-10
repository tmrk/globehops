import { useMemo } from 'react';
import { planKind, planShape, type PlanState } from '../state/plan.ts';
import type { useAppLinks } from './useAppLinks.ts';
import { zoneForAirport } from '../data/timezones.ts';
import { computeComparison, compareMetrics, comparisonRange, JOURNEY_IDS, type LegRouter } from '../lib/compare.ts';
import { journeyLegOffsets } from '../lib/compareView.ts';
import { computeTrip } from '../lib/trip.ts';
import { compareTripMetrics, computeTripComparison, tripComparisonTimeline } from '../lib/compareTrips.ts';
import { computeLegs, computeLayovers } from '../state/route.ts';
import type { LinkExtra, SerializableLinkStop } from '../state/link.ts';

/** Derive schedules and geometry only when journey inputs change, never on playback frames. */
export function useJourneyModel(
  plan: PlanState,
  { dataset, zones, lookup }: Pick<ReturnType<typeof useAppLinks>, 'dataset' | 'zones' | 'lookup'>,
  timeOpen: boolean,
  assumedStart: number | null,
  /** Routes legs (restricted airspace, diversion coverage) while either is on; undefined keeps great circles. */
  legRouter?: LegRouter,
) {
  const kind = planKind(plan);
  const { sections: perOption, option, section } = planShape(plan);
  const route = plan.journeys[plan.active].route;
  const comparing = kind === 'compare';
  const directLegs = useMemo(() => (dataset ? computeLegs(route.stops, lookup) : []), [route.stops, dataset, lookup]);
  const layovers = useMemo(() => computeLayovers(route.stops, directLegs), [route.stops, directLegs]);
  const serializedJourneys = useMemo(
    () =>
      plan.journeys.map((draft) => ({
        label: draft.label,
        stayMin: draft.stayMin,
        stops: draft.route.stops.flatMap<SerializableLinkStop>((stop) => {
          const airport = stop.airportId !== null ? lookup(stop.airportId) : undefined;
          return airport
            ? [
                {
                  airport,
                  layoverMin: stop.layoverMin,
                  arrival: stop.arrival,
                  departure: stop.departure,
                  ...(stop.track ? { track: stop.track.track } : {}),
                },
              ]
            : [];
        }),
      })),
    [plan.journeys, lookup],
  );
  const filledStops = serializedJourneys[plan.active].stops;
  const primaryStops = serializedJourneys[0].stops;
  const linkExtra = useMemo<LinkExtra>(() => {
    if (kind === 'trip') return { label: serializedJourneys[0].label, sections: serializedJourneys.slice(1) };
    if (kind !== 'compareTrips') return { label: serializedJourneys[0].label, compare: serializedJourneys.slice(1) };
    // Compared trips: A's later journeys as `2.`…, each other alternative's as `b.2.`….
    const options = Array.from({ length: serializedJourneys.length / perOption }, (_, o) =>
      serializedJourneys.slice(o * perOption, (o + 1) * perOption),
    );
    return {
      label: options[0][0].label,
      sections: options[0].slice(1),
      compare: options.slice(1).map(([first, ...rest]) => ({ label: first.label, stops: first.stops, sections: rest })),
    };
  }, [serializedJourneys, kind, perOption]);
  const filledAirports = useMemo(() => filledStops.map((s) => s.airport), [filledStops]);
  const inputs = useMemo(
    () =>
      serializedJourneys.map((entry, i) => ({
        label: entry.label,
        stayMin: entry.stayMin,
        input: {
          id: JOURNEY_IDS[i] ?? `S${i + 1}`,
          stops: entry.stops.map((stop) => ({ ...stop, zone: zoneForAirport(zones, stop.airport) })),
        },
      })),
    [serializedJourneys, zones],
  );
  const start = timeOpen ? assumedStart : null;
  const trip = useMemo(
    () => (kind === 'trip' ? computeTrip(inputs, { assumedStart: start, route: legRouter }) : null),
    [kind, inputs, start, legRouter],
  );
  // Compared trips: each alternative is a trip; journey k of one is compared with journey k of the others.
  const trips = useMemo(
    () =>
      kind === 'compareTrips'
        ? computeTripComparison(
            Array.from({ length: inputs.length / perOption }, (_, o) => ({
              label: inputs[o * perOption].label,
              sections: inputs.slice(o * perOption, (o + 1) * perOption),
            })),
            { assumedStart: start, route: legRouter },
          )
        : null,
    [kind, inputs, perOption, start, legRouter],
  );
  // A trip's journeys are never compared with each other; computing a comparison of them would be wasted work.
  const compared = useMemo(
    () =>
      kind === 'trip' || kind === 'compareTrips'
        ? []
        : computeComparison(inputs, { assumedStart: start, route: legRouter }),
    [kind, inputs, start, legRouter],
  );
  const activeSection = trip ? trip.sections[plan.active] : trips ? trips[option].trip.sections[section] : null;
  const journey = activeSection ? activeSection.journey : compared[plan.active].journey;
  const timeline = activeSection ? activeSection.timeline : compared[plan.active].timeline;
  const activeLegs = journey.legs;
  // The editor's legs carry the routed distance and estimate, so every total agrees with the globe.
  const legs = useMemo(
    () =>
      directLegs.map((leg, i) => {
        const computed = activeLegs[i];
        if (!computed || computed.from.id !== leg.from.id || computed.to.id !== leg.to.id) return leg;
        // A custom path's own length and time (a recording's, or an estimate along a plan).
        if (computed.track)
          return {
            ...leg,
            distanceKm: computed.distanceKm,
            durationMin: computed.estimatedMin,
            track: computed.track,
            pathKind: computed.pathKind,
          };
        return computed.route
          ? { ...leg, distanceKm: computed.distanceKm, durationMin: computed.estimatedMin, route: computed.route }
          : leg;
      }),
    [directLegs, activeLegs],
  );
  const metrics = useMemo(() => compareMetrics(compared), [compared]);
  const tripMetrics = useMemo(() => (trips ? compareTripMetrics(trips) : null), [trips]);
  const tripErrors = (t: NonNullable<typeof trip>) =>
    t.issues.length > 0 || t.sections.some((s) => s.journey.issues.some((issue) => issue.severity === 'error'));
  const scheduleErrors = trip
    ? tripErrors(trip)
    : trips
      ? trips.some((entry) => tripErrors(entry.trip))
      : compared.some((entry) => entry.journey.issues.some((issue) => issue.severity === 'error'));
  const range = useMemo(() => comparisonRange(compared), [compared]);
  /** Compared trips' shared clock, with the stays every traveller shares. */
  const tripsTimeline = useMemo(() => (trips ? tripComparisonTimeline(trips) : null), [trips]);
  const playbackRange = trip ? trip.timeline : trips ? tripsTimeline : comparing ? range : timeline;
  /** Each alternative's first flight on the globe, when comparing trips. */
  const optionOffsets = useMemo(
    () =>
      (trips ?? []).map((_, o) => (trips ?? []).slice(0, o).reduce((sum, entry) => sum + entry.trip.totals.flights, 0)),
    [trips],
  );
  // Every journey's first flight in the globe's flat list of legs, in plan order.
  const legOffsets = useMemo(
    () =>
      trip
        ? trip.sections.map((s) => s.legOffset)
        : trips
          ? trips.flatMap((entry, o) => entry.trip.sections.map((s) => optionOffsets[o] + s.legOffset))
          : journeyLegOffsets(compared),
    [trip, trips, optionOffsets, compared],
  );
  const fleet = useMemo(
    () =>
      comparing
        ? compared.map((entry, i) => ({
            journey: entry.journey,
            timeline: entry.timeline,
            legOffset: legOffsets[i],
            color: entry.color,
            // Planes carry the journey's name (e.g. a traveller's), else its letter.
            tag: entry.label ?? entry.id,
          }))
        : trips
          ? trips.map((entry, o) => ({
              journey: entry.trip.sections[0].journey,
              timeline: null,
              trip: { trip: entry.trip, timeline: entry.trip.timeline },
              legOffset: optionOffsets[o],
              color: entry.color,
              // Planes carry the journey's name (e.g. a traveller's), else its letter.
              tag: entry.label ?? entry.id,
            }))
          : undefined,
    [compared, comparing, trips, optionOffsets, legOffsets],
  );
  return {
    kind,
    legs,
    layovers,
    serializedJourneys,
    filledStops,
    primaryStops,
    linkExtra,
    filledAirports,
    compared,
    trip,
    trips,
    tripMetrics,
    tripsTimeline,
    metrics,
    scheduleErrors,
    journey,
    timeline,
    playbackRange,
    legOffsets,
    fleet,
  };
}
