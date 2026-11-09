import { useMemo } from 'react';
import type { CompareState } from '../state/compare.ts';
import type { useAppLinks } from './useAppLinks.ts';
import { zoneForAirport } from '../data/timezones.ts';
import { computeComparison, compareMetrics, comparisonRange, JOURNEY_IDS, type LegRouter } from '../lib/compare.ts';
import type { AirspaceRouter } from '../lib/airspace.ts';
import { journeyLegOffsets } from '../lib/compareView.ts';
import { computeLegs, computeLayovers } from '../state/route.ts';
import type { SerializableLinkStop } from '../state/link.ts';

/** Derive schedules and geometry only when journey inputs change, never on playback frames. */
export function useJourneyModel(
  comparison: CompareState,
  { dataset, zones, lookup }: Pick<ReturnType<typeof useAppLinks>, 'dataset' | 'zones' | 'lookup'>,
  timeOpen: boolean,
  assumedStart: number | null,
  /** Present while airspace avoidance is on and loaded; null keeps every flight on its great circle. */
  airspace: AirspaceRouter | null = null,
) {
  const route = comparison.journeys[comparison.active].route;
  const comparing = comparison.journeys.length > 1;
  const directLegs = useMemo(() => (dataset ? computeLegs(route.stops, lookup) : []), [route.stops, dataset, lookup]);
  const layovers = useMemo(() => computeLayovers(route.stops, directLegs), [route.stops, directLegs]);
  // Unknown airlines are treated as EU/EEA operators, the most restricted case (see data/AIRSPACE.md).
  const legRouter = useMemo<LegRouter | undefined>(
    () => (airspace ? (from, to, departureMs) => airspace.route(from, to, { epochMs: departureMs }) : undefined),
    [airspace],
  );
  const serializedJourneys = useMemo(
    () =>
      comparison.journeys.map((draft) => ({
        label: draft.label,
        stops: draft.route.stops.flatMap<SerializableLinkStop>((stop) => {
          const airport = stop.airportId !== null ? lookup(stop.airportId) : undefined;
          return airport
            ? [{ airport, layoverMin: stop.layoverMin, arrival: stop.arrival, departure: stop.departure }]
            : [];
        }),
      })),
    [comparison.journeys, lookup],
  );
  const filledStops = serializedJourneys[comparison.active].stops;
  const primaryStops = serializedJourneys[0].stops;
  const linkExtra = useMemo(
    () => ({ label: serializedJourneys[0].label, compare: serializedJourneys.slice(1) }),
    [serializedJourneys],
  );
  const filledAirports = useMemo(() => filledStops.map((s) => s.airport), [filledStops]);
  const compared = useMemo(
    () =>
      computeComparison(
        serializedJourneys.map((entry, i) => ({
          label: entry.label,
          input: {
            id: JOURNEY_IDS[i],
            stops: entry.stops.map((stop) => ({ ...stop, zone: zoneForAirport(zones, stop.airport) })),
          },
        })),
        { assumedStart: timeOpen ? assumedStart : null, route: legRouter },
      ),
    [serializedJourneys, zones, timeOpen, assumedStart, legRouter],
  );
  const activeLegs = compared[comparison.active].journey.legs;
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
  const scheduleErrors = compared.some((entry) => entry.journey.issues.some((issue) => issue.severity === 'error'));
  const journey = compared[comparison.active].journey;
  const timeline = compared[comparison.active].timeline;
  const range = useMemo(() => comparisonRange(compared), [compared]);
  const playbackRange = comparing ? range : timeline;
  const legOffsets = useMemo(() => journeyLegOffsets(compared), [compared]);
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
    legs,
    layovers,
    serializedJourneys,
    filledStops,
    primaryStops,
    linkExtra,
    filledAirports,
    compared,
    metrics,
    scheduleErrors,
    journey,
    timeline,
    playbackRange,
    legOffsets,
    fleet,
  };
}
