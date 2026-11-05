import type { Airport } from '../types.ts';
import type { SearchIndex } from '../data/search.ts';
import { findAirportByCode } from '../data/search.ts';
import { airportCode } from '../data/airports.ts';
export const ROUTE_PARAM = 'route';
export function parseRouteParam(search: string): string[] | null {
  const params = new URLSearchParams(search);
  const value = [...params].find(([key]) => key.toLowerCase() === ROUTE_PARAM)?.[1];
  if (value === undefined) return null;
  return value
    .toUpperCase()
    .split(/[-,>~.\s]+/)
    .filter((t) => /^[A-Z0-9]{2,8}$/.test(t))
    .slice(0, 10);
}
export function serializeRoute(airports: Airport[]): string {
  return airports
    .slice(0, 10)
    .map((a) => {
      const code = airportCode(a).toUpperCase();
      return /^[A-Z0-9]{2,8}$/.test(code) ? code : String(a.id);
    })
    .join('-');
}
export function buildShareUrl(base: string, airports: Airport[]): string {
  const url = new URL(base);
  url.searchParams.delete(ROUTE_PARAM);
  const route = serializeRoute(airports);
  if (route) url.searchParams.set(ROUTE_PARAM, route);
  return url.toString();
}
export function resolveRouteCodes(codes: string[], index: SearchIndex): { airports: Airport[]; missing: string[] } {
  const airports: Airport[] = [],
    missing: string[] = [];
  for (const code of codes) {
    const airport = findAirportByCode(index, code);
    if (airport) airports.push(airport);
    else missing.push(code);
  }
  return { airports, missing };
}
