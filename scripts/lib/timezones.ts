/** Pure TBB parsing, spatial lookup and compact airport time-zone database generation. */
import { decodeDataset } from '../../src/data/airports.ts';
import { decodeTimeZones } from '../../src/data/timezones.ts';
import type { TimeZoneMeta } from '../../src/data/timezones.ts';
import type { Airport, LatLng } from '../../src/types.ts';

export const TIMEZONE_RELEASE = '2026f';
export const TIMEZONE_SOURCE_URL = `https://github.com/evansiroky/timezone-boundary-builder/releases/download/${TIMEZONE_RELEASE}/timezones.geojson.zip`;
export const TIMEZONE_ZIP_SHA256 = '2d160501c844d382233f30b0cd0db2533fe17f93a118a3d38959fe73e3ac20c3';
export const NEAREST_LIMIT_KM = 30;
export const SENTINELS: Readonly<Record<string, string>> = {
  CPH: 'Europe/Copenhagen',
  LHR: 'Europe/London',
  JFK: 'America/New_York',
  LAX: 'America/Los_Angeles',
  PHX: 'America/Phoenix',
  IND: 'America/Indiana/Indianapolis',
  DEN: 'America/Denver',
  ORD: 'America/Chicago',
  ANC: 'America/Anchorage',
  HNL: 'Pacific/Honolulu',
  YYZ: 'America/Toronto',
  MEX: 'America/Mexico_City',
  CUN: 'America/Cancun',
  GRU: 'America/Sao_Paulo',
  SYD: 'Australia/Sydney',
  BNE: 'Australia/Brisbane',
  ADL: 'Australia/Adelaide',
  PER: 'Australia/Perth',
  AKL: 'Pacific/Auckland',
  NRT: 'Asia/Tokyo',
  DEL: 'Asia/Kolkata',
  KTM: 'Asia/Kathmandu',
  DXB: 'Asia/Dubai',
  SIN: 'Asia/Singapore',
  HKG: 'Asia/Hong_Kong',
  PEK: 'Asia/Shanghai',
  IST: 'Europe/Istanbul',
  SVO: 'Europe/Moscow',
  VVO: 'Asia/Vladivostok',
  KEF: 'Atlantic/Reykjavik',
};

type Position = [number, number];
interface Bounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}
export interface ZonePolygon {
  zone: string;
  rings: Position[][];
  bounds: Bounds;
}
export interface TimeZoneOverride {
  zone: string;
  reason: string;
}
export interface TimeZoneDataset {
  format: 1;
  meta: TimeZoneMeta;
  zones: string[];
  ids: number[];
  zone: number[];
}
export interface Assignment {
  id: number;
  ident: string;
  zone: string;
}
export interface TimeZoneReport {
  nearest: (Assignment & { distanceKm: number })[];
  overrides: (Assignment & { reason: string })[];
  overlaps: (Assignment & { candidates: string[] })[];
  unusedOverrides: string[];
}
export interface LookupResult {
  zone: string;
  method: 'polygon' | 'nearest';
  candidates: string[];
  distanceKm: number;
}
const R = 6371.0088;
const RAD = Math.PI / 180;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseTimeZonePolygons(raw: unknown): ZonePolygon[] {
  if (!object(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features) || !raw.features.length)
    throw new Error('Time zones source must be a nonempty GeoJSON FeatureCollection');
  const polygons: ZonePolygon[] = [];
  for (const [i, feature] of raw.features.entries()) {
    if (
      !object(feature) ||
      feature.type !== 'Feature' ||
      !object(feature.properties) ||
      typeof feature.properties.tzid !== 'string' ||
      !feature.properties.tzid.trim() ||
      !object(feature.geometry)
    )
      throw new Error(`Invalid time-zone feature ${i}`);
    const { type, coordinates } = feature.geometry;
    if ((type !== 'Polygon' && type !== 'MultiPolygon') || !Array.isArray(coordinates) || !coordinates.length)
      throw new Error(`Invalid time-zone geometry in feature ${i}`);
    const parts: unknown[] = type === 'Polygon' ? [coordinates] : coordinates;
    for (const part of parts) {
      if (!Array.isArray(part) || !part.length) throw new Error(`Missing polygon rings in feature ${i}`);
      const bounds: Bounds = { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity };
      for (const ring of part) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error(`Invalid polygon ring in feature ${i}`);
        for (const point of ring) {
          if (
            !Array.isArray(point) ||
            point.length !== 2 ||
            typeof point[0] !== 'number' ||
            typeof point[1] !== 'number' ||
            !Number.isFinite(point[0]) ||
            !Number.isFinite(point[1]) ||
            Math.abs(point[0]) > 180 ||
            Math.abs(point[1]) > 90
          )
            throw new Error(`Invalid polygon coordinate in feature ${i}`);
          bounds.minLng = Math.min(bounds.minLng, point[0]);
          bounds.maxLng = Math.max(bounds.maxLng, point[0]);
          bounds.minLat = Math.min(bounds.minLat, point[1]);
          bounds.maxLat = Math.max(bounds.maxLat, point[1]);
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
          throw new Error(`Unclosed polygon ring in feature ${i}`);
      }
      // TBB splits polygons at ±180°. Keep those planar coordinates; wrapping every edge would
      // turn a wide polar polygon inside out. Query both representations of the date line instead.
      polygons.push({ zone: feature.properties.tzid, rings: part as Position[][], bounds });
    }
  }
  if (!polygons.length) throw new Error('No time-zone polygons');
  return polygons;
}

