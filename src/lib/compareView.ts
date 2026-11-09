import type { GlobeRoute } from '../globe/GlobeRenderer.ts';
import type { Airport } from '../types.ts';
import { displayCode } from '../data/airports.ts';
import { legColor } from './legColors.ts';
import { pathSignature } from './routePath.ts';
import { comparisonRange, type ComparedJourney } from './compare.ts';
import type { Journey } from './schedule.ts';

/** Shared offsets keep globe selection, fleet aircraft and the editor on the same leg. */
export function journeyLegOffsets(list: ComparedJourney[]): number[] {
  let offset = 0;
  return list.map(({ journey }) => {
    const first = offset;
    offset += journey.legs.length;
    return first;
  });
}

export function localLegAt(list: ComparedJourney[], globalLeg: number): { index: number; leg: number } | null {
  const offsets = journeyLegOffsets(list);
  const index = list.findIndex(
    ({ journey }, i) => globalLeg >= offsets[i] && globalLeg < offsets[i] + journey.legs.length,
  );
  return index < 0 ? null : { index, leg: globalLeg - offsets[index] };
}

/** One marker per airport across journeys; an airport's strongest role wins (origin, destination, transfer). */
export function routeMarkers(
  journeys: readonly Pick<Journey, 'stops'>[],
  city: (airport: Airport) => string,
): GlobeRoute['markers'] {
  const markers = new Map<number, GlobeRoute['markers'][number]>();
  const rank = { single: 0, transfer: 1, destination: 2, origin: 3 };
  for (const journey of journeys) {
    journey.stops.forEach(({ airport }, i, stops) => {
      const role =
        stops.length === 1 ? 'single' : i === 0 ? 'origin' : i === stops.length - 1 ? 'destination' : 'transfer';
      const previous = markers.get(airport.id);
      if (previous && rank[previous.role] >= rank[role]) return;
      const name = city(airport);
      markers.set(airport.id, {
        key: String(airport.id),
        code: displayCode(airport) ?? (name.length > 16 ? `${name.slice(0, 15)}…` : name),
        lat: airport.lat,
        lng: airport.lng,
        role,
      });
    });
  }
  return [...markers.values()];
}

export function comparisonGlobeRoute(
  list: ComparedJourney[],
  active: number,
  open: boolean,
  city: (airport: Airport) => string,
): GlobeRoute {
  const comparing = list.length > 1;
  return {
    markers: routeMarkers(
      list.map(({ journey }) => journey),
      city,
    ),
    legs: list.flatMap(({ id, index, color, journey }) => {
      const counts = new Map<string, number>();
      return journey.legs.map((leg, i) => {
        const base = `${leg.from.id}>${leg.to.id}`;
        const occurrence = (counts.get(base) ?? 0) + 1;
        counts.set(base, occurrence);
        const path = leg.route?.path ?? null;
        return {
          // A changed route is a new leg, so it is drawn (and revealed) afresh.
          key: `${comparing ? `${id}:` : ''}${base}#${occurrence}${path ? `~${pathSignature(path)}` : ''}`,
          from: leg.from,
          to: leg.to,
          path,
          color: comparing ? color : legColor(i),
          lift: comparing ? 1 + 0.22 * index : 1,
          muted: comparing && !open && index !== active,
        };
      });
    }),
  };
}

export interface BarSegment {
  kind: 'flight' | 'ground';
  left: number;
  width: number;
}
/** Percentages on a shared UTC axis, or a shared duration axis before times are available. */
export function comparisonSegments(
  entry: ComparedJourney,
  list: ComparedJourney[],
  range = comparisonRange(list),
): BarSegment[] {
  if (entry.timeline && range) {
    const span = Math.max(1, range.end - range.start);
    return entry.timeline.segments.map((segment) => ({
      kind: segment.kind,
      left: (100 * (segment.start - range.start)) / span,
      width: (100 * (segment.end - segment.start)) / span,
    }));
  }
  const span = Math.max(1, ...list.map(({ journey }) => journey.totals.journeyMin));
  let elapsed = 0;
  return entry.journey.legs.flatMap((leg) => {
    const flight = leg.durationMin ?? leg.estimatedMin ?? 0;
    const segments: BarSegment[] = [{ kind: 'flight', left: (100 * elapsed) / span, width: (100 * flight) / span }];
    elapsed += flight;
    const transfer = entry.journey.transfers.find((transfer) => transfer.stop === leg.toStop);
    if (transfer) {
      segments.push({ kind: 'ground', left: (100 * elapsed) / span, width: (100 * transfer.minutes) / span });
      elapsed += transfer.minutes;
    }
    return segments;
  });
}
