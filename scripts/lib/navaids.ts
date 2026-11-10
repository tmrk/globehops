import { createHash } from 'node:crypto';
import { parseCsv } from './csv.ts';
import { decodeNavaids, NAVAID_TYPES, type NavaidMeta, type NavaidType } from '../../src/data/navaids.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export interface NavaidBuildOptions {
  generatedAt?: string;
  minRows?: number;
  minSelected?: number;
}
/** Pure strict CSV validation, followed by conservative radio-aid filtering. */
export function buildNavaids(text: string, options: NavaidBuildOptions = {}) {
  const [header, ...rows] = parseCsv(text);
  const required = ['id', 'ident', 'type', 'latitude_deg', 'longitude_deg', 'iso_country'];
  if (!header || new Set(header).size !== header.length || required.some((h) => !header.includes(h)))
    throw new Error('Missing navaids.csv columns');
  if (rows.length < (options.minRows ?? 5000)) throw new Error('Truncated navaids.csv');
  const codes = new Map(Object.entries(NAVAID_TYPES).map(([code, type]) => [type, code]));
  const counts = Object.fromEntries(Object.values(NAVAID_TYPES).map((type) => [type, 0])) as Record<NavaidType, number>;
  const navaids: [string, string, number, number, string][] = [];
  const ids = new Set<number>(),
    seen = new Set<string>();
  let dropped = 0;
  for (const row of rows) {
    if (row.length !== header.length) throw new Error('Malformed navaids.csv row');
    const r = Object.fromEntries(header.map((h, i) => [h, row[i].trim()]));
    const id = Number(r.id);
    if (!/^\d+$/.test(r.id) || !Number.isSafeInteger(id) || id < 1 || ids.has(id))
      throw new Error('Invalid or duplicate navaid id');
    ids.add(id);
    const code = codes.get(r.type as NavaidType);
    const ident = r.ident.toUpperCase(),
      country = r.iso_country.toUpperCase();
    const lat = r.latitude_deg ? Number(r.latitude_deg) : NaN,
      lng = r.longitude_deg ? Number(r.longitude_deg) : NaN;
    if (
      !code ||
      !/^[A-Z0-9]{1,5}$/.test(ident) ||
      !/^[A-Z]{2}$/.test(country) ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lng) ||
      Math.abs(lng) > 180
    ) {
      dropped++;
      continue;
    }
    const tuple: [string, string, number, number, string] = [
      ident,
      code,
      Number(lat.toFixed(5)),
      Number(lng.toFixed(5)),
      country,
    ];
    const key = JSON.stringify(tuple);
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    navaids.push(tuple);
    counts[r.type as NavaidType]++;
  }
  navaids.sort(
    (a, b) =>
      a[0].localeCompare(b[0], 'en') ||
      a[2] - b[2] ||
      a[3] - b[3] ||
      a[1].localeCompare(b[1], 'en') ||
      a[4].localeCompare(b[4], 'en'),
  );
  if (navaids.length < (options.minSelected ?? 5000)) throw new Error('Too few navaids');
  const meta: NavaidMeta = {
    source: 'OurAirports navaids.csv (https://ourairports.com/data/) — public domain',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    files: { 'navaids.csv': { sha256: hash(text), bytes: Buffer.byteLength(text), rows: rows.length } },
    counts,
    contentHash: hash(JSON.stringify(navaids)),
  };
  const dataset = { format: 1, meta, navaids };
  decodeNavaids(dataset);
  return { dataset, report: { ...meta, selected: navaids.length, dropped } };
}
