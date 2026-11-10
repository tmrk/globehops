import type { Airport, LatLng } from '../../types.ts';
import type { TrackPoint } from '../track.ts';
import { centralAngle, EARTH_RADIUS_KM, greatCircleDistanceKm, initialBearing, isValidLatLng } from '../geo.ts';
import { ImportFailure, type ParseState } from './common.ts';
import type { ImportContext, ParsedDocument } from './types.ts';

/** ARINC quadrant letters: N=NW, E=NE, W=SW, S=SE; middle letter adds 100° longitude. */
export function routeCoordinate(token: string): LatLng | null {
  let m = /^([+-]?\d{1,3}(?:\.\d+)?)[,/]([+-]?\d{1,3}(?:\.\d+)?)$/.exec(token);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = /^(\d{2})(\d{2})?([NS])(\d{2,3})(\d{2})?([EW])$/.exec(token);
  if (m) {
    const minutesLat = Number(m[2] ?? 0),
      minutesLng = Number(m[5] ?? 0);
    return {
      lat: minutesLat < 60 ? (Number(m[1]) + minutesLat / 60) * (m[3] === 'S' ? -1 : 1) : NaN,
      lng: minutesLng < 60 ? (Number(m[4]) + minutesLng / 60) * (m[6] === 'W' ? -1 : 1) : NaN,
    };
  }
  m = /^(\d{2})(\d{2})([NESW])$/.exec(token);
  if (m) return { lat: Number(m[1]) * (/[SW]/.test(m[3]) ? -1 : 1), lng: Number(m[2]) * (/[NW]/.test(m[3]) ? -1 : 1) };
  m = /^(\d{2})([NESW])(\d{2})$/.exec(token);
  if (m)
    return {
      lat: Number(m[1]) * (/[SW]/.test(m[2]) ? -1 : 1),
      lng: (100 + Number(m[3])) * (/[NW]/.test(m[2]) ? -1 : 1),
    };
  m = /^H(\d{2})(\d{2})$/.exec(token);
  if (m) return { lat: Number(m[1]) + 0.5, lng: -Number(m[2]) };
  m = /^([NS])(\d{1,2})°(\d{1,2})['′](\d{1,2}(?:\.\d+)?)["″]([EW])(\d{1,3})°(\d{1,2})['′](\d{1,2}(?:\.\d+)?)["″]$/.exec(
    token,
  );
  if (m) {
    const valid = Number(m[3]) < 60 && Number(m[4]) < 60 && Number(m[7]) < 60 && Number(m[8]) < 60;
    return {
      lat: valid ? (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600) * (m[1] === 'S' ? -1 : 1) : NaN,
      lng: valid ? (Number(m[6]) + Number(m[7]) / 60 + Number(m[8]) / 3600) * (m[5] === 'W' ? -1 : 1) : NaN,
    };
  }
  return null;
}
function tokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(
      /[NS]\d{1,2}°\s*\d{1,2}['′]\s*\d{1,2}(?:\.\d+)?["″]\s*[EW]\d{1,3}°\s*\d{1,2}['′]\s*\d{1,2}(?:\.\d+)?["″]/g,
      (s) => s.replace(/\s+/g, ''),
    )
    .replace(/\b(\d{2}(?:\d{2})?[NS])\s+(\d{3}(?:\d{2})?[EW])\b/g, '$1$2')
    .replace(/\b([A-Z]{3,4})-([A-Z]{3,4})\b/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
const speedLevel = /^(?:N\d{4}|K\d{4}|M\d{3})(?:([FA])([0-9]{3})|([SM])([0-9]{4}))$/;
function level(token: string): number | null {
  const m = speedLevel.exec(token);
  return !m ? null : m[1] ? Number(m[2]) * 100 * 0.3048 : Number(m[4]) * 10;
}
const baseToken = (token: string) =>
  token.replace(/\/(?:\d{2}[LRC]?|(?:N\d{4}|K\d{4}|M\d{3})(?:[FA]\d{3}|[SM]\d{4}))$/, '');
function endpoint(token: string, context: ImportContext): { point: LatLng; airport?: Airport } | null {
  const base = baseToken(token),
    coord = routeCoordinate(base);
  if (coord && isValidLatLng(coord)) return { point: coord };
  const airport = context.byCode(base);
  return airport ? { point: airport, airport } : null;
}
function segmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const span = centralAngle(a, b),
    d = centralAngle(a, p);
  if (span < 1e-10 || Math.PI - span < 1e-8) return Math.min(greatCircleDistanceKm(a, p), greatCircleDistanceKm(b, p));
  const bearing = ((initialBearing(a, p) - initialBearing(a, b)) * Math.PI) / 180;
  const along = Math.atan2(Math.sin(d) * Math.cos(bearing), Math.cos(d));
  if (along < 0 || along > span) return Math.min(greatCircleDistanceKm(a, p), greatCircleDistanceKm(b, p));
  return Math.abs(Math.asin(Math.max(-1, Math.min(1, Math.sin(d) * Math.sin(bearing))))) * EARTH_RADIUS_KM;
}
export function plausibleRoute(text: string): boolean {
  const ts = tokens(text);
  if (ts.length < 2) return false;
  return (
    ts.every((t) => /^[A-Z0-9/.,+°'"′″-]+$/.test(t)) &&
    ts.filter(
      (t) =>
        routeCoordinate(t) !== null ||
        /^[A-Z0-9]{3,4}(?:\/\d{2}[LRC]?)?$/.test(t) ||
        /^[A-Z]{2}-[A-Z0-9]{3,8}$/.test(t),
    ).length >= 2
  );
}
export function parseRoute(text: string, context: ImportContext, state: ParseState): ParsedDocument {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lineTokens = lines.map(tokens);
  // Wrapped field 15 is joined unless each line independently contains a resolvable origin and destination.
  const separate =
    lineTokens.length > 1 && lineTokens.every((ts) => ts.filter((t) => endpoint(t, context)).length >= 2);
  const groups = separate ? lineTokens : [tokens(lines.join(' '))];
  const paths = [];
  const unresolved: string[] = [],
    airways: string[] = [],
    procedures: string[] = [];
  for (const ts of groups) {
    const ends = ts.map((t) => endpoint(t, context));
    const first = ends.findIndex(Boolean);
    let last = ends.length - 1;
    while (last >= 0 && !ends[last]) last--;
    if (first < 0 || last <= first)
      throw new ImportFailure(
        'no_path',
        'The route needs two airports or coordinates. Include a departure and arrival, for example EGLL KJFK.',
      );
    const control = (token: string) =>
      token === 'DCT' ||
      level(token) !== null ||
      /^[A-Z]{1,2}\d{1,4}[A-Z]?$/.test(token) ||
      (/^[A-Z]{2,5}\d[A-Z]$/.test(token) && token.length >= 5 && token.length <= 7);
    const significant = ts.map((token, i) => ({ token, i })).filter(({ token, i }) => ends[i] || !control(token));
    if (significant[0]?.i !== first || significant.at(-1)?.i !== last)
      throw new ImportFailure(
        'no_path',
        'The route must start and end with an airport or coordinate, after any speed/level groups.',
      );
    const destination = ends[last]!.point;
    const points: TrackPoint[] = [];
    let altitude: number | null = null;
    for (let i = 0; i < ts.length; i++) {
      const token = ts[i],
        base = baseToken(token),
        change = token.includes('/') ? level(token.slice(token.lastIndexOf('/') + 1)) : null;
      const newLevel = level(token);
      if (newLevel !== null) {
        altitude = newLevel;
        continue;
      }
      if (base === 'DCT') continue;
      const coordinate = routeCoordinate(base);
      let location: LatLng | null = coordinate,
        airport: Airport | undefined;
      if (!location) {
        const candidate = context.byCode(base);
        // Three-letter IATA codes in the middle must not shadow radio aids (SFO, CPT, ...).
        if (candidate && (base.length >= 4 || i === first || i === last || candidate.ident.toUpperCase() === base)) {
          airport = candidate;
          location = candidate;
        }
      }
      if (!location && /^[A-Z0-9]{2,3}$/.test(base)) {
        const prev = points.at(-1) ?? ends[first]!.point;
        const baseline = greatCircleDistanceKm(prev, destination);
        const candidates = (context.navaids?.byIdent.get(base) ?? [])
          .map((aid) => ({
            aid,
            detour: Math.max(0, greatCircleDistanceKm(prev, aid) + greatCircleDistanceKm(aid, destination) - baseline),
            off: segmentDistance(aid, prev, destination),
          }))
          .filter((c) => c.off <= 1500)
          .sort((a, b) => a.detour - b.detour);
        if (candidates[0]) {
          location = candidates[0].aid;
          if (candidates[1] && candidates[1].detour <= 2 * Math.max(0.001, candidates[0].detour)) {
            const chosen = `${base} (${candidates[0].aid.country}, ${candidates[0].aid.lat}, ${candidates[0].aid.lng})`;
            state.warn('ambiguous_waypoint', `Several nearby navaids are named ${base}; chose ${chosen}.`, {
              name: base,
              chosen,
            });
          }
        }
      }
      if (location) {
        const p = state.point(location.lat, location.lng, airport ? null : altitude, null, base);
        if (p) points.push(p);
      } else if (/^[A-Z]{2,5}\d[A-Z]$/.test(base) && base.length >= 5 && base.length <= 7) procedures.push(base);
      else if (/^[A-Z]{1,2}\d{1,4}[A-Z]?$/.test(base)) airways.push(base);
      else unresolved.push(base);
      if (change !== null) altitude = change;
    }
    if (points.length < 2) throw new ImportFailure('no_path', 'The route has fewer than two valid resolved points.');
    paths.push({ points, kind: 'planned' as const });
  }
  if (unresolved.length)
    state.warn(
      'unresolved_waypoints',
      `Unresolved waypoints: ${unresolved.slice(0, 12).join(', ')}${unresolved.length > 12 ? ', …' : ''}.`,
      { names: unresolved.slice(0, 12).join(', ') + (unresolved.length > 12 ? ', …' : ''), count: unresolved.length },
    );
  if (airways.length)
    state.warn('airway_direct', 'Airways are drawn directly between resolved waypoints.', {
      airways: [...new Set(airways)].join(', '),
      count: airways.length,
    });
  if (procedures.length)
    state.warn('procedure_direct', 'Procedures are omitted and drawn directly.', {
      names: [...new Set(procedures)].join(', '),
    });
  return { paths };
}
