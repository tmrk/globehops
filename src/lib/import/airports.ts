import type { Airport, LatLng } from '../../types.ts';
import { greatCircleDistanceKm } from '../geo.ts';
import type { ImportContext } from './types.ts';

const grids = new WeakMap<readonly Airport[], Map<number, Airport[]>>();
const weights = { large: 1, medium: 1.6, small: 3.5, seaplane: 8, heliport: 8 };
function cellX(lng: number): number {
  return ((Math.floor((lng + 180) / 2) % 180) + 180) % 180;
}
function cellY(lat: number): number {
  return Math.min(89, Math.max(0, Math.floor((lat + 90) / 2)));
}
function gridFor(airports: readonly Airport[]) {
  let grid = grids.get(airports);
  if (!grid) {
    grid = new Map();
    for (const airport of airports) {
      const key = cellY(airport.lat) * 180 + cellX(airport.lng);
      const bucket = grid.get(key) ?? [];
      bucket.push(airport);
      grid.set(key, bucket);
    }
    grids.set(airports, grid);
  }
  return grid;
}
export const codeOf = (airport: Airport): string => airport.iata ?? airport.icao ?? airport.ident;
/** Names are hints, never permission to move geometry or match a distant airport. */
export function namedEnds(text: string | null | undefined, context: ImportContext): [Airport, Airport] | null {
  const candidates: Airport[] = [];
  for (const token of text?.toUpperCase().match(/[A-Z0-9]{3,8}/g) ?? []) {
    const a = context.byCode(token);
    if (a) candidates.push(a);
  }
  return candidates.length >= 2 ? [candidates[0], candidates[candidates.length - 1]] : null;
}
export function matchAirport(
  point: LatLng,
  context: ImportContext,
  hint?: Airport,
): { airport: Airport; km: number } | null {
  if (hint) {
    const km = greatCircleDistanceKm(point, hint);
    if (km <= 50) return { airport: hint, km };
  }
  const grid = gridFor(context.airports);
  const latRadius = 30 / 111.195;
  const minLat = Math.max(-90, point.lat - latRadius),
    maxLat = Math.min(90, point.lat + latRadius);
  const polar = minLat === -90 || maxLat === 90;
  const lngRadius = polar
    ? 180
    : (Math.asin(Math.min(1, Math.sin((latRadius * Math.PI) / 180) / Math.cos((point.lat * Math.PI) / 180))) * 180) /
      Math.PI;
  const xs = new Set<number>();
  for (let x = Math.floor((point.lng - lngRadius + 180) / 2); x <= Math.floor((point.lng + lngRadius + 180) / 2); x++)
    xs.add(((x % 180) + 180) % 180);
  let best: { airport: Airport; km: number } | null = null,
    score = Infinity;
  for (let y = cellY(minLat); y <= cellY(maxLat); y++) {
    for (const x of xs) {
      for (const airport of grid.get(y * 180 + x) ?? []) {
        const km = greatCircleDistanceKm(point, airport);
        const candidate = km * weights[airport.type] * (airport.scheduled ? 0.7 : 1);
        if (km <= 30 && candidate < score) {
          best = { airport, km };
          score = candidate;
        }
      }
    }
  }
  if (best) return best;
  // Outside the local cap, exact global nearest search is bounded by the airport dataset size.
  for (const airport of context.airports) {
    const km = greatCircleDistanceKm(point, airport);
    if (!best || km < best.km) best = { airport, km };
  }
  return best;
}
