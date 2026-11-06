/** Optional, lazy-loadable city exonyms. English retains OurAirports displayCity semantics. */
import type { Airport } from '../types.ts';
import { displayCity } from './airports.ts';

export interface CityNameTable {
  hu: Readonly<Record<string, string>>;
  sv: Readonly<Record<string, string>>;
}
export interface CityNameDataset {
  format: 1;
  meta: { source: string; version: string; license: string };
  names: CityNameTable;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

export function decodeCityNames(raw: unknown): CityNameTable {
  if (
    !record(raw) ||
    raw.format !== 1 ||
    !record(raw.meta) ||
    !text(raw.meta.source) ||
    !text(raw.meta.version) ||
    !text(raw.meta.license) ||
    !record(raw.names)
  )
    throw new Error('Invalid city name dataset');
  const names = raw.names;
  const decode = (locale: 'hu' | 'sv'): Record<string, string> => {
    const table = names[locale];
    if (!record(table)) throw new Error(`Invalid city names: ${locale}`);
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(table)) {
      if (!/^[^|]+\|[A-Z]{2}$/.test(key) || key.slice(0, -3) !== key.slice(0, -3).trim() || !text(value))
        throw new Error(`Invalid city name: ${locale}/${key}`);
      result[key] = value;
    }
    return result;
  };
  return { hu: decode('hu'), sv: decode('sv') };
}

export async function loadCityNames(url: string, signal?: AbortSignal): Promise<CityNameTable> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`City names download failed: HTTP ${response.status}`);
  return decodeCityNames(await response.json());
}

export function localizedCity(airport: Airport, locale: string, table: CityNameTable | null | undefined): string {
  if (table && (locale === 'hu' || locale === 'sv')) {
    const key = `${airport.city}|${airport.countryCode}`;
    if (Object.hasOwn(table[locale], key)) return table[locale][key];
  }
  return displayCity(airport);
}
