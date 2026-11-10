import { greatCircleDistanceKm } from '../geo.ts';
import { coordinateTime, invalid, record, string, timestamp, type ParseState } from './common.ts';
import type { TrackPoint } from '../track.ts';
import type { ParsedDocument, ParsedPath } from './types.ts';

export function parseGeoJson(text: string, state: ParseState): ParsedDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid('Malformed JSON');
  }
  const root = record(raw);
  if (!root) invalid('Expected a GeoJSON object');
  const paths: ParsedPath[] = [],
    pointFeatures: TrackPoint[] = [];
  let documentName = string(root.name) ?? string(root.title);
  const stack: { object: Record<string, unknown>; properties?: Record<string, unknown> | null }[] = [{ object: root }];
  const timeShapes = new WeakMap<unknown[], boolean>();
  const points = (
    coords: unknown,
    props: Record<string, unknown> | null | undefined,
    line?: number,
    offset = 0,
  ): TrackPoint[] => {
    if (!Array.isArray(coords)) invalid('Expected a coordinate array');
    const timesRaw = props?.coordTimes ?? props?.times ?? record(props?.coordinateProperties)?.times;
    let nested = false;
    if (line !== undefined && Array.isArray(timesRaw)) {
      if (!timeShapes.has(timesRaw)) timeShapes.set(timesRaw, timesRaw.some(Array.isArray));
      nested = timeShapes.get(timesRaw)!;
    }
    const times = nested ? (timesRaw as unknown[])[line!] : timesRaw;
    const output: TrackPoint[] = [];
    for (let i = 0; i < coords.length; i++) {
      const c: unknown = coords[i];
      const a = Array.isArray(c) ? (c as unknown[]) : [];
      const time = Array.isArray(times) ? timestamp(times[i + (nested ? 0 : offset)]) : coordinateTime(a[3]);
      const p = state.point(a[1], a[0], a[2], time);
      if (p) output.push(p);
    }
    return output;
  };
  while (stack.length) {
    const { object: obj, properties } = stack.pop()!;
    const props = record(obj.properties) ?? properties;
    const name = string(props?.name) ?? string(props?.title);
    documentName ??= name;
    switch (obj.type) {
      case 'FeatureCollection':
      case 'GeometryCollection': {
        const items = obj.type === 'FeatureCollection' ? obj.features : obj.geometries;
        if (!Array.isArray(items)) invalid('Missing GeoJSON features/geometries');
        for (let i = items.length - 1; i >= 0; i--) {
          const item = record(items[i]);
          if (!item) invalid('Invalid GeoJSON member');
          stack.push({ object: item, properties: props });
        }
        break;
      }
      case 'Feature': {
        if (obj.geometry === null) break;
        const geometry = record(obj.geometry);
        if (!geometry) invalid('Missing GeoJSON geometry');
        stack.push({ object: geometry, properties: props });
        break;
      }
      case 'LineString':
        paths.push({ points: points(obj.coordinates, props), name, description: string(props?.description) });
        break;
      case 'MultiLineString': {
        if (!Array.isArray(obj.coordinates)) invalid('Missing MultiLineString coordinates');
        let previous: ParsedPath | undefined;
        let offset = 0;
        for (let i = 0; i < obj.coordinates.length; i++) {
          const line = points(obj.coordinates[i], props, i, offset);
          const rawLine: unknown = obj.coordinates[i];
          offset += Array.isArray(rawLine) ? rawLine.length : 0;
          if (
            line.length &&
            previous?.points.length &&
            greatCircleDistanceKm(previous.points[previous.points.length - 1], line[0]) <= 1
          ) {
            for (const p of line) previous.points.push(p);
          } else {
            previous = { points: line, name, description: string(props?.description) };
            paths.push(previous);
          }
        }
        break;
      }
      case 'Point': {
        const list = points([obj.coordinates], props);
        if (list[0]) {
          if (name) list[0].name = name;
          pointFeatures.push(list[0]);
        }
        break;
      }
      case 'MultiPoint':
      case 'Polygon':
      case 'MultiPolygon':
        break;
      default:
        invalid('Unknown GeoJSON geometry');
    }
  }
  if (!paths.length && pointFeatures.length >= 2)
    paths.push({ points: pointFeatures, kind: 'planned', name: documentName });
  return { paths, name: documentName };
}