/** Even-odd ray casting across exterior and holes; a point exactly on any edge belongs to the boundary. */
export function pointInPolygon(point: LatLng, polygon: ZonePolygon): boolean {
  let inside = false;
  const { lat: y, lng: x } = point;
  for (const ring of polygon.rings) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1],
        [bx, by] = ring[i];
      if (
        x >= Math.min(ax, bx) &&
        x <= Math.max(ax, bx) &&
        y >= Math.min(ay, by) &&
        y <= Math.max(ay, by) &&
        Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-12
      )
        return true;
      if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
    }
  }
  return inside;
}

const clamp = (n: number) => Math.max(-1, Math.min(1, n));
function angularDistance(a: LatLng, b: LatLng): number {
  const h =
    Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lng - a.lng) * RAD) / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
function bearing(a: LatLng, b: LatLng): number {
  const delta = (b.lng - a.lng) * RAD;
  return Math.atan2(
    Math.sin(delta) * Math.cos(b.lat * RAD),
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(delta),
  );
}
/** Spherical distance to the minor great-circle edge, including its endpoints. */
export function distanceToEdgeKm(point: LatLng, a: LatLng, b: LatLng): number {
  const length = angularDistance(a, b),
    fromA = angularDistance(a, point);
  if (length < 1e-12) return fromA * R;
  const angle = bearing(a, point) - bearing(a, b);
  const along = Math.atan2(Math.sin(fromA) * Math.cos(angle), Math.cos(fromA));
  if (along < 0 || along > length) return Math.min(fromA, angularDistance(b, point)) * R;
  return Math.abs(Math.asin(clamp(Math.sin(fromA) * Math.sin(angle)))) * R;
}

function nearBounds(point: LatLng, bounds: Bounds, km: number): boolean {
  const latPad = km / R / RAD;
  if (point.lat < bounds.minLat - latPad || point.lat > bounds.maxLat + latPad) return false;
  const lngPad = Math.abs(point.lat) + latPad >= 90 ? 180 : latPad / Math.cos((Math.abs(point.lat) + latPad) * RAD);
  return [-360, 0, 360].some(
    (shift) => point.lng + shift >= bounds.minLng - lngPad && point.lng + shift <= bounds.maxLng + lngPad,
  );
}

/** On overlaps or equal nearest distances choose lexicographically, independent of feature order. */
export function lookupTimeZone(point: LatLng, polygons: ZonePolygon[]): LookupResult | null {
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  )
    throw new Error('Invalid lookup coordinates');
  const matches = new Set<string>();
  for (const polygon of polygons) {
    if (!nearBounds(point, polygon.bounds, 0)) continue;
    if (
      [0, -360, 360].some((shift) => {
        const lng = point.lng + shift;
        return (
          lng >= polygon.bounds.minLng &&
          lng <= polygon.bounds.maxLng &&
          pointInPolygon({ lat: point.lat, lng }, polygon)
        );
      })
    )
      matches.add(polygon.zone);
  }
  if (matches.size) {
    const candidates = [...matches].sort();
    return { zone: candidates[0], method: 'polygon', candidates, distanceKm: 0 };
  }
  let nearest: LookupResult | null = null;
  for (const polygon of polygons) {
    if (!nearBounds(point, polygon.bounds, NEAREST_LIMIT_KM)) continue;
    for (const ring of polygon.rings) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1],
          [bx, by] = ring[i];
        const distanceKm = distanceToEdgeKm(point, { lng: ax, lat: ay }, { lng: bx, lat: by });
        if (distanceKm > NEAREST_LIMIT_KM) continue;
        if (
          !nearest ||
          distanceKm < nearest.distanceKm - 1e-9 ||
          (Math.abs(distanceKm - nearest.distanceKm) <= 1e-9 && polygon.zone < nearest.zone)
        )
          nearest = { zone: polygon.zone, method: 'nearest', candidates: [polygon.zone], distanceKm };
      }
    }
  }
  return nearest;
}

