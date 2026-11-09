/** Pure, deterministic runway filtering. Node-native erasable TypeScript; no network or filesystem. */
import { createHash } from 'node:crypto';
import { parseCsv } from './csv.ts';
import { isValidLatLng } from '../../src/lib/geo.ts';
import {
  decodeDiversionAirports,
  DIVERSION_SURFACES,
  type DiversionMeta,
  type DiversionSurface,
} from '../../src/data/diversion.ts';
export const DIVERSION_CRITERIA = {
  types: ['large_airport', 'medium_airport'],
  minRunwayM: 2000,
  minWidthM: 44,
  hardSurface: true,
  lightingRequired: false,
};
export const DIVERSION_LIMITATIONS =
  'Potential diversion airports and modelled coverage only; not an operator’s authorisation. Runway evidence cannot establish operational suitability: RFFS, hours, weather, NOTAMs, approach aids, fuel, pavement strength and permission (including military access) are unknown. Lighting is recorded, not required.';
export const inputHash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Only recognised hard surfaces, including quality suffixes and asphalt/concrete mixtures, qualify. */
export function normaliseSurface(raw: string): DiversionSurface | 'unpaved' | 'unknown' {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  const base = s.replace(/-[GFPE](?=[/-]|$)/g, '');
  if (/^(ASP|ASPH|ASPHALT)$/.test(base)) return 'asphalt';
  if (/^(CON|CONC|CONCRETE)$/.test(base)) return 'concrete';
  if (/^(BIT|BITUMEN)$/.test(base)) return 'bitumen';
  if (/^(PEM|PAVED)$/.test(base)) return 'paved';
  if (
    /^(ASP|ASPH|ASPHALT)[/-](CON|CONC|CONCRETE)$/.test(base) ||
    /^(CON|CONC|CONCRETE)[/-](ASP|ASPH|ASPHALT)$/.test(base)
  )
    return 'paved';
  if (/(TURF|GRS|GRASS|GRE|GVL|GRAVEL|GRVL|DIRT|EARTH|WATER|SAND|CORAL|MATS|SNOW|ICE|CLAY|WOOD|PSP)/.test(s))
    return 'unpaved';
  return 'unknown';
}
const HEADERS = {
  'airports.csv': ['id', 'ident', 'type', 'latitude_deg', 'longitude_deg', 'iata_code', 'icao_code', 'gps_code'],
  'runways.csv': ['id', 'airport_ref', 'airport_ident', 'length_ft', 'width_ft', 'surface', 'lighted', 'closed'],
};
export type DiversionInputs = Record<keyof typeof HEADERS, string>;
export interface DiversionBuildOptions {
  generatedAt?: string;
  upstreamCommit?: string | null;
  lastModified?: Partial<Record<keyof DiversionInputs, string | null>>;
  excluded?: Record<string, string>;
  /** Synthetic fixtures only. Production refuses truncated inputs and unexpectedly small output. */
  validation?: { minAirports?: number; minRunways?: number; minSelected?: number };
}
function table(source: string, name: keyof DiversionInputs, min: number) {
  const [header, ...rows] = parseCsv(source);
  if (!header || new Set(header).size !== header.length || HEADERS[name].some((h) => !header.includes(h)))
    throw new Error(`Missing required columns in ${name}`);
  if (rows.length < min) throw new Error(`Truncated ${name}: ${rows.length} rows`);
  const ids = new Set<number>();
  return rows.map((r, i) => {
    if (r.length !== header.length) throw new Error(`Malformed ${name} row ${i + 2}`);
    const row = Object.fromEntries(header.map((h, j) => [h, r[j].trim()]));
    const id = Number(row.id);
    if (!/^\d+$/.test(row.id) || !Number.isSafeInteger(id) || id < 1 || ids.has(id))
      throw new Error(`Invalid/duplicate ${name} id ${row.id}`);
    ids.add(id);
    return row;
  });
}
function feet(raw: string): number | null {
  if (!raw || raw === '-1') return null; // OurAirports uses -1 for unknown dimensions in some records.
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid runway dimension ${raw}`);
  return n * 0.3048;
}
export function buildDiversionAirports(inputs: DiversionInputs, options: DiversionBuildOptions = {}) {
  const airports = table(inputs['airports.csv'], 'airports.csv', options.validation?.minAirports ?? 50000);
  const runways = table(inputs['runways.csv'], 'runways.csv', options.validation?.minRunways ?? 30000);
  const counts = {
    airports: 0,
    inputAirports: airports.length,
    inputRunways: runways.length,
    excludedType: 0,
    excludedPosition: 0,
    excludedReviewed: 0,
    excludedNoRunway: 0,
    excludedClosed: 0,
    excludedUncertain: 0,
    excludedUnpaved: 0,
    excludedLength: 0,
    excludedWidth: 0,
    qualifyingRunways: 0,
    lighted: 0,
    unlighted: 0,
    lightingUnknown: 0,
  };
  const candidates = new Map<number, { code: string; lat: number; lng: number; ident: string }>();
  for (const a of airports) {
    if (!DIVERSION_CRITERIA.types.includes(a.type)) {
      counts.excludedType++;
      continue;
    }
    if (options.excluded && Object.hasOwn(options.excluded, a.ident)) {
      counts.excludedReviewed++;
      continue;
    }
    const lat = a.latitude_deg ? Number(a.latitude_deg) : NaN,
      lng = a.longitude_deg ? Number(a.longitude_deg) : NaN;
    if (!isValidLatLng({ lat, lng }) || (lat === 0 && lng === 0)) {
      counts.excludedPosition++;
      continue;
    }
    const code = (
      [
        [a.iata_code, /^[A-Z]{3}$/],
        [a.icao_code, /^[A-Z]{4}$/],
        [a.gps_code, /^[A-Z0-9]{3,8}$/],
        [a.ident, /^[A-Z0-9-]{2,16}$/],
      ] as const
    )
      .map(([value, pattern]) => (pattern.test(value.toUpperCase()) ? value.toUpperCase() : ''))
      .find(Boolean);
    if (!code) throw new Error(`Invalid airport identity ${a.id}`);
    candidates.set(Number(a.id), { code, lat, lng, ident: a.ident });
  }
  const mapping: Record<string, { surface: ReturnType<typeof normaliseSurface>; count: number }> = {};
  type Selected = {
    id: number;
    code: string;
    lat: number;
    lng: number;
    runwayM: number;
    widthM: number;
    surface: DiversionSurface;
    runwayId: number;
    lighted: string;
  };
  const selected = new Map<number, Selected>();
  for (const r of runways) {
    if (!/^\d+$/.test(r.airport_ref)) throw new Error(`Invalid runway airport_ref ${r.id}`);
    if (!['', '0', '1'].includes(r.closed) || !['', '0', '1'].includes(r.lighted))
      throw new Error(`Invalid runway flags ${r.id}`);
    const length = feet(r.length_ft),
      width = feet(r.width_ft),
      surface = normaliseSurface(r.surface);
    const key = r.surface.toUpperCase() || '(blank)';
    mapping[key] ??= { surface, count: 0 };
    mapping[key].count++;
    const id = Number(r.airport_ref),
      a = candidates.get(id);
    if (!a) continue;
    if (r.airport_ident !== a.ident) throw new Error(`Runway airport identity mismatch ${r.id}`);
    if (r.closed === '1') {
      counts.excludedClosed++;
      continue;
    }
    if (surface === 'unknown' || width === null) {
      counts.excludedUncertain++;
      continue;
    }
    if (surface === 'unpaved') {
      counts.excludedUnpaved++;
      continue;
    }
    if (length === null || length < 2000) {
      counts.excludedLength++;
      continue;
    }
    if (width < 44) {
      counts.excludedWidth++;
      continue;
    }
    counts.qualifyingRunways++;
    const prev = selected.get(id);
    if (!prev || length > prev.runwayM || (length === prev.runwayM && Number(r.id) < prev.runwayId))
      selected.set(id, {
        id,
        ...a,
        runwayM: length,
        widthM: width,
        surface,
        runwayId: Number(r.id),
        lighted: r.lighted,
      });
  }
  counts.airports = selected.size;
  counts.excludedNoRunway = candidates.size - selected.size;
  const tuples = [...selected.values()]
    .sort((a, b) => a.id - b.id)
    .map((a) => {
      counts[a.lighted === '1' ? 'lighted' : a.lighted === '0' ? 'unlighted' : 'lightingUnknown']++;
      return [
        a.id,
        a.code,
        Math.round(a.lat * 100),
        Math.round(a.lng * 100),
        Math.round(a.runwayM),
        Math.round(a.widthM),
        DIVERSION_SURFACES.indexOf(a.surface),
      ] as [number, string, number, number, number, number, number];
    });
  if (tuples.length < (options.validation?.minSelected ?? 1000))
    throw new Error(`Too few potential diversion airports: ${tuples.length}`);
  const files = Object.fromEntries(
    Object.entries(inputs).map(([name, s]) => [
      name,
      {
        sha256: inputHash(s),
        bytes: Buffer.byteLength(s),
        lastModified: options.lastModified?.[name as keyof DiversionInputs] ?? null,
        rows: name === 'airports.csv' ? airports.length : runways.length,
      },
    ]),
  );
  const meta: DiversionMeta = {
    source: 'OurAirports airports.csv and runways.csv (https://ourairports.com/data/) — public domain',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    upstreamCommit: options.upstreamCommit ?? null,
    files,
    criteria: DIVERSION_CRITERIA,
    counts,
    limitations: DIVERSION_LIMITATIONS,
    contentHash: inputHash(JSON.stringify({ criteria: DIVERSION_CRITERIA, airports: tuples })),
  };
  const dataset = { format: 1 as const, meta, airports: tuples };
  decodeDiversionAirports(dataset);
  return {
    dataset,
    report: {
      ...meta,
      // Build-record evidence only: lighting never enters eligibility or the compact runtime tuples.
      selectedRunways: [...selected.values()]
        .sort((a, b) => a.id - b.id)
        .map((a) => [a.id, a.runwayId, a.lighted === '' ? null : Number(a.lighted)] as [number, number, number | null]),
      surfaceMapping: Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b, 'en'))),
    },
  };
}
