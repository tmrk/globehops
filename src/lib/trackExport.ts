/**
 * Custom paths as a GeoJSON file: every point, altitude and time exactly as imported, so a path simplified
 * to fit a share link can still travel whole. GlobeHops reads the file back (`coordTimes`, the convention of
 * GPX/KML converters such as togeojson), and other GIS tools open it as plain lines.
 */
import type { Airport } from '../types.ts';
import type { CustomTrack } from './track.ts';

export interface ExportedFlight {
  from: Airport;
  to: Airport;
  track: CustomTrack;
}

const code = (airport: Airport) => airport.iata ?? airport.icao ?? airport.ident;
/** Coordinates rounded to ~1 cm and whole decimetres: the file stays exact without float noise. */
const round = (value: number, digits: number) => Number(value.toFixed(digits));

export function tracksToGeoJson(flights: readonly ExportedFlight[], name: string | null = null) {
  return {
    type: 'FeatureCollection' as const,
    ...(name ? { name } : {}),
    features: flights.map(({ from, to, track }) => {
      const timed = track.points.some((point) => point.time !== null);
      const named = track.points.some((point) => point.name);
      return {
        type: 'Feature' as const,
        properties: {
          name: `${code(from)} → ${code(to)}`,
          from: code(from),
          to: code(to),
          kind: track.kind,
          source: track.source.format,
          ...(track.source.name ? { sourceName: track.source.name } : {}),
          ...(timed
            ? {
                coordTimes: track.points.map((point) =>
                  point.time === null ? null : new Date(point.time).toISOString(),
                ),
              }
            : {}),
          ...(named ? { waypoints: track.points.map((point) => point.name ?? null) } : {}),
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: track.points.map((point) =>
            point.altM === null
              ? [round(point.lng, 7), round(point.lat, 7)]
              : [round(point.lng, 7), round(point.lat, 7), round(point.altM, 1)],
          ),
        },
      };
    }),
  };
}

/** A safe file name for the download: the path's own name, else its route. */
export function exportFileName(flights: readonly ExportedFlight[], name: string | null): string {
  const base =
    name?.replace(/\.[a-z0-9]{2,6}$/i, '') ||
    (flights.length ? [code(flights[0].from), ...flights.map((flight) => code(flight.to))].join('-') : 'flight-path');
  return `${base.replace(/[^\p{L}\p{N}._ -]+/gu, '-').slice(0, 80) || 'flight-path'}.geojson`;
}
