/** Public-domain OurAirports runway evidence; never an operational suitability assessment. */
export const DIVERSION_SURFACES = ['asphalt', 'concrete', 'bitumen', 'paved'] as const;
export type DiversionSurface = (typeof DIVERSION_SURFACES)[number];
export interface DiversionAirport {
  id: number;
  code: string;
  lat: number;
  lng: number;
  runwayM: number;
  widthM: number;
  surface: DiversionSurface;
}
export interface DiversionMeta {
  source: string;
  generatedAt: string;
  upstreamCommit: string | null;
  files: Record<string, { sha256: string; bytes: number; lastModified: string | null; rows: number }>;
  criteria: { types: string[]; minRunwayM: number; minWidthM: number; hardSurface: boolean; lightingRequired: boolean };
  counts: Record<string, number>;
  limitations: string;
  contentHash: string;
}
export interface DiversionDataset {
  meta: DiversionMeta;
  airports: DiversionAirport[];
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** Strict schema/criteria validation. Throws rather than silently accepting uncertain runway evidence. */
export function decodeDiversionAirports(raw: unknown): DiversionDataset {
  if (!record(raw) || raw.format !== 1 || !record(raw.meta) || !Array.isArray(raw.airports))
    throw new Error('Invalid diversion dataset: expected format 1, meta and airports');
  const m = raw.meta;
  if (
    !text(m.source) ||
    !text(m.generatedAt) ||
    !Number.isFinite(Date.parse(m.generatedAt)) ||
    !(m.upstreamCommit === null || (typeof m.upstreamCommit === 'string' && /^[a-f0-9]{40}$/.test(m.upstreamCommit))) ||
    !text(m.limitations) ||
    !hash(m.contentHash) ||
    !record(m.files) ||
    !record(m.criteria) ||
    !record(m.counts)
  )
    throw new Error('Invalid diversion metadata');
  for (const name of ['airports.csv', 'runways.csv']) {
    const f = m.files[name];
    if (
      !record(f) ||
      !hash(f.sha256) ||
      !count(f.bytes) ||
      !count(f.rows) ||
      !(f.lastModified === null || (text(f.lastModified) && Number.isFinite(Date.parse(f.lastModified))))
    )
      throw new Error(`Invalid diversion input metadata: ${name}`);
  }
  const c = m.criteria;
  if (
    !Array.isArray(c.types) ||
    c.types.length !== 2 ||
    c.types[0] !== 'large_airport' ||
    c.types[1] !== 'medium_airport' ||
    c.minRunwayM !== 2000 ||
    c.minWidthM !== 44 ||
    c.hardSurface !== true ||
    c.lightingRequired !== false ||
    !Object.values(m.counts).every(count) ||
    m.counts.airports !== raw.airports.length ||
    !count(m.counts.excludedUncertain)
  )
    throw new Error('Invalid diversion criteria or counts');
  let previous = 0;
  const airports = raw.airports.map((a: unknown): DiversionAirport => {
    if (!Array.isArray(a) || a.length !== 7 || !a.every((v, i) => (i === 1 ? text(v) : Number.isSafeInteger(v))))
      throw new Error('Invalid diversion airport tuple');
    const [id, code, lat, lng, runwayM, widthM, surface] = a as [
      number,
      string,
      number,
      number,
      number,
      number,
      number,
    ];
    if (
      id <= previous ||
      !/^[A-Z0-9-]{2,16}$/.test(code) ||
      Math.abs(lat) > 9000 ||
      Math.abs(lng) > 18000 ||
      runwayM < 2000 ||
      runwayM > 20000 ||
      widthM < 44 ||
      widthM > 1000 ||
      surface < 0 ||
      surface >= DIVERSION_SURFACES.length
    )
      throw new Error(`Invalid diversion airport ${id}`);
    previous = id;
    return { id, code, lat: lat / 100, lng: lng / 100, runwayM, widthM, surface: DIVERSION_SURFACES[surface] };
  });
  return { meta: m as unknown as DiversionMeta, airports };
}
export async function loadDiversionAirports(url: string, signal?: AbortSignal): Promise<DiversionDataset> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Diversion airports download failed: HTTP ${response.status}`);
  return decodeDiversionAirports(await response.json());
}
