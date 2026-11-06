import type { GlobeRoute } from '../globe/GlobeRenderer.ts';
import type { Airport } from '../types.ts';
import { displayCode } from '../data/airports.ts';
import { legColor } from './legColors.ts';
import { comparisonRange, type ComparedJourney } from './compare.ts';

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

export function comparisonGlobeRoute(
  list: ComparedJourney[],
  active: number,
  open: boolean,
  city: (airport: Airport) => string,
): GlobeRoute {
  const comparing = list.length > 1;
  const markers = new Map<number, GlobeRoute['markers'][number]>();
  const rank = { single: 0, transfer: 1, destination: 2, origin: 3 };
  for (const { journey } of list) {
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
  return {
    markers: [...markers.values()],
    legs: list.flatMap(({ id, index, color, journey }) => {
      const counts = new Map<string, number>();
      return journey.legs.map((leg, i) => {
        const base = `${leg.from.id}>${leg.to.id}`;
        const occurrence = (counts.get(base) ?? 0) + 1;
        counts.set(base, occurrence);
        return {
          key: `${comparing ? `${id}:` : ''}${base}#${occurrence}`,
          from: leg.from,
          to: leg.to,
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
