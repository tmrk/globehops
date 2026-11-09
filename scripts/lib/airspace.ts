/**
 * Builds the compact airspace-avoidance dataset from the hand-maintained advisory list
 * (`data/airspace-advisories.json`) and the pinned Natural Earth country and marine polygons that
 * the label build already uses. Erasable TypeScript only: Node runs this file directly.
 */
import { simplifyLine } from './borders.ts';

export const AIRSPACE_PRECISION = 100;
export const AIRSPACE_SIMPLIFY_DEG = 0.05;
/** Islands and slivers smaller than this (square degrees) cannot change a route at globe scale. */
export const MIN_PART_AREA_DEG2 = 0.05;
export const MAX_ZONES = 32;
export const GEOMETRY_SOURCE =
  'Natural Earth 1:50m Admin 0 countries and geography marine polygons v5.1.2 (public domain)';
export const OPERATOR_GROUPS = ['easa', 'tco'] as const;
export type OperatorGroup = (typeof OPERATOR_GROUPS)[number];

type Point = [number, number]; // [lng, lat]
type Ring = Point[];
type Polygon = Ring[];

export type GeometrySpec =
  | { country: string; part?: [number, number]; maxLng?: number; exclude?: [number, number][] }
  | { marine: string; maxLng?: number };

export interface AdvisoryZone {
  id: string;
  name: string;
  place: string;
  reference: string;
  url: string;
  issued: string;
  revised: string | null;
  validUntil: string | null;
  ceilingFl: number | null;
  operators: OperatorGroup[];
  exemptCountries?: string[];
  approximate?: boolean;
  recommendation: string;
  geometry: GeometrySpec[];
  notes?: string;
}

export interface Advisories {
  reviewed: string;
  index: string;
  operators: Record<OperatorGroup, string>;
  zones: AdvisoryZone[];
  notModelled: { reference: string; name: string; url: string; validUntil: string | null; reason: string }[];
}

export interface AirspaceZoneRecord {
  id: string;
  name: string;
  place: string;
  reference: string;
  url: string;
  issued: string;
  validUntil: string | null;
  ceilingFl: number | null;
  operators: OperatorGroup[];
  exemptCountries: string[];
  approximate: boolean;
  /** Each ring: [lng0, lat0, Δlng, Δlat, …] in hundredths of a degree; rings combine even–odd. */
  rings: number[][];
}

