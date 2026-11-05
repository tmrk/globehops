import type { Airport } from '../types.ts';

export interface TimeZoneMeta {
  source: string;
  release: string;
  license: string;
  attribution: string;
  generatedAt: string;
  airportsContentHash: string;
  counts: { airports: number; zones: number; nearest: number; overrides: number };
}

export interface TimeZoneTable {
  meta: TimeZoneMeta;
  zones: string[];
  byAirportId: Map<number, string>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Validate the wire format independently of the browser's tzdb vintage or current airport dataset hash. */
export function decodeTimeZones(raw: unknown): TimeZoneTable {
  if (
    !object(raw) ||
    raw.format !== 1 ||
    !object(raw.meta) ||
    !Array.isArray(raw.zones) ||
    !Array.isArray(raw.ids) ||
    !Array.isArray(raw.zone)
  )
    throw new Error('Invalid time-zone dataset format');
  const meta = raw.meta;
  if (
    !nonempty(meta.source) ||
    !nonempty(meta.release) ||
    !nonempty(meta.license) ||
    !nonempty(meta.attribution) ||
    !nonempty(meta.generatedAt) ||
    !Number.isFinite(Date.parse(meta.generatedAt)) ||
    new Date(meta.generatedAt).toISOString() !== meta.generatedAt ||
    typeof meta.airportsContentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(meta.airportsContentHash) ||
    !object(meta.counts)
  )
    throw new Error('Invalid time-zone metadata');
  const counts = meta.counts;
  if (
    !count(counts.airports) ||
    !count(counts.zones) ||
    !count(counts.nearest) ||
    !count(counts.overrides) ||
    counts.airports !== raw.ids.length ||
    counts.zones !== raw.zones.length ||
    counts.nearest + counts.overrides > counts.airports ||
    raw.zone.length !== raw.ids.length
  )
    throw new Error('Invalid time-zone counts or array lengths');
  const zones: string[] = [];
  for (const zone of raw.zones) {
    if (
      typeof zone !== 'string' ||
      !/^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/.test(zone) ||
      (zones.length > 0 && zones[zones.length - 1] >= zone)
    )
      throw new Error('Invalid or unsorted time-zone names');
    zones.push(zone);
  }
  const byAirportId = new Map<number, string>();
  const used = new Set<number>();
  let id = 0;
  for (let i = 0; i < raw.ids.length; i++) {
    const delta: unknown = raw.ids[i];
    const index: unknown = raw.zone[i];
    if (!count(delta) || delta === 0 || !Number.isSafeInteger(id + delta) || !count(index) || index >= zones.length)
      throw new Error('Invalid airport ID delta or time-zone index');
    id += delta;
    byAirportId.set(id, zones[index]);
    used.add(index);
  }
  if (used.size !== zones.length) throw new Error('Unused time-zone names');
  return { meta: meta as unknown as TimeZoneMeta, zones, byAirportId };
}

export async function loadTimeZones(url: string, signal?: AbortSignal): Promise<TimeZoneTable> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Time-zone download failed: HTTP ${response.status}`);
  return decodeTimeZones(await response.json());
}

/** Airport refreshes can temporarily outpace this separate database; missing IDs stay usable. */
export function zoneForAirport(table: TimeZoneTable | null, airport: Pick<Airport, 'id'>): string | null {
  return table?.byAirportId.get(airport.id) ?? null;
}
