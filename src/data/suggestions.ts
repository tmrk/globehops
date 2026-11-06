import type { Airport } from '../types.ts';
import { estimateFlightMinutes } from '../lib/flightTime.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';
import { PRIMARY_AIRPORTS } from './rankHints.ts';
import { searchAirports, type SearchIndex } from './search.ts';
import { zoneForAirport, type TimeZoneTable } from './timezones.ts';

export interface WelcomeSuggestion {
  from: Airport;
  to: Airport;
  distanceKm: number;
  minutes: number;
}

export const FALLBACK_HOME = 'LHR';

// Older browser tzdbs still return these names. Normalize both browser and airport-table zones.
const ZONE_ALIASES: Readonly<Record<string, string>> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Europe/Kiev': 'Europe/Kyiv',
  'Asia/Rangoon': 'Asia/Yangon',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'America/Godthab': 'America/Nuuk',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
};

// Country gateways where the zone city is ambiguous, has no airport, or serves a smaller airport.
const HOME_OVERRIDES: Readonly<Record<string, string>> = {
  'Asia/Kolkata': 'DEL', // Delhi is India's main intercontinental gateway.
  'Europe/Berlin': 'FRA', // Frankfurt is Germany's main long-haul hub.
  'Asia/Jerusalem': 'TLV', // Jerusalem has no scheduled airport.
  'Atlantic/Reykjavik': 'KEF', // International flights use Keflavík rather than the city airport.
  'Asia/Qatar': 'DOH',
  'Pacific/Fiji': 'NAN', // Nadi is Fiji's international gateway.
  'America/Costa_Rica': 'SJO',
  'America/Jamaica': 'KIN',
  'Asia/Shanghai': 'PVG', // Pudong handles the city's main long-haul services.
  'Australia/Sydney': 'SYD',
  'America/New_York': 'JFK',
  'America/Toronto': 'YYZ',
  'Asia/Tokyo': 'HND',
  'America/Sao_Paulo': 'GRU',
  'Europe/Moscow': 'SVO',
  'Africa/Johannesburg': 'JNB',
  'America/La_Paz': 'VVI', // Santa Cruz is Bolivia's main low-altitude long-haul gateway.
  'Asia/Karachi': 'KHI',
};

function normalizeZone(zone: string): string {
  return Object.hasOwn(ZONE_ALIASES, zone) ? ZONE_ALIASES[zone] : zone;
}

function isGateway(airport: Airport): boolean {
  return airport.type === 'large' && airport.scheduled && !!airport.iata;
}

/** The user's likely home airport from the browser time zone, or null. No geolocation or network lookup. */
export function homeAirport(
  timeZone: string | null | undefined,
  ctx: { index: SearchIndex; zones: TimeZoneTable | null },
): Airport | null {
  if (!timeZone || !timeZone.includes('/')) return null;
  const zone = normalizeZone(timeZone);
  const override = Object.hasOwn(HOME_OVERRIDES, zone) ? ctx.index.iata.get(HOME_OVERRIDES[zone]) : undefined;
  if (override && isGateway(override)) return override;

  const matchesZone = (airport: Airport) => {
    const mapped = zoneForAirport(ctx.zones, airport);
    return mapped !== null && normalizeZone(mapped) === zone;
  };
  const city = zone.slice(zone.lastIndexOf('/') + 1).replaceAll('_', ' ');
  const cityMatch = searchAirports(ctx.index, city, ctx.index.entries.length).find(
    (airport) => isGateway(airport) && (!ctx.zones || matchesZone(airport)),
  );
  if (cityMatch) return cityMatch;
  if (!ctx.zones) return null;

  const gateways = ctx.index.entries.map(({ airport }) => airport).filter((a) => isGateway(a) && matchesZone(a));
  gateways.sort(
    (a, b) =>
      Number(PRIMARY_AIRPORTS.has(b.iata!)) - Number(PRIMARY_AIRPORTS.has(a.iata!)) ||
      a.iata!.localeCompare(b.iata!, 'en') ||
      a.id - b.id,
  );
  return gateways[0] ?? null;
}

type Region = 'north-america' | 'south-america' | 'europe' | 'middle-east' | 'africa' | 'asia' | 'oceania';

// Familiar intercontinental gateways, ordered for an inviting globe preview, not scheduled service.
// Region diversity comes before filling extra destinations from the same part of the world.
const HUBS: readonly (readonly [string, Region])[] = [
  ['JFK', 'north-america'],
  ['SYD', 'oceania'],
  ['HKG', 'asia'],
  ['LAX', 'north-america'],
  ['SIN', 'asia'],
  ['DXB', 'middle-east'],
  ['HND', 'asia'],
  ['LHR', 'europe'],
  ['GRU', 'south-america'],
  ['JNB', 'africa'],
  ['CDG', 'europe'],
  ['ICN', 'asia'],
  ['SFO', 'north-america'],
  ['EZE', 'south-america'],
  ['BKK', 'asia'],
  ['DEL', 'asia'],
  ['AKL', 'oceania'],
  ['YVR', 'north-america'],
  ['MEX', 'north-america'],
  ['DOH', 'middle-east'],
  ['IST', 'europe'],
  ['FRA', 'europe'],
  ['PEK', 'asia'],
  ['PVG', 'asia'],
  ['MEL', 'oceania'],
  ['PER', 'oceania'],
  ['SCL', 'south-america'],
  ['BOG', 'south-america'],
  ['LIM', 'south-america'],
  ['CPT', 'africa'],
  ['NBO', 'africa'],
  ['ADD', 'africa'],
  ['CAI', 'africa'],
  ['ORD', 'north-america'],
  ['MIA', 'north-america'],
  ['YYZ', 'north-america'],
  ['KUL', 'asia'],
  ['TPE', 'asia'],
  ['MNL', 'asia'],
  ['CGK', 'asia'],
  ['BOM', 'asia'],
  ['BNE', 'oceania'],
  ['AMS', 'europe'],
  ['MAD', 'europe'],
];

/** Nonstop long-haul previews, deterministic; estimates do not imply that a scheduled service exists. */
export function welcomeSuggestions(origin: Airport, index: SearchIndex, count = 3): WelcomeSuggestion[] {
  const target = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 3;
  const candidates = HUBS.flatMap(([code, region]) => {
    const to = index.iata.get(code);
    if (!to || !isGateway(to) || to.id === origin.id || to.countryCode === origin.countryCode) return [];
    const distanceKm = greatCircleDistanceKm(origin, to);
    const minutes = estimateFlightMinutes(distanceKm);
    if (minutes === null || distanceKm > 16_500) return [];
    return [{ suggestion: { from: origin, to, distanceKm, minutes }, region }];
  });
  const longHaul = candidates.filter(({ suggestion }) => suggestion.minutes >= 720);
  const selected: WelcomeSuggestion[] = [];
  const regions = new Set<Region>();
  const destinations = new Set<number>();
  function pick(candidate: (typeof candidates)[number]) {
    if (selected.length >= target || destinations.has(candidate.suggestion.to.id)) return;
    selected.push(candidate.suggestion);
    regions.add(candidate.region);
    destinations.add(candidate.suggestion.to.id);
  }
  for (const candidate of longHaul) {
    if (!regions.has(candidate.region)) pick(candidate);
  }
  for (const candidate of longHaul) pick(candidate);
  // Sparse/custom datasets can lack three long routes. Keep the distance cap and fill longest first.
  if (selected.length < target) {
    const longest = [...candidates].sort((a, b) => b.suggestion.distanceKm - a.suggestion.distanceKm);
    for (const candidate of longest) pick(candidate);
  }
  return selected;
}