export interface AirspaceDatasetFile {
  format: 1;
  precision: typeof AIRSPACE_PRECISION;
  reviewed: string;
  index: string;
  geometrySource: string;
  zones: AirspaceZoneRecord[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isLatLng = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  Math.abs(value[0] as number) <= 90 &&
  Math.abs(value[1] as number) <= 180;

function validateGeometry(spec: unknown, where: string): GeometrySpec {
  if (!isRecord(spec)) throw new Error(`${where}: geometry entries must be objects`);
  if (spec.maxLng !== undefined && (typeof spec.maxLng !== 'number' || Math.abs(spec.maxLng) > 180))
    throw new Error(`${where}: maxLng must be a longitude`);
  if (typeof spec.country === 'string') {
    if (!/^[A-Z]{2}$/.test(spec.country)) throw new Error(`${where}: country must be an ISO 3166-1 alpha-2 code`);
    if (spec.part !== undefined && !isLatLng(spec.part)) throw new Error(`${where}: part must be [lat, lng]`);
    if (spec.exclude !== undefined && (!Array.isArray(spec.exclude) || !spec.exclude.every(isLatLng)))
      throw new Error(`${where}: exclude must list [lat, lng] points`);
    return spec as GeometrySpec;
  }
  if (isText(spec.marine)) return spec as GeometrySpec;
  throw new Error(`${where}: geometry needs a country code or a marine polygon name`);
}

/** Validates the hand-maintained list; throws with the offending zone on any problem. */
export function decodeAdvisories(raw: unknown): Advisories {
  if (!isRecord(raw) || !isDate(raw.reviewed) || !isText(raw.index) || !Array.isArray(raw.zones))
    throw new Error('Invalid airspace advisories: expected reviewed date, index URL and zones');
  if (!isRecord(raw.operators) || !OPERATOR_GROUPS.every((group) => isText((raw.operators as never)[group])))
    throw new Error('Invalid airspace advisories: describe every operator group');
  if (raw.zones.length === 0 || raw.zones.length > MAX_ZONES)
    throw new Error(`Invalid airspace advisories: expected 1–${MAX_ZONES} zones`);
  const ids = new Set<string>();
  const zones = raw.zones.map((zone: unknown, index): AdvisoryZone => {
    const where = `Airspace zone ${index}`;
    if (!isRecord(zone)) throw new Error(`${where}: expected an object`);
    const id = zone.id;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id))
      throw new Error(`${where}: id must be unique lower-case kebab-case`);
    ids.add(id);
    for (const key of ['name', 'place', 'reference', 'url', 'recommendation'] as const)
      if (!isText(zone[key])) throw new Error(`Airspace zone ${id}: ${key} is required`);
    if (!/^https:\/\//.test(zone.url as string)) throw new Error(`Airspace zone ${id}: url must be https`);
    if (!isDate(zone.issued)) throw new Error(`Airspace zone ${id}: issued must be YYYY-MM-DD`);
    if (zone.revised !== null && !isDate(zone.revised))
      throw new Error(`Airspace zone ${id}: revised must be YYYY-MM-DD or null`);
    if (zone.validUntil !== null && !isDate(zone.validUntil))
      throw new Error(`Airspace zone ${id}: validUntil must be YYYY-MM-DD or null`);
    if (zone.validUntil !== null && (zone.validUntil as string) < (zone.issued as string))
      throw new Error(`Airspace zone ${id}: validUntil precedes issued`);
    if (zone.ceilingFl !== null && !(Number.isInteger(zone.ceilingFl) && (zone.ceilingFl as number) > 0))
      throw new Error(`Airspace zone ${id}: ceilingFl must be a flight level or null`);
    if (
      !Array.isArray(zone.operators) ||
      zone.operators.length === 0 ||
      !zone.operators.every((group) => (OPERATOR_GROUPS as readonly unknown[]).includes(group))
    )
      throw new Error(`Airspace zone ${id}: operators must list ${OPERATOR_GROUPS.join(' and/or ')}`);
    if (
      zone.exemptCountries !== undefined &&
      (!Array.isArray(zone.exemptCountries) ||
        !zone.exemptCountries.every((code) => typeof code === 'string' && /^[A-Z]{2}$/.test(code)))
    )
      throw new Error(`Airspace zone ${id}: exemptCountries must list ISO country codes`);
    if (zone.approximate !== undefined && typeof zone.approximate !== 'boolean')
      throw new Error(`Airspace zone ${id}: approximate must be boolean`);
    if (!Array.isArray(zone.geometry) || zone.geometry.length === 0)
      throw new Error(`Airspace zone ${id}: geometry is required`);
    const geometry = zone.geometry.map((spec: unknown) => validateGeometry(spec, `Airspace zone ${id}`));
    return { ...(zone as unknown as AdvisoryZone), geometry };
  });
  if (!Array.isArray(raw.notModelled)) throw new Error('Invalid airspace advisories: notModelled must be a list');
  for (const entry of raw.notModelled as unknown[])
    if (!isRecord(entry) || !isText(entry.reference) || !isText(entry.reason) || !isText(entry.url))
      throw new Error('Invalid airspace advisories: each notModelled entry needs a reference, URL and reason');
  return { ...(raw as unknown as Advisories), zones };
}

function polygonsOf(geometry: unknown): Polygon[] {
  if (!isRecord(geometry)) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates as Polygon];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Polygon[];
  return [];
}

function ringContains(ring: Ring, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polygonContains = (polygon: Polygon, [lat, lng]: [number, number]) =>
  polygon.reduce((inside, ring) => (ringContains(ring, lng, lat) ? !inside : inside), false);

/** Sutherland–Hodgman against the half-plane lng ≤ maxLng; degenerate output is dropped later. */
export function clipRingMaxLng(ring: Ring, maxLng: number): Ring {
  const out: Ring = [];
  const points =
    ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const previous = points[(i + points.length - 1) % points.length];
    const inside = current[0] <= maxLng;
    const wasInside = previous[0] <= maxLng;
    if (inside !== wasInside) {
      const t = (maxLng - previous[0]) / (current[0] - previous[0]);
      out.push([maxLng, previous[1] + t * (current[1] - previous[1])]);
    }
    if (inside) out.push(current);
  }
  return out;
}

export function ringAreaDeg2(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(sum) / 2;
}

