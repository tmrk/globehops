/** Decodes the generated airspace-avoidance dataset (see data/AIRSPACE.md). */

export type OperatorGroup = 'easa' | 'tco';

export interface AirspaceZone {
  id: string;
  /** English name, for logs and fallbacks; the UI names zones by `place`. */
  name: string;
  /** ISO 3166-1 alpha-2 country, or a marine slug such as `persian-gulf`. */
  place: string;
  reference: string;
  url: string;
  /** First day (UTC, YYYY-MM-DD) the advisory applies. */
  issued: string;
  /** Last day it applies, or null while it has no published end. */
  validUntil: string | null;
  /** Applies only to flights that stay at or below this flight level; null means every level. */
  ceilingFl: number | null;
  operators: OperatorGroup[];
  /** Flights to or from these countries are exempt (e.g. arrivals at Gulf airports). */
  exemptCountries: string[];
  /** True when the geometry is a documented approximation of the advisory's area. */
  approximate: boolean;
  /** Each ring is [lng, lat, lng, lat, …] in degrees; rings combine even–odd. */
  rings: Float64Array[];
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export interface AirspaceDataset {
  reviewed: string;
  index: string;
  zones: AirspaceZone[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isCodes = (value: unknown, pattern: RegExp): value is string[] =>
  Array.isArray(value) && value.every((code) => typeof code === 'string' && pattern.test(code));

/** Throws Error on malformed metadata or geometry. */
export function decodeAirspace(raw: unknown): AirspaceDataset {
  if (
    !isRecord(raw) ||
    raw.format !== 1 ||
    raw.precision !== 100 ||
    typeof raw.reviewed !== 'string' ||
    !DATE.test(raw.reviewed) ||
    !isText(raw.index) ||
    !Array.isArray(raw.zones) ||
    raw.zones.length > 32
  )
    throw new Error('Invalid airspace dataset: expected format 1, precision 100, reviewed date and ≤ 32 zones');
  const precision = raw.precision;
  const zones = raw.zones.map((zone: unknown, index): AirspaceZone => {
    if (
      !isRecord(zone) ||
      !isText(zone.id) ||
      !isText(zone.name) ||
      !isText(zone.place) ||
      !isText(zone.reference) ||
      !isText(zone.url) ||
      typeof zone.issued !== 'string' ||
      !DATE.test(zone.issued) ||
      !(zone.validUntil === null || (typeof zone.validUntil === 'string' && DATE.test(zone.validUntil))) ||
      !(zone.ceilingFl === null || (typeof zone.ceilingFl === 'number' && zone.ceilingFl > 0)) ||
      !isCodes(zone.operators, /^(easa|tco)$/) ||
      !isCodes(zone.exemptCountries, /^[A-Z]{2}$/) ||
      typeof zone.approximate !== 'boolean' ||
      !Array.isArray(zone.rings) ||
      zone.rings.length === 0
    )
      throw new Error(`Invalid airspace zone ${index}: missing or malformed metadata`);
    const bbox = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
    const rings = zone.rings.map((encoded: unknown, ring) => {
      if (
        !Array.isArray(encoded) ||
        encoded.length < 6 ||
        encoded.length % 2 !== 0 ||
        !encoded.every((n) => Number.isSafeInteger(n))
      )
        throw new Error(`Invalid airspace zone ${zone.id}, ring ${ring}: expected at least three integer pairs`);
      const out = new Float64Array(encoded.length);
      let lng = 0;
      let lat = 0;
      for (let i = 0; i < encoded.length; i += 2) {
        lng += encoded[i] as number;
        lat += encoded[i + 1] as number;
        if (Math.abs(lng) > 180 * precision || Math.abs(lat) > 90 * precision)
          throw new Error(`Invalid airspace zone ${zone.id}, ring ${ring}: coordinate out of range`);
        out[i] = lng / precision;
        out[i + 1] = lat / precision;
        bbox.minLng = Math.min(bbox.minLng, out[i]);
        bbox.maxLng = Math.max(bbox.maxLng, out[i]);
        bbox.minLat = Math.min(bbox.minLat, out[i + 1]);
        bbox.maxLat = Math.max(bbox.maxLat, out[i + 1]);
      }
      return out;
    });
    return {
      id: zone.id,
      name: zone.name,
      place: zone.place,
      reference: zone.reference,
      url: zone.url,
      issued: zone.issued,
      validUntil: zone.validUntil as string | null,
      ceilingFl: zone.ceilingFl as number | null,
      operators: zone.operators as OperatorGroup[],
      exemptCountries: zone.exemptCountries,
      approximate: zone.approximate,
      rings,
      bbox,
    };
  });
  if (new Set(zones.map((zone) => zone.id)).size !== zones.length) throw new Error('Duplicate airspace zone ids');
  return { reviewed: raw.reviewed, index: raw.index, zones };
}

/** Exact even–odd test in longitude/latitude; the generated rings never cross the antimeridian. */
export function zoneContains(zone: AirspaceZone, lat: number, lng: number): boolean {
  const { bbox } = zone;
  if (lat < bbox.minLat || lat > bbox.maxLat || lng < bbox.minLng || lng > bbox.maxLng) return false;
  let inside = false;
  for (const ring of zone.rings) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const xi = ring[i],
        yi = ring[i + 1],
        xj = ring[j],
        yj = ring[j + 1];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export async function loadAirspace(url: string, signal?: AbortSignal): Promise<AirspaceDataset> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Airspace download failed: HTTP ${response.status}`);
  return decodeAirspace(await response.json());
}
