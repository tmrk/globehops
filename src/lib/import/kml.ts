import { child, descendants, value, type XmlNode } from './xml.ts';
import { number, timestamp, type ParseState } from './common.ts';
import type { TrackPoint } from '../track.ts';
import type { ParsedDocument, ParsedPath } from './types.ts';

function coordinates(node: XmlNode, state: ParseState): TrackPoint[] {
  const points: TrackPoint[] = [];
  const mode = value(node, 'altitudemode')?.toLowerCase();
  if (node.tag === 'track') {
    const times = node.children.filter((n) => n.tag === 'when').map((n) => n.text.trim());
    let i = 0;
    for (const coord of node.children.filter((n) => n.tag === 'coord')) {
      const [lng, lat, alt] = coord.text.trim().split(/\s+/);
      const point = state.point(lat, lng, mode === 'clamptoground' ? null : alt, times[i++]);
      if (point) points.push(point);
    }
  } else {
    for (const tuple of (value(node, 'coordinates') ?? '').split(/\s+/)) {
      if (!tuple) continue;
      const [lng, lat, alt] = tuple.split(',');
      const point = state.point(lat, lng, mode === 'clamptoground' ? null : alt);
      if (point) points.push(point);
    }
  }
  // Absent mode follows the ground default, except for nonzero exporter elevations.
  if (!mode && !points.some((p) => p.altM !== null && p.altM !== 0)) for (const p of points) p.altM = null;
  return points;
}
export function parseKml(root: XmlNode, state: ParseState): ParsedDocument {
  const document = descendants(root, ['document'])[0] ?? root;
  const name = value(document, 'name');
  const paths: ParsedPath[] = [],
    timedPoints: TrackPoint[] = [];
  const placemarks = descendants(root, ['placemark'], true);
  let firstTimed: XmlNode | null = null;
  for (const placemark of placemarks) {
    const stamp = child(placemark, 'timestamp'),
      pointNode = child(placemark, 'point');
    if (pointNode && stamp && timestamp(value(stamp, 'when')) !== null) {
      const points = coordinates(pointNode, state);
      if (points[0]) {
        points[0].time = timestamp(value(stamp, 'when'));
        timedPoints.push(points[0]);
        firstTimed ??= placemark;
      }
    }
  }
  // A duplicate must preserve every vertex in order. Compare only equal-length paths, so scanning
  // remains linear across any number of Placemarks, including large stationary logs.
  const duplicateTrail = (points: TrackPoint[]) =>
    timedPoints.length >= 2 &&
    points.length === timedPoints.length &&
    points.every((p, i) => p.lat === timedPoints[i].lat && p.lng === timedPoints[i].lng);
  for (const placemark of placemarks.length ? placemarks : [root]) {
    if (placemark === firstTimed && timedPoints.length >= 2)
      paths.push({ points: timedPoints, name: name ?? value(placemark, 'name'), kind: 'recorded' });
    const points: TrackPoint[] = [];
    for (const geometry of descendants(placemark, ['linestring', 'track'], true)) {
      const line = coordinates(geometry, state);
      if (geometry.tag === 'linestring' && duplicateTrail(line)) continue;
      for (const point of line) points.push(point);
    }
    if (points.length)
      paths.push({ points, name: value(placemark, 'name') ?? name, description: value(placemark, 'description') });
  }
  return { paths, name: name ?? paths[0]?.name };
}
export const feetToMetres = (raw: unknown): number | null => {
  const n = number(raw);
  return n === null ? null : n * 0.3048;
};