/** Polygons for one geometry entry, before simplification. */
export function selectPolygons(spec: GeometrySpec, countries: unknown, marine: unknown): Polygon[] {
  const features = (source: unknown) =>
    isRecord(source) && Array.isArray(source.features) ? (source.features as unknown[]).filter(isRecord) : [];
  let polygons: Polygon[];
  if ('country' in spec) {
    const feature = features(countries).find((f) => {
      const p = isRecord(f.properties) ? f.properties : {};
      return p.ISO_A2_EH === spec.country || p.ISO_A2 === spec.country;
    });
    if (!feature) throw new Error(`Natural Earth has no country ${spec.country}`);
    polygons = polygonsOf(feature.geometry);
    if (spec.part) {
      polygons = polygons.filter((polygon) => polygonContains(polygon, spec.part!));
      if (polygons.length !== 1) throw new Error(`No single ${spec.country} part contains ${spec.part.join(', ')}`);
    }
    for (const point of spec.exclude ?? []) {
      const before = polygons.length;
      polygons = polygons.filter((polygon) => !polygonContains(polygon, point));
      if (polygons.length === before) throw new Error(`No ${spec.country} part contains excluded ${point.join(', ')}`);
    }
  } else {
    const feature = features(marine).find((f) => isRecord(f.properties) && f.properties.name === spec.marine);
    if (!feature) throw new Error(`Natural Earth has no marine polygon ${spec.marine}`);
    polygons = polygonsOf(feature.geometry);
  }
  if (spec.maxLng !== undefined) {
    const maxLng = spec.maxLng;
    polygons = polygons.map((polygon) => polygon.map((ring) => clipRingMaxLng(ring, maxLng)));
  }
  return polygons;
}

function quantise(ring: Ring): Ring {
  const out: Ring = [];
  for (const [lng, lat] of ring) {
    const point: Point = [Math.round(lng * AIRSPACE_PRECISION), Math.round(lat * AIRSPACE_PRECISION)];
    const last = out.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  if (out.length > 1 && out[0][0] === out.at(-1)![0] && out[0][1] === out.at(-1)![1]) out.pop();
  return out;
}

/** Simplifies a closed ring and returns it delta-encoded, or null when too small to matter. */
export function encodeRing(ring: Ring, toleranceDeg = AIRSPACE_SIMPLIFY_DEG): number[] | null {
  if (ring.length < 3) return null;
  const closed = ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring : [...ring, ring[0]];
  const simplified = quantise(simplifyLine(closed, toleranceDeg));
  if (simplified.length < 3 || ringAreaDeg2(simplified) / AIRSPACE_PRECISION ** 2 < MIN_PART_AREA_DEG2) return null;
  const encoded: number[] = [];
  let previous: Point = [0, 0];
  for (const point of simplified) {
    encoded.push(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return encoded;
}

export function buildAirspace(advisories: Advisories, countries: unknown, marine: unknown): AirspaceDatasetFile {
  return {
    format: 1,
    precision: AIRSPACE_PRECISION,
    reviewed: advisories.reviewed,
    index: advisories.index,
    geometrySource: GEOMETRY_SOURCE,
    zones: advisories.zones.map((zone) => {
      const rings: number[][] = [];
      for (const spec of zone.geometry)
        for (const polygon of selectPolygons(spec, countries, marine)) {
          // A polygon whose outer ring is too small to matter drops its holes too.
          const [outer, ...holes] = polygon.map((ring) => encodeRing(ring));
          if (!outer) continue;
          rings.push(outer);
          for (const hole of holes) if (hole) rings.push(hole);
        }
      return {
        id: zone.id,
        name: zone.name,
        place: zone.place,
        reference: zone.reference,
        url: zone.url,
        issued: zone.issued,
        validUntil: zone.validUntil,
        ceilingFl: zone.ceilingFl,
        operators: zone.operators,
        exemptCountries: zone.exemptCountries ?? [],
        approximate: zone.approximate ?? false,
        rings,
      };
    }),
  };
}

/** Throws when a zone lost its geometry or the file is implausibly large; returns the point count. */
export function validateAirspace(dataset: AirspaceDatasetFile, maxPoints = 12_000): number {
  let points = 0;
  for (const zone of dataset.zones) {
    if (!zone.rings.length) throw new Error(`Airspace zone ${zone.id} has no geometry`);
    for (const ring of zone.rings) points += ring.length / 2;
  }
  if (points > maxPoints) throw new Error(`Airspace dataset has ${points} points; expected at most ${maxPoints}`);
  return points;
}
