/** Pure extraction of Natural Earth's multilingual cartographic labels. */
import { decodeCountryLabels, labelPriority, type MapLabelTuple } from '../../src/lib/countryLabels.ts';
import { normalizeLng } from '../../src/lib/geo.ts';
import { record, type PlaceNameOverrides } from './placeNames.ts';

export const COUNTRY_LABEL_SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';
export const MARINE_LABEL_SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_geography_marine_polys.geojson';
const MIN_COUNTRY_LABELS = 180;
export interface CountryLabelDataset {
  format: 2;
  meta: { source: string; version: string; license: string };
  /** kind, English, Hungarian, Swedish, latitude, longitude, minimum zoom, rank */
  labels: MapLabelTuple[];
}
type Point = [number, number];
type Polygon = Point[][];
function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
const round = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

function features(raw: unknown): Record<string, unknown>[] {
  if (!record(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features))
    throw new Error('Country labels source must be a GeoJSON FeatureCollection');
  return raw.features.map((feature: unknown) => {
    if (!record(feature) || feature.type !== 'Feature') throw new Error('Invalid country label feature');
    return feature;
  });
}

/** Unwrap each ring before measuring it; keep holes in the same longitude interval as the exterior. */
function polygons(raw: unknown): Polygon[] {
  if (!record(raw) || !['Polygon', 'MultiPolygon'].includes(String(raw.type)) || !Array.isArray(raw.coordinates))
    throw new Error('Invalid marine geometry');
  const parts: unknown[] = raw.type === 'Polygon' ? [raw.coordinates] : raw.coordinates;
  return parts.map((part) => {
    if (!Array.isArray(part) || !part.length) throw new Error('Invalid marine polygon');
    let origin = 0;
    return part.map((ring: unknown, ringIndex: number): Point[] => {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid marine ring');
      let previous = 0;
      // Polar caps deliberately span the complete longitude range along the pole.
      const polar = ring.some((p: unknown) => Array.isArray(p) && Math.abs(Number(p[1])) === 90);
      const points = ring.map((coordinate: unknown, index: number): Point => {
        if (!Array.isArray(coordinate) || !inRange(coordinate[0], -180, 180) || !inRange(coordinate[1], -90, 90))
          throw new Error('Invalid marine coordinate');
        const [lng, lat] = coordinate;
        const x = index && !polar ? previous + normalizeLng(lng - previous) : lng;
        previous = x;
        return [x, lat];
      });
      const center = points.reduce((sum, p) => sum + p[0], 0) / points.length;
      if (!ringIndex) origin = center;
      const shift = Math.round((origin - center) / 360) * 360;
      return points.map(([x, y]) => [x + shift, y]);
    });
  });
}

function area(ring: Point[]): number {
  return Math.abs(
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2,
  );
}

/** Signed distance to all polygon edges, with holes excluded by the even/odd rule. */
function distance(x: number, y: number, polygon: Polygon): number {
  let inside = false,
    minimum = Infinity;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = dx || dy ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
      minimum = Math.min(minimum, (x - a[0] - dx * t) ** 2 + (y - a[1] - dy * t) ** 2);
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minimum);
}

/** Coarse containment check used to validate computed and hand-placed marine points. */
export function marineContainsPoint(geometry: unknown, lat: number, lng: number): boolean {
  return polygons(geometry).some((polygon) => {
    const origin = polygon[0][0][0];
    const x = origin + normalizeLng(lng - origin);
    return distance(x, lat, polygon) >= -1e-8;
  });
}

interface Cell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}
/** Best-first square subdivision (polylabel-style), with a small binary max heap. */
function pole(polygon: Polygon): Point {
  const xs = polygon[0].map((p) => p[0]),
    ys = polygon[0].map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  const cell = (x: number, y: number, h: number): Cell => {
    const d = distance(x, y, polygon);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  const heap: Cell[] = [];
  const push = (value: Cell) => {
    let i = heap.length;
    heap.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].max >= value.max) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = value;
  };
  const pop = (): Cell => {
    const top = heap[0],
      tail = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].max > heap[child].max) child++;
        if (heap[child].max <= tail.max) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = tail;
    }
    return top;
  };
  let best = cell((x0 + x1) / 2, (y0 + y1) / 2, 0);
  push(cell(best.x, best.y, Math.max(x1 - x0, y1 - y0) / 2));
  while (heap.length) {
    const current = pop();
    if (current.d > best.d) best = current;
    if (current.max - best.d <= 0.02) continue;
    const h = current.h / 2;
    for (const dx of [-h, h]) for (const dy of [-h, h]) push(cell(current.x + dx, current.y + dy, h));
  }
  return [best.x, best.y];
}

/** Largest polygon by cos(latitude)-scaled area, including antimeridian-crossing rings. */
export function marineLabelPoint(geometry: unknown): { lat: number; lng: number } {
  const candidates = polygons(geometry)
    .map((polygon) => {
      const lat = polygon[0].reduce((sum, p) => sum + p[1], 0) / polygon[0].length;
      const scale = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
      const projected = polygon.map((ring) => ring.map(([x, y]): Point => [x * scale, y]));
      return { projected, scale, area: area(projected[0]) - projected.slice(1).reduce((sum, r) => sum + area(r), 0) };
    })
    .sort((a, b) => b.area - a.area);
  const { projected, scale } = candidates[0];
  const [x, y] = pole(projected);
  return { lat: round(y), lng: round(normalizeLng(x / scale)) };
}

