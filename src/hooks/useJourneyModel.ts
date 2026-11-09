import { useMemo } from 'react';
import { planKind, type PlanState } from '../state/plan.ts';
import type { useAppLinks } from './useAppLinks.ts';
import { zoneForAirport } from '../data/timezones.ts';
import { computeComparison, compareMetrics, comparisonRange, JOURNEY_IDS, type LegRouter } from '../lib/compare.ts';
import { journeyLegOffsets } from '../lib/compareView.ts';
import { computeTrip } from '../lib/trip.ts';
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
            ? [{ airport, layoverMin: stop.layoverMin, arrival: stop.arrival, departure: stop.departure }]
            : [];
        }),
      })),
    [plan.journeys, lookup],
  );
  const filledStops = serializedJourneys[plan.active].stops;
  const primaryStops = serializedJourneys[0].stops;
  const linkExtra = useMemo<LinkExtra>(
    () =>
      kind === 'trip'
        ? { label: serializedJourneys[0].label, sections: serializedJourneys.slice(1) }
        : { label: serializedJourneys[0].label, compare: serializedJourneys.slice(1) },
    [serializedJourneys, kind],
  );
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
  // A trip's journeys are never compared; computing a comparison of them would be wasted work.
  const compared = useMemo(
    () => (kind === 'trip' ? [] : computeComparison(inputs, { assumedStart: start, route: legRouter })),
    [kind, inputs, start, legRouter],
  );
  const journey = trip ? trip.sections[plan.active].journey : compared[plan.active].journey;
  const timeline = trip ? trip.sections[plan.active].timeline : compared[plan.active].timeline;
  const activeLegs = journey.legs;
  // The editor's legs carry the routed distance and estimate, so every total agrees with the globe.
  const legs = useMemo(
    () =>
      directLegs.map((leg, i) => {
        const routed = activeLegs[i];
        return routed?.route && routed.from.id === leg.from.id && routed.to.id === leg.to.id
          ? { ...leg, distanceKm: routed.distanceKm, durationMin: routed.estimatedMin, route: routed.route }
          : leg;
      }),
    [directLegs, activeLegs],
  );
  const metrics = useMemo(() => compareMetrics(compared), [compared]);
  const scheduleErrors = trip
    ? trip.issues.length > 0 || trip.sections.some((s) => s.journey.issues.some((issue) => issue.severity === 'error'))
    : compared.some((entry) => entry.journey.issues.some((issue) => issue.severity === 'error'));
  const range = useMemo(() => comparisonRange(compared), [compared]);
  const playbackRange = trip ? trip.timeline : comparing ? range : timeline;
  const legOffsets = useMemo(
    () => (trip ? trip.sections.map((section) => section.legOffset) : journeyLegOffsets(compared)),
    [trip, compared],
  );
  const fleet = useMemo(
    () =>
      comparing
        ? compared.map((entry, i) => ({
            journey: entry.journey,
            timeline: entry.timeline,
            legOffset: legOffsets[i],
            color: entry.color,
            tag: entry.id,
          }))
        : undefined,
    [compared, comparing, legOffsets],
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
    metrics,
    scheduleErrors,
    journey,
    timeline,
    playbackRange,
    legOffsets,
    fleet,
  };
}
