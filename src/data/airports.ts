import type { Airport, AirportType } from '../types.ts';
import { isValidLatLng } from '../lib/geo.ts';
export interface AirportDataset {
  airports: Airport[];
  byId: Map<number, Airport>;
  meta: DatasetMeta;
}
export interface DatasetMeta {
  generatedAt: string;
  source: string;
  upstreamCommit: string | null;
  counts: Record<string, number>;
}
const TYPES: Record<string, AirportType> = { L: 'large', M: 'medium', S: 'small', W: 'seaplane', H: 'heliport' };
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export function decodeDataset(raw: unknown): AirportDataset {
  if (
    !object(raw) ||
    raw.format !== 1 ||
    !object(raw.meta) ||
    !object(raw.countries) ||
    !object(raw.regions) ||
    !Array.isArray(raw.airports)
  )
    throw new Error('Invalid airport dataset format');
  const meta = raw.meta;
  if (
    typeof meta.generatedAt !== 'string' ||
    typeof meta.source !== 'string' ||
    !(meta.upstreamCommit === null || typeof meta.upstreamCommit === 'string') ||
    !object(meta.counts) ||
    Object.values(meta.counts).some((n) => typeof n !== 'number' || !Number.isFinite(n))
  )
    throw new Error('Invalid dataset metadata');
  const countries = raw.countries,
    regions = raw.regions;
  if ([...Object.values(countries), ...Object.values(regions)].some((v) => typeof v !== 'string'))
    throw new Error('Invalid place dictionaries');
  const byId = new Map<number, Airport>();
  const airports = raw.airports.map((t: unknown) => {
    if (
      !Array.isArray(t) ||
      t.length !== 13 ||
      !Number.isSafeInteger(t[0]) ||
      t[0] < 1 ||
      [1, 2, 3, 4, 5, 6, 7, 10, 12].some((i) => typeof t[i] !== 'string') ||
      !t[1] ||
      !t[4].trim() ||
      typeof t[8] !== 'number' ||
      typeof t[9] !== 'number' ||
      !isValidLatLng({ lat: t[8], lng: t[9] }) ||
      !Object.hasOwn(TYPES, t[10]) ||
      ![0, 1].includes(t[11]) ||
      byId.has(t[0]) ||
      (t[2] && !/^[A-Z]{3}$/.test(t[2])) ||
      (t[3] && !/^[A-Z]{4}$/.test(t[3]))
    )
      throw new Error('Invalid airport tuple');
    const a: Airport = {
      id: t[0],
      ident: t[1],
      iata: t[2] || null,
      icao: t[3] || null,
      name: t[4],
      city: t[5],
      countryCode: t[6],
      country: (countries[t[6]] as string) || t[6],
      region: (regions[t[7]] as string) || '',
      lat: t[8],
      lng: t[9],
      type: TYPES[t[10]],
      scheduled: t[11] === 1,
      keywords: t[12] ? t[12].split('|') : [],
    };
    byId.set(a.id, a);
    return a;
  });
  return { airports, byId, meta: meta as unknown as DatasetMeta };
}
export async function loadAirports(url: string, signal?: AbortSignal): Promise<AirportDataset> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Airport download failed: HTTP ${response.status}`);
  return decodeDataset(await response.json());
}
export function airportCode(a: Airport): string {
  return a.iata ?? a.icao ?? a.ident;
}
export function airportPlace(a: Airport): string {
  return a.city ? [a.city, a.region, a.country].filter(Boolean).join(', ') : a.country;
}

/** City for headings: municipality without parenthetical detail ("Sydney (Mascot)" → "Sydney"). */
export function displayCity(a: Airport): string {
  const city = a.city.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return city || a.name;
}

/** Code to show people: IATA, else ICAO, else null (OurAirports' internal idents are not shown). */
export function displayCode(a: Airport): string | null {
  return a.iata ?? a.icao;
}

/** Compact label for airports without a public code. */
export function shortName(a: Airport): string {
  const name = displayCity(a);
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}
