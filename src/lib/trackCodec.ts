/** Versioned, URL-safe delta encoding. No browser APIs: also used by the local MCP adapter. */
import {
  legTrack,
  normalizeTrack,
  simplifyTrackIndices,
  type CustomTrack,
  type TrackFormat,
  type TrackPoint,
} from './track.ts';
import { MAX_TRACK_POINTS } from '../agent/contract.ts';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const formats: Record<TrackFormat, string> = {
  geojson: 'j',
  gpx: 'g',
  kml: 'k',
  kmz: 'z',
  csv: 'c',
  igc: 'i',
  fpl: 'f',
  pln: 'n',
  route: 'r',
  link: 'l',
  document: 'd',
};
export const TRACK_FORMATS = Object.keys(formats) as TrackFormat[];
const minTime = Date.UTC(1900, 0, 1) / 1000;
const maxTime = Date.UTC(2101, 0, 1) / 1000;
function varint(delta: number): string {
  if (!Number.isSafeInteger(delta)) throw new RangeError('Track delta exceeds the codec range.');
  let value = delta < 0 ? -delta * 2 - 1 : delta * 2;
  let result = '';
  do {
    const digit = value % 32;
    value = Math.floor(value / 32);
    result += alphabet[digit + (value ? 32 : 0)];
  } while (value);
  return result;
}
export function encodeTrack(track: CustomTrack): string {
  const lt = legTrack(track);
  const flags = (lt.altitudesKm ? 1 : 0) | (lt.times ? 2 : 0);
  const previous = [0, 0, 0, 0];
  const payload = track.points
    .map((p, i) => {
      const values = [Math.round(p.lat * 1e5), Math.round(p.lng * 1e5)];
      if (lt.altitudesKm) values.push(Math.round(lt.altitudesKm[i] * 1000));
      if (lt.times) values.push(Math.round(lt.times[i] / 1000));
      return values
        .map((value, j) => {
          const encoded = varint(value - previous[j]);
          previous[j] = value;
          return encoded;
        })
        .join('');
    })
    .join('');
  return `1${lt.kind === 'recorded' ? 'r' : 'p'}${formats[track.source.format] ?? 'x'}${alphabet[flags]}.${payload}`;
}
export function decodeTrack(value: string): CustomTrack | null {
  if (value.length > MAX_TRACK_POINTS * 32 + 5 || !/^1[pr][jgkzcifnrldx][A-D]\.[A-Za-z0-9_-]+$/.test(value))
    return null;
  const flags = alphabet.indexOf(value[3]);
  if ((value[1] === 'p' && flags & 2) || (value[1] === 'r' && !(flags & 2))) return null;
  const format = TRACK_FORMATS.find((f) => formats[f] === value[2]) ?? 'link';
  let cursor = 5;
  const read = (): number | null => {
    let unsigned = 0,
      scale = 1;
    for (let n = 0; n < 10 && cursor < value.length; n++) {
      const digit = alphabet.indexOf(value[cursor++]);
      unsigned += (digit % 32) * scale;
      if (!Number.isSafeInteger(unsigned)) return null;
      if (digit < 32) return unsigned % 2 ? -(unsigned + 1) / 2 : unsigned / 2;
      scale *= 32;
    }
    return null;
  };
  const points: TrackPoint[] = [];
  const previous = [0, 0, 0, 0];
  while (cursor < value.length) {
    if (points.length >= MAX_TRACK_POINTS) return null;
    const values: number[] = [];
    for (let j = 0; j < 2 + (flags & 1 ? 1 : 0) + (flags & 2 ? 1 : 0); j++) {
      const delta = read();
      if (delta === null) return null;
      values.push((previous[j] += delta));
    }
    const lat = values[0] / 1e5,
      lng = values[1] / 1e5;
    const altM = flags & 1 ? values[2] : null;
    const seconds = flags & 2 ? values[flags & 1 ? 3 : 2] : null;
    if (
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      (altM !== null && (altM < -500 || altM > 30000)) ||
      (seconds !== null &&
        (seconds < minTime || seconds > maxTime || (points.at(-1)?.time ?? -Infinity) > seconds * 1000))
    )
      return null;
    points.push({ lat, lng, altM, time: seconds === null ? null : seconds * 1000 });
  }
  return normalizeTrack({ kind: value[1] === 'r' ? 'recorded' : 'planned', points, source: { format, name: null } })
    .track;
}
export interface TrackReduction {
  kept: number;
  total: number;
}
export function fitTracks(
  tracks: (CustomTrack | null)[],
  budgetChars: number,
): { tracks: (CustomTrack | null)[]; reduced: TrackReduction | null } {
  const budget = Math.max(0, Math.floor(budgetChars));
  const total = tracks.reduce((sum, t) => sum + (t?.reducedFrom ?? t?.points.length ?? 0), 0);
  const incoming = tracks;
  tracks = tracks.map((track) => {
    if (!track) return null;
    const normalized = normalizeTrack(track).track;
    if (!normalized) return null;
    const times = legTrack(normalized).times;
    if (times && times.some((time) => time / 1000 < minTime || time / 1000 > maxTime)) return null;
    return normalized;
  });
  const changed = tracks.some((t, i) => t !== incoming[i]);
  const length = (list: (CustomTrack | null)[]) => list.reduce((sum, t) => sum + (t ? encodeTrack(t).length : 0), 0);
  if (tracks.every((t) => !t || t.points.length <= MAX_TRACK_POINTS) && length(tracks) <= budget)
    return {
      tracks: changed ? tracks : incoming,
      reduced: changed ? { kept: tracks.reduce((sum, t) => sum + (t?.points.length ?? 0), 0), total } : null,
    };
  const counts = tracks.map((t) => (t ? Math.min(t.points.length, MAX_TRACK_POINTS) : 0));
  const subset = (t: CustomTrack | null, n: number): CustomTrack | null => {
    if (!t || !n) return null;
    if (n >= t.points.length) return t;
    const derived = legTrack(t);
    return {
      ...t,
      points: simplifyTrackIndices(derived.path, { maxPoints: n }).map((i) => {
        const p = t.points[i];
        // A retained endpoint may itself be untimed/unknown. Carry the original interpolation into
        // the share copy before dropping its neighbours, so a recording cannot become a planned path.
        const altM = p.altM ?? (derived.altitudesKm ? derived.altitudesKm[i] * 1000 : null);
        const time = p.time ?? derived.times?.[i] ?? null;
        return altM === p.altM && time === p.time ? p : { ...p, altM, time };
      }),
      reducedFrom: t.reducedFrom ?? t.points.length,
    };
  };
  let fitted = tracks.map((t, i) => subset(t, counts[i]));
  let size = length(fitted);
  // Proportional allocation, then measure the actual delta payload (not an assumed bytes-per-point).
  while (size > budget && counts.some((n) => n > 2)) {
    const ratio = Math.min(0.95, budget / size);
    counts.forEach((n, i) => {
      if (n > 2) counts[i] = Math.max(2, Math.floor(n * ratio));
    });
    fitted = tracks.map((t, i) => subset(t, counts[i]));
    size = length(fitted);
  }
  for (let i = fitted.length - 1; size > budget && i >= 0; i--) {
    if (fitted[i]) {
      size -= encodeTrack(fitted[i]!).length;
      fitted[i] = null;
    }
  }
  return { tracks: fitted, reduced: { kept: fitted.reduce((sum, t) => sum + (t?.points.length ?? 0), 0), total } };
}
