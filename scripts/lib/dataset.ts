import { createHash } from 'node:crypto';
import { parseCsv } from './csv.ts';
import { normalizeText } from '../../src/lib/normalize.ts';
import { isValidLatLng } from '../../src/lib/geo.ts';

export const FILE_NAMES = ['airports.csv', 'countries.csv', 'regions.csv'] as const;
export type FileName = (typeof FILE_NAMES)[number];
export type DatasetInputs = Record<FileName, string>;
export type AirportTuple = [
  number,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  string,
  number,
  string,
];
export interface BuildOptions {
  aliases?: Record<string, string[]>;
  previousCount?: number;
  generatedAt?: string;
  upstreamCommit?: string | null;
  lastModified?: Partial<Record<FileName, string | null>>;
  /** Override production thresholds only for small, synthetic unit fixtures. */
  validation?: {
    minRows?: Partial<Record<FileName, number>>;
    minSelected?: number;
    sentinels?: Record<string, [number, number]>;
  };
}
const HEADERS: Record<FileName, string[]> = {
  'airports.csv': [
    'id',
    'ident',
    'type',
    'name',
    'latitude_deg',
    'longitude_deg',
    'iso_country',
    'iso_region',
    'municipality',
    'scheduled_service',
    'icao_code',
    'iata_code',
    'gps_code',
    'keywords',
  ],
  'countries.csv': ['code', 'name'],
  'regions.csv': ['code', 'name'],
};
const MIN_ROWS: Record<FileName, number> = { 'airports.csv': 50000, 'countries.csv': 200, 'regions.csv': 3000 };
const SENTINELS: Record<string, [number, number]> = {
  CPH: [55.618, 12.656],
  LHR: [51.471, -0.462],
  JFK: [40.64, -73.779],
  LAX: [33.943, -118.408],
  SYD: [-33.946, 151.177],
  DXB: [25.253, 55.364],
  SIN: [1.35, 103.994],
  NRT: [35.765, 140.386],
  HND: [35.552, 139.78],
  GRU: [-23.432, -46.47],
  JNB: [-26.139, 28.246],
  ARN: [59.652, 17.919],
  HEL: [60.317, 24.963],
  MMX: [55.536, 13.376],
  YYZ: [43.677, -79.631],
  AKL: [-37.008, 174.792],
  ANC: [61.174, -149.998],
  SCL: [-33.393, -70.786],
  CDG: [49.01, 2.548],
  FRA: [50.033, 8.571],
};
const TYPES: Record<string, string> = {
  large_airport: 'L',
  medium_airport: 'M',
  small_airport: 'S',
  seaplane_base: 'W',
  heliport: 'H',
};
const RANK: Record<string, number> = { L: 5, M: 4, S: 3, W: 2, H: 1 };
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const code = (s: string, re: RegExp) => (re.test(s.trim().toUpperCase()) ? s.trim().toUpperCase() : '');

