import { trackSignature } from './track.ts';
import type { GlobeRoute } from '../globe/GlobeRenderer.ts';
import type { Airport } from '../types.ts';
import { airportCode } from '../data/airports.ts';
import { legColor } from './legColors.ts';
import { pathSignature } from './routePath.ts';
import { routeMarkers } from './compareView.ts';
import type { Trip } from './trip.ts';
import type { ComparedTrip } from './compareTrips.ts';

/**
 * Every journey of a trip on the globe. Flights take the leg palette in trip order, so the way out and
 * the way back read as one progression; other journeys are quiet while the timeline is closed, and a
 * journey that retraces an earlier one flies slightly higher, so both stay visible.
 */
export function tripGlobeRoute(
  trip: Trip,
  active: number,
  open: boolean,
  city: (airport: Airport) => string,
): GlobeRoute {
  const flown = new Map<string, number>();
  return {
    markers: routeMarkers(
      trip.sections.map((section) => section.journey),
      city,
    ),
    legs: trip.sections.flatMap(({ index, journey, legOffset }) => {
      const counts = new Map<string, number>();
      return journey.legs.map((leg, i) => {
        const base = `${leg.from.id}>${leg.to.id}`;
        const occurrence = (counts.get(base) ?? 0) + 1;
        counts.set(base, occurrence);
        const path = leg.track?.path ?? leg.route?.path ?? null;
        // Same airports in either direction share a ground track.
        const pair = [leg.from.id, leg.to.id].sort((a, b) => a - b).join('-');
        const retraced = flown.get(pair) ?? 0;
        flown.set(pair, retraced + 1);
        return {
          // The first journey keeps a single journey's keys, so adding a return never redraws it.
          key: `${index ? `S${index}:` : ''}${base}#${occurrence}${leg.track ? `~t${trackSignature(leg.track)}` : path ? `~${pathSignature(path)}` : ''}`,
          from: leg.from,
          to: leg.to,
          path,
          ...(leg.track ? { altitudes: leg.track.altitudesKm, trackKind: leg.track.kind } : {}),
          color: legColor(legOffset + i),
          lift: 1 + 0.22 * retraced,
          muted: !open && index !== active,
        };
      });
    }),
  };
}

/**
 * A trip's route in airport codes: each journey's ends, joined where one ends and the next begins
 * (`CPH → NBO → CPH`), with a dot between the ends of an open jaw (`LHR → FCO · MXP → LGW`).
 */
export function tripRouteCodes(sections: readonly (readonly Airport[])[]): string {
  const parts: string[] = [];
  let last: Airport | null = null;
  for (const airports of sections) {
    if (!airports.length) continue;
    const first = airports[0],
      end = airports[airports.length - 1];
    if (!last) parts.push(airportCode(first));
    else if (last.id !== first.id) parts.push('·', airportCode(first));
    if (end.id !== first.id || airports.length > 1) parts.push('→', airportCode(end));
    last = end;
  }
  return parts.join(' ');
}

/**
 * Compared trips on the globe: each alternative in its colour, every journey of it (out and back) bright
 * while it is the one being edited, others quiet until the timeline opens. Alternatives fly at their
 * own heights, and a way back that retraces the way out sits a little above it.
 */
export function tripComparisonGlobeRoute(
  list: readonly ComparedTrip[],
  activeOption: number,
  open: boolean,
  city: (airport: Airport) => string,
): GlobeRoute {
  return {
    markers: routeMarkers(
      list.flatMap(({ trip }) => trip.sections.map((section) => section.journey)),
      city,
    ),
    legs: list.flatMap(({ id, index: option, color, trip }) => {
      const flown = new Map<string, number>();
      return trip.sections.flatMap(({ index, journey }) => {
        const counts = new Map<string, number>();
        return journey.legs.map((leg) => {
          const base = `${leg.from.id}>${leg.to.id}`;
          const occurrence = (counts.get(base) ?? 0) + 1;
          counts.set(base, occurrence);
          const path = leg.track?.path ?? leg.route?.path ?? null;
          const pair = [leg.from.id, leg.to.id].sort((a, b) => a - b).join('-');
          const retraced = flown.get(pair) ?? 0;
          flown.set(pair, retraced + 1);
          return {
            // The first journeys keep compared journeys' keys, so adding returns never redraws them.
            key: `${id}:${index ? `S${index}:` : ''}${base}#${occurrence}${leg.track ? `~t${trackSignature(leg.track)}` : path ? `~${pathSignature(path)}` : ''}`,
            from: leg.from,
            to: leg.to,
            path,
            ...(leg.track ? { altitudes: leg.track.altitudesKm, trackKind: leg.track.kind } : {}),
            color,
            lift: 1 + 0.22 * option + 0.11 * retraced,
            muted: !open && option !== activeOption,
          };
        });
      });
    }),
  };
}
