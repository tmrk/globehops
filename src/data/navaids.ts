/** Public-domain radio aids for visualising pasted plans; never navigation data. */
export const NAVAID_TYPES = {
  V: 'VOR',
  R: 'VOR-DME',
  T: 'VORTAC',
  A: 'TACAN',
  N: 'NDB',
  B: 'NDB-DME',
  D: 'DME',
} as const;
export type NavaidType = (typeof NAVAID_TYPES)[keyof typeof NAVAID_TYPES];
export interface Navaid {
  ident: string;
  type: NavaidType;
  lat: number;
  lng: number;
  country: string;
}
export interface NavaidMeta {
  source: string;
  generatedAt: string;
  files: Record<string, { sha256: string; bytes: number; rows: number }>;
  counts: Record<NavaidType, number>;
  contentHash: string;
}
export interface NavaidDataset {
  meta: NavaidMeta;
  navaids: Navaid[];
  byIdent: Map<string, Navaid[]>;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function decodeNavaids(raw: unknown): NavaidDataset {
  if (!record(raw) || raw.format !== 1 || !record(raw.meta) || !Array.isArray(raw.navaids))
    throw new Error('Invalid navaid dataset');
  const m = raw.meta;
  if (
    typeof m.source !== 'string' ||
    !m.source.trim() ||
    typeof m.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(m.generatedAt)) ||
    !hash(m.contentHash) ||
    !record(m.files) ||
    !record(m.counts)
  )
    throw new Error('Invalid navaid metadata');
  const f = m.files['navaids.csv'];
  if (Object.keys(m.files).length !== 1 || !record(f) || !hash(f.sha256) || !count(f.bytes) || !count(f.rows))
    throw new Error('Invalid navaid source metadata');
  if (
    Object.keys(m.counts).length !== Object.keys(NAVAID_TYPES).length ||
    !Object.values(NAVAID_TYPES).every((type) => count((m.counts as Record<string, unknown>)[type]))
  )
    throw new Error('Invalid navaid counts');
  const byIdent = new Map<string, Navaid[]>();
  const actual: Record<string, number> = Object.fromEntries(Object.values(NAVAID_TYPES).map((t) => [t, 0]));
  const seen = new Set<string>();
  const navaids = raw.navaids.map((row: unknown): Navaid => {
    if (!Array.isArray(row) || row.length !== 5) throw new Error('Invalid navaid tuple');
    const [ident, code, lat, lng, country] = row as unknown[];
    if (
      typeof ident !== 'string' ||
      !/^[A-Z0-9]{1,5}$/.test(ident) ||
      typeof code !== 'string' ||
      !Object.hasOwn(NAVAID_TYPES, code) ||
      typeof lat !== 'number' ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      typeof lng !== 'number' ||
      !Number.isFinite(lng) ||
      Math.abs(lng) > 180 ||
      typeof country !== 'string' ||
      !/^[A-Z]{2}$/.test(country)
    )
      throw new Error('Invalid navaid values');
    const key = JSON.stringify(row);
    if (seen.has(key)) throw new Error('Duplicate navaid');
    seen.add(key);
    const navaid: Navaid = { ident, type: NAVAID_TYPES[code as keyof typeof NAVAID_TYPES], lat, lng, country };
    actual[navaid.type]++;
    const list = byIdent.get(ident) ?? [];
    list.push(navaid);
    byIdent.set(ident, list);
    return navaid;
  });
  if (
    !Object.entries(actual).every(([type, n]) => (m.counts as Record<string, unknown>)[type] === n) ||
    f.rows < navaids.length
  )
    throw new Error('Navaid counts disagree');
  return { meta: m as unknown as NavaidMeta, navaids, byIdent };
}
export async function loadNavaids(url: string): Promise<NavaidDataset> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Navaids download failed: HTTP ${response.status}`);
  return decodeNavaids(await response.json());
}
