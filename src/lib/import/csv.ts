import { invalid, number, timestamp, type ParseState } from './common.ts';
import type { ParsedDocument } from './types.ts';
import type { TrackPoint } from '../track.ts';

/** Delimiter-aware RFC 4180 scanner, including multiline fields and doubled quotes. */
export function readDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const finish = () => {
    row.push(field);
    field = '';
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (c === delimiter) finish();
    else if (c === '\r' || c === '\n') {
      finish();
      if (row.some((s) => s.trim())) rows.push(row);
      row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else if (closed) {
      if (!/\s/.test(c)) invalid('Unexpected text after a quoted CSV field');
    } else if (c === '"') {
      if (field.trim()) invalid('Quote inside an unquoted CSV field');
      field = '';
      quoted = true;
    } else field += c;
  }
  if (quoted) invalid('Unterminated quoted CSV field');
  if (field || row.length || closed) {
    finish();
    if (row.some((s) => s.trim())) rows.push(row);
  }
  return rows;
}
export function sniffDelimiter(text: string): string {
  const counts = new Map([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (c === '\r' || c === '\n')) break;
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}
const normalise = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const LAT = /^(lat|latitude)(deg|degrees)?$/;
const LON = /^(lon|lng|long|longitude)(deg|degrees)?$/;
export function hasCsvHeader(text: string): boolean {
  const header = text.split(/\r?\n/, 1)[0].toLowerCase();
  return /(?:latitude|\blat\b|lat_deg|\bposition\b)/.test(header) && /[,;\t]/.test(header);
}
export function parseCsv(text: string, state: ParseState): ParsedDocument {
  const rows = readDelimited(text, sniffDelimiter(text));
  if (!rows.length) return { paths: [] };
  const h = rows[0].map(normalise);
  const latIndex = h.findIndex((s) => LAT.test(s)),
    lonIndex = h.findIndex((s) => LON.test(s)),
    positionIndex = h.indexOf('position');
  const header = (latIndex >= 0 && lonIndex >= 0) || positionIndex >= 0;
  if (
    !header &&
    rows[0].some((s, i) => i < 2 && number(s) === null && s.trim() !== '' && !/^[+-]?(?:NaN|Infinity)$/i.test(s.trim()))
  )
    invalid('CSV needs latitude/longitude or Position columns');
  const data = header ? rows.slice(1) : rows;
  const altIndex = header
    ? h.findIndex((s) => /^(alt|altitude|ele|elevation|geoaltitude|baroaltitude)(m|ft|feet|metres|meters)?$/.test(s))
    : 2;
  const utcIndex = header ? h.indexOf('utc') : -1;
  const timeIndex = header ? h.findIndex((s) => ['time', 'timestamp', 'datetime', 'utctime'].includes(s)) : 3;
  const dateIndex = header ? h.indexOf('date') : -1;
  const isoIndex = utcIndex >= 0 ? utcIndex : header ? h.indexOf('datetime') : -1;
  const swap =
    !header &&
    data.some((r) => {
      const n = number(r[0]);
      return n !== null && Math.abs(n) > 90;
    });
  let altFactor = 1;
  const altHeader = header && altIndex >= 0 ? h[altIndex] : '';
  if (/(ft|feet)$/.test(altHeader) || (positionIndex >= 0 && h.includes('callsign') && altHeader === 'altitude'))
    altFactor = 0.3048;
  else if (
    altIndex >= 0 &&
    !/(m|metres|meters)$/.test(altHeader) &&
    !['baroaltitude', 'geoaltitude'].includes(altHeader)
  ) {
    let max = -Infinity;
    for (const row of data) max = Math.max(max, number(row[altIndex]) ?? -Infinity);
    if (max > 20_000) {
      altFactor = 0.3048;
      state.warn('altitude_feet_assumed', 'CSV altitudes above 20,000 were interpreted as feet.');
    }
  }
  const points: TrackPoint[] = [];
  let badAltitude = false,
    hadAltitude = false;
  for (const row of data) {
    if (header && row.length !== rows[0].length) invalid('CSV row has the wrong number of columns');
    if (!header && (row.length < 2 || row.length > 4)) invalid('Expected lat,lng[,alt[,time]]');
    const position = positionIndex >= 0 ? (row[positionIndex] ?? '').split(',') : null;
    const lat = position ? position[0] : row[header ? latIndex : swap ? 1 : 0];
    const lng = position ? position[1] : row[header ? lonIndex : swap ? 0 : 1];
    const rawAlt = altIndex >= 0 ? row[altIndex] : undefined;
    const alt = number(rawAlt);
    if (rawAlt?.trim()) {
      hadAltitude = true;
      if (alt === null) badAltitude = true;
    } else if (altIndex >= 0 && (header || row.length > 2)) badAltitude = true;
    let time: number | null = null;
    if (isoIndex >= 0) time = timestamp(row[isoIndex]);
    if (time === null && dateIndex >= 0 && timeIndex >= 0 && h[timeIndex] === 'time')
      time = timestamp(`${row[dateIndex]}T${row[timeIndex]}`);
    if (time === null && timeIndex >= 0) time = timestamp(row[timeIndex]);
    if (time === null && dateIndex >= 0) time = timestamp(row[dateIndex]);
    const p = state.point(lat, lng, alt === null ? null : alt * altFactor, time);
    if (p) points.push(p);
  }
  if (badAltitude && hadAltitude) {
    for (const p of points) p.altM = null;
    state.warn('altitude_dropped', 'Mixed or invalid CSV altitudes were treated as unknown.');
  }
  return { paths: [{ points }] };
}
