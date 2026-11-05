import type { Airport } from '../types.ts';
import type { SearchIndex } from '../data/search.ts';
import { findAirportByCode } from '../data/search.ts';
import { airportCode } from '../data/airports.ts';
import { DEFAULT_LAYOVER_MIN, isValidLayover } from '../lib/layover.ts';
export const ROUTE_PARAM = 'route';
const MAX_TOKENS = 10;
/** An airport code, optionally followed by a custom layover in minutes: `LHR` or `LHR_180`. */
const TOKEN = /^([A-Z0-9]{2,8})(?:_(\d{1,5}))?$/;

export interface RouteStopSpec {
  airport: Airport;
  /** Custom layover in minutes; null for the default. */
  layoverMin: number | null;
}

/** Route tokens from the query string, or null when there is no route parameter. */
export function parseRouteParam(search: string): string[] | null {
  const params = new URLSearchParams(search);
  const value = [...params].find(([key]) => key.toLowerCase() === ROUTE_PARAM)?.[1];
  if (value === undefined) return null;
  return value
    .toUpperCase()
    .split(/[-,>~.\s]+/)
    .filter((t) => TOKEN.test(t))
    .slice(0, MAX_TOKENS);
}

export function parseRouteToken(token: string): { code: string; layoverMin: number | null } {
  const match = TOKEN.exec(token.trim().toUpperCase());
  if (!match) return { code: token, layoverMin: null };
  const minutes = match[2] === undefined ? null : Number(match[2]);
  return { code: match[1], layoverMin: isValidLayover(minutes) && minutes !== DEFAULT_LAYOVER_MIN ? minutes : null };
}

/** Tokens for each stop; custom layovers are kept only at transfers (not the first or last stop). */
export function routeTokens(stops: RouteStopSpec[]): string[] {
  const list = stops.slice(0, MAX_TOKENS);
  return list.map(({ airport, layoverMin }, i) => {
    const raw = airportCode(airport).toUpperCase();
    const code = /^[A-Z0-9]{2,8}$/.test(raw) ? raw : String(airport.id);
    const transfer = i > 0 && i < list.length - 1;
    return transfer && layoverMin !== null && isValidLayover(layoverMin) && layoverMin !== DEFAULT_LAYOVER_MIN
      ? `${code}_${layoverMin}`
      : code;
  });
}

export function serializeRoute(stops: RouteStopSpec[]): string {
  return routeTokens(stops).join('-');
}

export function buildShareUrl(base: string, stops: RouteStopSpec[]): string {
  const url = new URL(base);
  url.searchParams.delete(ROUTE_PARAM);
  const route = serializeRoute(stops);
  if (route) url.searchParams.set(ROUTE_PARAM, route);
  return url.toString();
}

export function resolveRouteCodes(tokens: string[], index: SearchIndex): { stops: RouteStopSpec[]; missing: string[] } {
  const stops: RouteStopSpec[] = [],
    missing: string[] = [];
  for (const token of tokens) {
    const { code, layoverMin } = parseRouteToken(token);
    const airport = findAirportByCode(index, code);
    if (airport) stops.push({ airport, layoverMin });
    else missing.push(code);
  }
  return { stops, missing };
}
