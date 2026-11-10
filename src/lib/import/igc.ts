import { invalid, type ParseState } from './common.ts';
import type { TrackPoint } from '../track.ts';
import type { ParsedDocument } from './types.ts';
export function parseIgc(text: string, state: ParseState): ParsedDocument {
  const lines = text.split(/\r?\n/);
  let date: number | null = null,
    previous = -1,
    day = 0;
  for (const line of lines) {
    const m = /^H[FP]DTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/.exec(line);
    if (m) {
      const yy = Number(m[3]),
        year = yy >= 80 ? 1900 + yy : 2000 + yy;
      date = Date.UTC(year, Number(m[2]) - 1, Number(m[1]));
      const parsed = new Date(date);
      if (parsed.getUTCMonth() !== Number(m[2]) - 1 || parsed.getUTCDate() !== Number(m[1]))
        invalid('Invalid IGC date');
      break;
    }
  }
  if (date === null) invalid('Missing IGC HFDTE date');
  const points: TrackPoint[] = [];
  let name: string | null = null;
  for (const line of lines) {
    if (/^H[FP]GTYGLIDERTYPE:/.test(line)) name = line.slice(line.indexOf(':') + 1).trim() || null;
    if (!line.startsWith('B')) continue;
    const m = /^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])([AV])([\d-]{5})([\d-]{5})/.exec(line);
    if (!m || !/^-?\d+$/.test(m[11]) || !/^-?\d+$/.test(m[12])) {
      state.point(null, null);
      continue;
    }
    const hour = Number(m[1]),
      minute = Number(m[2]),
      second = Number(m[3]);
    if (hour > 23 || minute > 59 || second > 59 || Number(m[5]) >= 60_000 || Number(m[8]) >= 60_000 || m[10] === 'V') {
      state.point(null, null);
      continue;
    }
    const seconds = hour * 3600 + minute * 60 + second;
    if (previous >= 18 * 3600 && seconds < 6 * 3600) day++;
    previous = seconds;
    const lat = (Number(m[4]) + Number(m[5]) / 60_000) * (m[6] === 'S' ? -1 : 1);
    const lng = (Number(m[7]) + Number(m[8]) / 60_000) * (m[9] === 'W' ? -1 : 1);
    const altitude = Number(m[12]) || Number(m[11]);
    const p = state.point(lat, lng, altitude, date + day * 86_400_000 + seconds * 1000);
    if (p) points.push(p);
  }
  return { paths: [{ points, name, kind: 'recorded' }], name };
}
