import { parseLink } from './link.ts';

export interface SavedTripSummary {
  kind: 'single' | 'trip' | 'compare' | 'compareTrips';
  label: string | null;
  alternatives: string[][][];
  flights: number;
  start: string | null;
  end: string | null;
}

export function summarizeSavedTrip(query: string): SavedTripSummary {
  const link = parseLink(query);
  const journeys = [{ stops: link.stops ?? [], sections: link.sections }, ...(link.compare ?? [])];
  const alternatives = journeys.map((journey) => [
    journey.stops,
    ...(journey.sections ?? []).map((section) => section.stops),
  ]);
  const trip = alternatives.some((sections) => sections.length > 1);
  const dates = alternatives[0]
    .flatMap((stops) =>
      stops.flatMap((stop) =>
        [stop.arrival, stop.departure].flatMap((time) => (time ? [time.local.slice(0, 10)] : [])),
      ),
    )
    .sort();
  return {
    kind: alternatives.length > 1 ? (trip ? 'compareTrips' : 'compare') : trip ? 'trip' : 'single',
    label: link.label ?? null,
    alternatives: alternatives.map((sections) => sections.map((stops) => stops.map((stop) => stop.code))),
    flights: alternatives[0].reduce((sum, stops) => sum + Math.max(0, stops.length - 1), 0),
    start: dates[0] ?? null,
    end: dates.at(-1) ?? null,
  };
}

/** A journey shows every stop; a trip shows section ends, joining connected sections. */
export function routeCodesText(sections: readonly (readonly string[])[]): string {
  if (sections.length === 1) return sections[0].join(' → ');
  const parts: string[] = [];
  let last: string | null = null;
  for (const codes of sections) {
    if (!codes.length) continue;
    const first = codes[0],
      end = codes[codes.length - 1];
    if (last === null) parts.push(first);
    else if (last !== first) parts.push('·', first);
    if (end !== first || codes.length > 1) parts.push('→', end);
    last = end;
  }
  return parts.join(' ');
}
