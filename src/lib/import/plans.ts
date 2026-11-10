import type { TrackPoint } from '../track.ts';
import type { ParsedDocument } from './types.ts';
import { invalid, type ParseState } from './common.ts';
import { descendants, value, type XmlNode } from './xml.ts';
import { feetToMetres } from './kml.ts';

export function parseFpl(root: XmlNode, state: ParseState): ParsedDocument {
  const waypoints = new Map<string, XmlNode>();
  for (const waypoint of descendants(root, ['waypoint'])) {
    const ident = value(waypoint, 'identifier');
    if (ident) waypoints.set(ident.toUpperCase(), waypoint);
  }
  const routes = descendants(root, ['route'], true);
  const paths = routes.map((route) => {
    const points: TrackPoint[] = [];
    for (const entry of descendants(route, ['route-point'])) {
      const ident = value(entry, 'waypoint-identifier');
      const waypoint = ident ? waypoints.get(ident.toUpperCase()) : undefined;
      const p = state.point(
        waypoint ? value(waypoint, 'lat') : null,
        waypoint ? value(waypoint, 'lon') : null,
        null,
        null,
        ident,
      );
      if (p) points.push(p);
    }
    return { points, kind: 'planned' as const, name: value(route, 'route-name') };
  });
  return { paths, name: paths[0]?.name };
}
function dms(raw: string): number | null {
  const m = /^\s*([NSEW])\s*(\d{1,3})[°º\s]+(\d{1,2})['′\s]+(\d{1,2}(?:\.\d+)?)\s*["″]?\s*$/i.exec(raw);
  if (!m || Number(m[3]) >= 60 || Number(m[4]) >= 60) return null;
  return (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600) * (/[SW]/i.test(m[1]) ? -1 : 1);
}
function altitudeFeet(raw: string | null | undefined, state: ParseState): number | null {
  const altitude = feetToMetres(raw);
  if (raw?.trim() && altitude === null && !state.warnings.some((w) => w.code === 'altitude_dropped'))
    state.warn('altitude_dropped', 'Unusable flight-plan altitudes were treated as unknown.');
  return altitude;
}
export function parsePln(root: XmlNode, state: ParseState): ParsedDocument {
  const points: TrackPoint[] = [];
  if (root.tag === 'littlenavmap') {
    for (const waypoint of descendants(root, ['waypoint'], true)) {
      const pos = descendants(waypoint, ['pos'])[0];
      const p = state.point(
        pos?.attrs.lat,
        pos?.attrs.lon,
        altitudeFeet(pos?.attrs.alt, state),
        null,
        value(waypoint, 'ident'),
      );
      if (p) points.push(p);
    }
  } else {
    for (const waypoint of descendants(root, ['atcwaypoint'], true)) {
      const position = value(waypoint, 'worldposition');
      if (!position) {
        state.point(null, null);
        continue;
      }
      const [lat, lng, alt] = position.split(',');
      const p = state.point(dms(lat), dms(lng ?? ''), altitudeFeet(alt, state), null, waypoint.attrs.id);
      if (p) points.push(p);
    }
  }
  const plan = descendants(root, ['flightplan.flightplan'])[0] ?? root;
  const name = value(plan, 'title') ?? value(plan, 'name');
  if (!points.length && !['littlenavmap', 'simbase.document', 'flightplan.flightplan'].includes(root.tag))
    invalid('Unknown flight plan root');
  return { paths: [{ points, kind: 'planned', name }], name };
}
