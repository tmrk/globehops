/** Conservative, country- and distance-checked Natural Earth city matching; no browser dependencies. */
import type { Airport } from '../../src/types.ts';
import type { LabelKind, LabelLocale } from '../../src/lib/countryLabels.ts';
import { displayCity } from '../../src/data/airports.ts';
import { decodeCityNames, type CityNameDataset } from '../../src/data/placeNames.ts';
import { greatCircleDistanceKm } from '../../src/lib/geo.ts';
import { normalizeText } from '../../src/lib/normalize.ts';

export const PLACE_NAMES_SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places.geojson';
export interface LabelOverride {
  kind: LabelKind;
  key: string;
  names: Partial<Record<LabelLocale, string>>;
  /** [latitude, longitude], always in open water for marine labels. */
  point?: [number, number];
  reason: string;
}
export interface PlaceNameOverrides {
  cities: { key: string; names: Partial<Record<'hu' | 'sv', string | null>>; reason: string }[];
  labels: LabelOverride[];
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value === value.trim();

export function decodePlaceNameOverrides(raw: unknown): PlaceNameOverrides {
  if (!record(raw) || raw.format !== 1 || !Array.isArray(raw.cities) || !Array.isArray(raw.labels))
    throw new Error('Invalid place-name overrides');
  const seen = new Set<string>();
  for (const [kind, entries] of [
    ['city', raw.cities],
    ['label', raw.labels],
  ] as const) {
    for (const entry of entries) {
      if (!record(entry) || !text(entry.key) || !text(entry.reason) || !record(entry.names))
        throw new Error('Invalid place-name override');
      const identity = `${kind}|${kind === 'label' ? String(entry.kind) : ''}|${entry.key}`;
      if (seen.has(identity)) throw new Error(`Duplicate place-name override: ${identity}`);
      seen.add(identity);
      const locales = kind === 'city' ? ['hu', 'sv'] : ['en', 'hu', 'sv'];
      if (
        Object.entries(entry.names).some(
          ([locale, name]) => !locales.includes(locale) || !(text(name) || (kind === 'city' && name === null)),
        )
      )
        throw new Error(`Invalid override names: ${entry.key}`);
      if (kind === 'city' && !/^[^|]+\|[A-Z]{2}$/.test(entry.key))
        throw new Error(`Invalid city override key: ${entry.key}`);
      if (kind === 'label') {
        if (!['country', 'ocean', 'sea'].includes(String(entry.kind))) throw new Error('Invalid override kind');
        const p = entry.point;
        if (
          p !== undefined &&
          (!Array.isArray(p) ||
            p.length !== 2 ||
            !p.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
            Math.abs(p[0]) > 90 ||
            Math.abs(p[1]) > 180)
        )
          throw new Error(`Invalid override point: ${entry.key}`);
      }
    }
  }
  return raw as unknown as PlaceNameOverrides;
}

interface Place {
  names: string[];
  hu: string | null;
  sv: string | null;
  lat: number;
  lng: number;
}
/** NE uses -99 for these three de facto entities; map to OurAirports' country codes. */
const COUNTRY_CODES: Readonly<Record<string, string>> = { KOS: 'XK', CYN: 'CY', SOL: 'SO' };

export function buildPlaceNames(
  raw: unknown,
  airports: readonly Airport[],
  overrides: PlaceNameOverrides = { cities: [], labels: [] },
): {
  dataset: CityNameDataset;
  stats: {
    cities: number;
    matchedCities: number;
    ambiguousCities: number;
    scheduled: number;
    matchedScheduled: number;
  };
} {
  if (!record(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features))
    throw new Error('Place-name source must be a GeoJSON FeatureCollection');
  const index = new Map<string, Place[]>();
  for (const feature of raw.features) {
    if (!record(feature) || feature.type !== 'Feature' || !record(feature.properties))
      throw new Error('Invalid populated place feature');
    const p = feature.properties;
    const country =
      typeof p.ISO_A2 === 'string' && /^[A-Z]{2}$/.test(p.ISO_A2)
        ? p.ISO_A2
        : typeof p.ADM0_A3 === 'string'
          ? COUNTRY_CODES[p.ADM0_A3]
          : undefined;
    if (
      !country ||
      typeof p.LATITUDE !== 'number' ||
      typeof p.LONGITUDE !== 'number' ||
      !Number.isFinite(p.LATITUDE) ||
      !Number.isFinite(p.LONGITUDE) ||
      Math.abs(p.LATITUDE) > 90 ||
      Math.abs(p.LONGITUDE) > 180
    )
      continue;
    const names = [
      ...new Set(
        [p.NAME, p.NAME_EN, p.NAMEASCII, ...(typeof p.NAMEALT === 'string' ? p.NAMEALT.split('|') : [])]
          .filter((v): v is string => typeof v === 'string' && !!v.trim())
          .map(normalizeText)
          .filter(Boolean),
      ),
    ];
    const place: Place = {
      names,
      lat: p.LATITUDE,
      lng: p.LONGITUDE,
      hu: text(p.NAME_HU) ? p.NAME_HU : null,
      sv: text(p.NAME_SV) ? p.NAME_SV : null,
    };
    for (const name of names) {
      const key = `${name}|${country}`;
      const list = index.get(key);
      if (list) list.push(place);
      else index.set(key, [place]);
    }
  }
  const cities = new Map<string, Airport[]>();
  for (const airport of airports) {
    if (!airport.city) continue;
    const key = `${airport.city}|${airport.countryCode}`;
    const list = cities.get(key);
    if (list) list.push(airport);
    else cities.set(key, [airport]);
  }
  const names: { hu: Record<string, string>; sv: Record<string, string> } = { hu: {}, sv: {} };
  let matchedCities = 0,
    ambiguousCities = 0,
    matchedScheduled = 0;
  for (const [key, group] of cities) {
    const airport = group[0];
    const candidates = new Set<Place>();
    for (const name of new Set([normalizeText(airport.city), normalizeText(displayCity(airport))])) {
      for (const place of index.get(`${name}|${airport.countryCode}`) ?? []) {
        if (group.some((a) => greatCircleDistanceKm(a, place) <= 75)) candidates.add(place);
      }
    }
    if (candidates.size > 1) ambiguousCities++;
    if (candidates.size !== 1) continue;
    matchedCities++;
    matchedScheduled += group.filter((a) => a.scheduled).length;
    const place = [...candidates][0];
    for (const locale of ['hu', 'sv'] as const) {
      if (place[locale] && place[locale] !== displayCity(airport)) names[locale][key] = place[locale];
    }
  }
  for (const override of overrides.cities) {
    // A current exact city/country key is required; overrides never spill into namesakes.
    const group = cities.get(override.key);
    if (!group) continue;
    for (const locale of ['hu', 'sv'] as const) {
      const name = override.names[locale];
      if (name === null || name === displayCity(group[0])) delete names[locale][override.key];
      else if (name !== undefined) names[locale][override.key] = name;
    }
  }
  const dataset: CityNameDataset = {
    format: 1,
    meta: {
      source: PLACE_NAMES_SOURCE_URL,
      version: '5.1.2',
      license: 'Public domain (Natural Earth); CC0 (Wikidata names)',
    },
    names: {
      hu: Object.fromEntries(Object.entries(names.hu).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      sv: Object.fromEntries(Object.entries(names.sv).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    },
  };
  decodeCityNames(dataset);
  return {
    dataset,
    stats: {
      cities: cities.size,
      matchedCities,
      ambiguousCities,
      scheduled: airports.filter((a) => a.scheduled).length,
      matchedScheduled,
    },
  };
}