export function parseOverrides(raw: unknown): Record<string, TimeZoneOverride> {
  if (!object(raw)) throw new Error('Time-zone overrides must be an object');
  const result: Record<string, TimeZoneOverride> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (
      !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      !object(value) ||
      Object.keys(value).some((key) => key !== 'zone' && key !== 'reason') ||
      typeof value.zone !== 'string' ||
      !value.zone.trim() ||
      typeof value.reason !== 'string' ||
      !value.reason.trim()
    )
      throw new Error(`Invalid time-zone override ${id}: zone and reason required`);
    result[id] = { zone: value.zone, reason: value.reason };
  }
  validateSupportedZones(Object.values(result).map((value) => value.zone));
  return result;
}

export function validateSupportedZones(zones: Iterable<string>): void {
  const unsupported: string[] = [];
  for (const zone of new Set(zones)) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      unsupported.push(zone);
    }
  }
  if (unsupported.length) throw new Error(`Time zones unsupported by Node Intl: ${unsupported.sort().join(', ')}`);
}

export function validateSentinels(
  airports: Airport[],
  assignments: Map<number, string>,
  sentinels: Readonly<Record<string, string>> = SENTINELS,
): void {
  for (const [iata, expected] of Object.entries(sentinels)) {
    const airport = airports.find((airport) => airport.iata === iata);
    const actual = airport && assignments.get(airport.id);
    if (actual !== expected)
      throw new Error(`Time-zone sentinel ${iata}: expected ${expected}, got ${actual ?? 'missing'}`);
  }
}

export function buildTimeZones(
  raw: unknown,
  airportRaw: unknown,
  overrideRaw: unknown,
  options: { generatedAt?: string; sentinels?: Readonly<Record<string, string>> } = {},
): { dataset: TimeZoneDataset; report: TimeZoneReport } {
  const { airports } = decodeDataset(airportRaw);
  if (
    !object(airportRaw) ||
    !object(airportRaw.meta) ||
    typeof airportRaw.meta.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(airportRaw.meta.contentHash)
  )
    throw new Error('Missing airport content hash');
  const polygons = parseTimeZonePolygons(raw);
  const overrides = parseOverrides(overrideRaw);
  const report: TimeZoneReport = { nearest: [], overrides: [], overlaps: [], unusedOverrides: [] };
  const assigned = new Map<number, string>();
  const unresolved: string[] = [];
  for (const airport of [...airports].sort((a, b) => a.id - b.id)) {
    const match = lookupTimeZone(airport, polygons);
    const override = overrides[String(airport.id)];
    if (match) {
      const assignment = { id: airport.id, ident: airport.ident, zone: match.zone };
      assigned.set(airport.id, match.zone);
      if (match.method === 'nearest') report.nearest.push({ ...assignment, distanceKm: match.distanceKm });
      if (match.candidates.length > 1) report.overlaps.push({ ...assignment, candidates: match.candidates });
    } else if (override) {
      assigned.set(airport.id, override.zone);
      report.overrides.push({ id: airport.id, ident: airport.ident, ...override });
    } else unresolved.push(`${airport.id} ${airport.ident} (${airport.iata ?? '-'}; ${airport.lat}, ${airport.lng})`);
  }
  if (unresolved.length)
    throw new Error(`No time zone within ${NEAREST_LIMIT_KM} km; overrides required:\n${unresolved.join('\n')}`);
  validateSupportedZones(assigned.values());
  validateSentinels(airports, assigned, options.sentinels);
  report.unusedOverrides = Object.keys(overrides)
    .filter((id) => !report.overrides.some((entry) => entry.id === Number(id)))
    .sort();
  const zones = [...new Set(assigned.values())].sort();
  const indices = new Map(zones.map((zone, index) => [zone, index]));
  const ids: number[] = [],
    zone: number[] = [];
  let previousId = 0;
  for (const [id, name] of assigned) {
    ids.push(id - previousId);
    zone.push(indices.get(name)!);
    previousId = id;
  }
  const dataset: TimeZoneDataset = {
    format: 1,
    meta: {
      source: `timezone-boundary-builder ${TIMEZONE_RELEASE} (timezones.geojson)`,
      release: TIMEZONE_RELEASE,
      license: 'ODbL-1.0',
      attribution:
        'Contains information from timezone-boundary-builder, which is made available under the Open Database License (ODbL); boundaries derived from OpenStreetMap © OpenStreetMap contributors.',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      airportsContentHash: airportRaw.meta.contentHash,
      counts: {
        airports: airports.length,
        zones: zones.length,
        nearest: report.nearest.length,
        overrides: report.overrides.length,
      },
    },
    zones,
    ids,
    zone,
  };
  const table = decodeTimeZones(dataset);
  if (table.byAirportId.size !== airports.length || airports.some((airport) => !table.byAirportId.has(airport.id)))
    throw new Error('Incomplete time-zone coverage');
  return { dataset, report };
}