const CHANNELS = new Set(['English Channel', 'Mozambique Channel', 'Strait of Gibraltar']);
export function includeMarine(p: Record<string, unknown>): boolean {
  if (!text(p.name) || !inRange(p.scalerank, 0, 20)) return false;
  if (p.name === 'Inner Sea' || p.name === 'Inner Seas' || p.name === 'The North Western Passages') return false;
  return (
    p.featurecla === 'ocean' ||
    (['sea', 'bay', 'gulf'].includes(String(p.featurecla)) &&
      (p.scalerank <= 3 || (p.featurecla === 'sea' && p.scalerank === 4))) ||
    CHANNELS.has(p.name)
  );
}

export function buildCountryLabels(
  raw: unknown,
  marine?: unknown,
  overrides: PlaceNameOverrides = { cities: [], labels: [] },
): CountryLabelDataset {
  const labels: MapLabelTuple[] = [];
  const add = (
    kind: MapLabelTuple[0],
    p: Record<string, unknown>,
    lat: number,
    lng: number,
    zoom: number,
    rank: number,
  ) => {
    const country = kind === 'country';
    const name = String(country ? p.NAME : p.name).trim();
    const override = overrides.labels.find((o) => o.kind === kind && o.key === name);
    const names = {
      en: name,
      hu: text(p[country ? 'NAME_HU' : 'name_hu']) ? String(p[country ? 'NAME_HU' : 'name_hu']).trim() : name,
      sv: text(p[country ? 'NAME_SV' : 'name_sv']) ? String(p[country ? 'NAME_SV' : 'name_sv']).trim() : name,
      ...override?.names,
    };
    const [y, x] = override?.point ?? [lat, lng];
    if (!country && !marineContainsPoint(p.geometry, y, x))
      throw new Error(`Marine label is outside its polygon: ${name} (${y}, ${x})`);
    labels.push([kind, names.en, names.hu, names.sv, round(y), round(x), Math.round(zoom * 10) / 10, rank]);
  };
  for (const feature of features(raw)) {
    const p = feature.properties;
    if (!record(p) || !text(p.NAME) || !inRange(p.LABEL_Y, -90, 90) || !inRange(p.LABEL_X, -180, 180)) continue;
    if (!inRange(p.MIN_LABEL, 0, 12) || !inRange(p.LABELRANK, 0, 20))
      throw new Error(`Invalid country label zoom/rank: ${p.NAME}`);
    add('country', p, p.LABEL_Y, p.LABEL_X, p.MIN_LABEL, p.LABELRANK);
  }
  if (marine !== undefined) {
    for (const feature of features(marine)) {
      const p = feature.properties;
      if (!record(p) || !includeMarine(p)) continue;
      if (!inRange(p.min_label, 0, 12) || !inRange(p.scalerank, 0, 20))
        throw new Error(`Invalid marine label zoom/rank: ${p.name}`);
      const kind = p.featurecla === 'ocean' ? 'ocean' : 'sea';
      const override = overrides.labels.find((o) => o.kind === kind && o.key === p.name);
      const point = override?.point
        ? { lat: override.point[0], lng: override.point[1] }
        : marineLabelPoint(feature.geometry);
      // NE's marine min_label 4–5.7 is too late for a small globe; retain its relative progression.
      const zoom = kind === 'ocean' ? 0.8 : 1.8 + (p.min_label - 2) * 0.45;
      add(kind, { ...p, geometry: feature.geometry }, point.lat, point.lng, zoom, p.scalerank);
    }
  }
  const decoded = decodeCountryLabels({
    format: 2,
    meta: { source: 'Natural Earth', version: '5.1.2', license: 'Public domain' },
    labels,
  });
  const ordered = labels
    .map((tuple, i) => ({ tuple, label: decoded[i] }))
    .sort((a, b) => labelPriority(a.label, b.label))
    .map(({ tuple }) => tuple);
  return {
    format: 2,
    meta: {
      source:
        marine === undefined ? COUNTRY_LABEL_SOURCE_URL : `${COUNTRY_LABEL_SOURCE_URL}; ${MARINE_LABEL_SOURCE_URL}`,
      version: '5.1.2',
      license: 'Public domain (Natural Earth); CC0 (Wikidata names)',
    },
    labels: ordered,
  };
}

/** Production requires at least 180 countries, independently of the number of marine labels. */
export function validateCountryLabels(dataset: CountryLabelDataset, minLabels = MIN_COUNTRY_LABELS): number {
  const labels = decodeCountryLabels(dataset);
  const countries = labels.filter((label) => label.kind === 'country').length;
  if (countries < minLabels) throw new Error(`Too few country labels: ${countries}; expected at least ${minLabels}`);
  return labels.length;
}