/** Pure build: validates all sources and output before returning anything to the I/O layer. */
export function buildDataset(inputs: DatasetInputs, options: BuildOptions = {}) {
  const tables = {} as Record<FileName, Record<string, string>[]>;
  const files = {} as Record<FileName, { sha256: string; bytes: number; lastModified: string | null; rows: number }>;
  for (const name of FILE_NAMES) {
    const [header, ...rows] = parseCsv(inputs[name]);
    if (!header || HEADERS[name].some((h) => !header.includes(h)))
      throw new Error(`Missing required columns in ${name}`);
    if (rows.length < (options.validation?.minRows?.[name] ?? MIN_ROWS[name]))
      throw new Error(`Truncated ${name}: ${rows.length} rows`);
    tables[name] = rows.map((row, i) => {
      if (row.length !== header.length) throw new Error(`Malformed ${name} row ${i + 2}`);
      return Object.fromEntries(header.map((h, j) => [h, row[j]]));
    });
    files[name] = {
      sha256: sha256(inputs[name]),
      bytes: Buffer.byteLength(inputs[name]),
      lastModified: options.lastModified?.[name] ?? null,
      rows: rows.length,
    };
  }
  const countryNames = new Map(tables['countries.csv'].map((r) => [r.code, clean(r.name)]));
  const regionNames = new Map(tables['regions.csv'].map((r) => [r.code, clean(r.name)]));
  const airports: AirportTuple[] = [];
  const keywords = new Map<number, string[]>();
  let dropped = 0;
  for (const row of tables['airports.csv']) {
    if (['closed', 'closed_airport', 'balloonport'].includes(row.type)) continue;
    const iata = code(row.iata_code, /^[A-Z]{3}$/),
      scheduled = row.scheduled_service === 'yes';
    if (!iata && !scheduled && !['large_airport', 'medium_airport'].includes(row.type)) continue;
    const lat = row.latitude_deg.trim() ? Number(row.latitude_deg) : NaN;
    const lng = row.longitude_deg.trim() ? Number(row.longitude_deg) : NaN;
    const name = clean(row.name),
      city = clean(row.municipality),
      id = Number(row.id);
    if (!isValidLatLng({ lat, lng }) || (lat === 0 && lng === 0) || !name) {
      dropped++;
      continue;
    }
    if (!Number.isSafeInteger(id) || id < 1 || !row.ident.trim() || !TYPES[row.type])
      throw new Error(`Invalid identity or type for ${row.ident}`);
    const icao = code(row.icao_code, /^[A-Z]{4}$/) || code(row.gps_code, /^[A-Z]{4}$/);
    const region = ['US', 'CA', 'AU'].includes(row.iso_country) ? row.iso_region : '';
    airports.push([
      id,
      row.ident.trim(),
      iata,
      icao,
      name,
      city,
      row.iso_country,
      region,
      +lat.toFixed(4),
      +lng.toFixed(4),
      TYPES[row.type],
      +scheduled,
      '',
    ]);
    keywords.set(id, [...row.keywords.split(','), ...(options.aliases?.[iata] ?? [])]);
  }
  const duplicates = { iata: 0, icao: 0 };
  // Sort candidates before clearing either code, so ICAO availability has the same
  // meaning when resolving both namespaces. The ranking is independent of input order.
  const ranked = [...airports].sort(
    (a, b) => b[11] - a[11] || RANK[b[10]] - RANK[a[10]] || +!!b[3] - +!!a[3] || a[0] - b[0],
  );
  for (const [field, key] of [
    [2, 'iata'],
    [3, 'icao'],
  ] as const) {
    const seen = new Set<string>();
    for (const a of ranked) {
      const c = a[field];
      if (!c) continue;
      if (seen.has(c)) {
        keywords.get(a[0])!.unshift(c);
        a[field] = '';
        duplicates[key]++;
      } else seen.add(c);
    }
  }
  const countries: Record<string, string> = {},
    regions: Record<string, string> = {};
  const ids = new Set<number>();
  for (const a of airports) {
    if (ids.has(a[0])) throw new Error(`Duplicate airport id ${a[0]}`);
    ids.add(a[0]);
    if (!isValidLatLng({ lat: a[8], lng: a[9] }) || !a[4]) throw new Error(`Invalid output airport ${a[0]}`);
    countries[a[6]] = countryNames.get(a[6]) || a[6];
    if (a[7]) regions[a[7]] = regionNames.get(a[7]) || a[7];
    const seen = new Set([a[4], a[5], a[2], a[3]].map(normalizeText));
    const kept: string[] = [];
    for (const value of keywords.get(a[0])!) {
      const kw = clean(value).replace(/\|/g, ' ').slice(0, 60).trim(),
        normalized = normalizeText(kw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      kept.push(kw);
      if (kept.length === 12) break;
    }
    a[12] = kept.join('|');
  }
  if (
    airports.length < (options.validation?.minSelected ?? 8000) ||
    airports.length < (options.previousCount ?? 0) * 0.9
  )
    throw new Error(`Too few selected airports: ${airports.length}`);
  const byIata = new Map(airports.map((a) => [a[2], a]));
  for (const [c, [lat, lng]] of Object.entries(options.validation?.sentinels ?? SENTINELS)) {
    const a = byIata.get(c);
    if (!a || Math.abs(a[8] - lat) > 0.2 || Math.abs(a[9] - lng) > 0.2)
      throw new Error(`Missing or misplaced sentinel ${c}`);
  }
  airports.sort((a, b) => a[0] - b[0]);
  const sorted = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const content = { countries: sorted(countries), regions: sorted(regions), airports };
  const meta = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: 'OurAirports (https://ourairports.com/data/) — public domain',
    upstreamCommit: options.upstreamCommit ?? null,
    files,
    counts: {
      airports: airports.length,
      scheduled: airports.filter((a) => a[11]).length,
      withIata: airports.filter((a) => a[2]).length,
    },
    contentHash: sha256(JSON.stringify(content)),
  };
  return { dataset: { format: 1, meta, ...content }, report: { dropped, duplicates } };
}

export function serializeDataset(dataset: ReturnType<typeof buildDataset>['dataset']): string {
  const { airports, ...header } = dataset;
  return `${JSON.stringify(header).slice(0, -1)},"airports":[\n${airports.map((a) => JSON.stringify(a)).join(',\n')}\n]}\n`;
}
