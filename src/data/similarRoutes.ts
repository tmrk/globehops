import type { Airport } from '../types.ts';
import { estimateFlightMinutes } from '../lib/flightTime.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';
import type { SearchIndex } from './search.ts';
import { isGateway } from './suggestions.ts';

export interface SimilarRoute {
  airports: Airport[];
  distanceKm: number;
  /** Estimated flights plus the default layover at each connection. */
  minutes: number;
}

// Familiar connecting hubs, roughly most familiar first. Inclusion does not imply scheduled service.
const CONNECTING_HUBS: readonly string[] = [
  'DXB',
  'DOH',
  'IST',
  'SIN',
  'LHR',
  'FRA',
  'AMS',
  'CDG',
  'HKG',
  'ICN',
  'HND',
  'BKK',
  'KUL',
  'AUH',
  'MUC',
  'ZRH',
  'MAD',
  'ATL',
  'ORD',
  'DFW',
  'LAX',
  'JFK',
  'SFO',
  'YYZ',
  'YVR',
  'PEK',
  'PVG',
  'CAN',
  'TPE',
  'NRT',
  'DEL',
  'BOM',
  'ADD',
  'NBO',
  'JNB',
  'CAI',
  'CMN',
  'GRU',
  'BOG',
  'PTY',
  'LIM',
  'SCL',
  'EZE',
  'MEX',
  'MIA',
  'IAH',
  'DEN',
  'SEA',
  'EWR',
  'YUL',
  'SYD',
  'MEL',
  'BNE',
  'PER',
  'AKL',
  'HNL',
  'LIS',
  'FCO',
  'VIE',
  'CPH',
  'HEL',
  'DUB',
  'BRU',
  'WAW',
  'ATH',
  'OSL',
  'ARN',
  'RUH',
  'JED',
  'LOS',
  'MNL',
  'CGK',
];

/** Same nonstop cap as the welcome suggestions. */
const MAX_LEG_KM = 16_500;
/** Each leg via a hub must cover this much of the trip, and at least MIN_LEG_KM, to be a real alternative. */
const MIN_LEG_SHARE = 0.1;
const MIN_LEG_KM = 250;
/** Hubs this close to the great circle are offered in familiarity order; others only by least detour. */
const ON_THE_WAY = 1.1;
const MAX_DETOUR = 1.3;

function estimate(airports: Airport[]): SimilarRoute | null {
  let distanceKm = 0;
  let minutes = (airports.length - 2) * DEFAULT_LAYOVER_MIN;
  for (let i = 1; i < airports.length; i++) {
    const km = greatCircleDistanceKm(airports[i - 1], airports[i]);
    const flight = estimateFlightMinutes(km);
    if (flight === null || km > MAX_LEG_KM) return null;
    distanceKm += km;
    minutes += flight;
  }
  return { airports, distanceKm, minutes };
}

/**
 * Alternatives between the same two airports as `route`: nonstop when it connects, then via familiar hubs
 * near the great circle, spread apart so each looks different on the globe. Never repeats an `existing`
 * airport-id sequence. Deterministic estimates; they do not imply that scheduled service exists.
 */
export function similarRoutes(
  route: readonly Airport[],
  index: SearchIndex,
  existing: readonly (readonly number[])[] = [],
  count = 3,
): SimilarRoute[] {
  const from = route[0];
  const to = route.at(-1);
  const target = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 3;
  if (!from || !to || route.length < 2) return [];
  const directKm = greatCircleDistanceKm(from, to);
  const minLegKm = Math.max(MIN_LEG_KM, directKm * MIN_LEG_SHARE);
  if (directKm < 2 * minLegKm) return [];

  const seen = new Set(existing.map((ids) => ids.join('-')));
  const results: SimilarRoute[] = [];
  const add = (airports: Airport[]) => {
    const key = airports.map((airport) => airport.id).join('-');
    if (results.length >= target || seen.has(key)) return false;
    const option = estimate(airports);
    if (!option) return false;
    seen.add(key);
    results.push(option);
    return true;
  };
  if (route.length > 2) add([from, to]);

  const hubs = CONNECTING_HUBS.flatMap((code, rank) => {
    const hub = index.iata.get(code);
    if (!hub || !isGateway(hub)) return [];
    const first = greatCircleDistanceKm(from, hub);
    const second = greatCircleDistanceKm(hub, to);
    if (first < minLegKm || second < minLegKm) return [];
    const detour = (first + second) / directKm;
    return detour <= MAX_DETOUR ? [{ hub, rank, detour, onTheWay: detour <= ON_THE_WAY }] : [];
  }).sort((a, b) => Number(b.onTheWay) - Number(a.onTheWay) || (a.onTheWay ? a.rank - b.rank : a.detour - b.detour));
  // Neighbouring hubs (Doha and Dubai, the two Tokyo airports) would draw almost the same arc.
  const spacingKm = Math.max(MIN_LEG_KM, directKm / 10);
  const taken = route.slice(1, -1) as Airport[];
  for (const { hub } of hubs) {
    if (results.length >= target) break;
    if (taken.some((other) => greatCircleDistanceKm(other, hub) < spacingKm)) continue;
    if (add([from, hub, to])) taken.push(hub);
  }
  return results;
}
