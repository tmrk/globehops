import { airportCode } from '../data/airports.ts';
import { findAirportByCode } from '../data/search.ts';
import { groupFlights } from '../lib/import/group.ts';
import { ImportFailure } from '../lib/import/common.ts';
import type { ImportContext, ImportResult } from '../lib/import/types.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';
import { legTrack } from '../lib/track.ts';
import { MAX_LABEL_LENGTH } from '../lib/journeyLabel.ts';
import type { AgentContext } from './plan.ts';
import type { ItineraryDocument, StopDoc, TrackPointDoc } from './itinerary.ts';

/** Use the same exact airport lookup as the agent planner, including ICAO and ident codes. */
export function agentImportContext(ctx: AgentContext): ImportContext {
  return {
    airports: ctx.airports.airports,
    byCode: (code) => findAirportByCode(ctx.index, code) ?? undefined,
    navaids: ctx.navaids,
  };
}
function shortName(name: string | null, limit: number): string | undefined {
  const clean = name?.replace(/\p{Cc}/gu, '').trim();
  return clean ? Array.from(clean).slice(0, limit).join('') : undefined;
}
/** Exact geometry stays in the document; only the planner's shared URL copy may be simplified. */
export function importedRouteSummary(result: ImportResult) {
  if (!result.ok || !result.flights.length)
    throw new ImportFailure(result.error?.code ?? 'no_path', result.error?.message ?? 'No flights were imported.');
  const { journeys, dropped } = groupFlights(result.flights);
  const sections = journeys.map((flights) => ({
    stops: [
      ...flights.map(({ from, track }): StopDoc => ({
        airport: airportCode(from),
        track: {
          kind: track.kind,
          format: track.source.format,
          ...(shortName(track.source.name, 80) ? { name: shortName(track.source.name, 80) } : {}),
          points: track.points.map((p): TrackPointDoc => [
            p.lat,
            p.lng,
            p.altM,
            p.time === null ? null : new Date(p.time).toISOString(),
          ]),
        },
      })),
      { airport: airportCode(flights.at(-1)!.to) },
    ],
  }));
  const document: ItineraryDocument =
    sections.length === 1 ? { version: 1, stops: sections[0].stops } : { version: 1, sections };
  return {
    format: result.format,
    name: result.name,
    flights: result.flights.map((flight) => {
      const track = legTrack(flight.track);
      return {
        from: airportCode(flight.from),
        to: airportCode(flight.to),
        kind: track.kind,
        points: track.points,
        distanceKm: track.distanceKm,
        greatCircleKm: greatCircleDistanceKm(flight.from, flight.to),
        ...(track.times ? { recordedDurationMin: Math.round((track.times.at(-1)! - track.times[0]) / 60000) } : {}),
        fromDistanceKm: flight.fromDistanceKm,
        toDistanceKm: flight.toDistanceKm,
      };
    }),
    warnings: [
      ...result.warnings,
      ...(dropped
        ? [{ code: 'truncated_flights', message: `${dropped} flights did not fit the plan.`, params: { dropped } }]
        : []),
    ],
    document,
  };
}

/** A generated alternative keeps the same airports, without imported tracks or recorded times. */
export function importedComparisonDocument(document: ItineraryDocument, name: string | null): ItineraryDocument {
  if (!document.stops) throw new ImportFailure('unsupported', 'Generated-route comparison requires a single journey.');
  return {
    version: 1,
    journeys: [
      { label: shortName(name, MAX_LABEL_LENGTH) ?? 'Imported path', stops: document.stops },
      { label: 'GlobeHops route', stops: document.stops.map(({ airport }) => ({ airport })) },
    ],
  };
}
