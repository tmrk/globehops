/** Public-domain country label decoding and screen-space atlas layout. */
export interface CountryLabel {
  name: string;
  lat: number;
  lng: number;
  minZoom: number;
  rank: number;
}

export interface LabelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function decodeCountryLabels(raw: unknown): CountryLabel[] {
  if (
    !record(raw) ||
    raw.format !== 1 ||
    !record(raw.meta) ||
    !nonEmpty(raw.meta.source) ||
    !nonEmpty(raw.meta.version) ||
    !nonEmpty(raw.meta.license) ||
    !Array.isArray(raw.labels)
  )
    throw new Error('Invalid country label dataset');
  const names = new Set<string>();
  return raw.labels.map((tuple: unknown, index: number) => {
    if (!Array.isArray(tuple) || tuple.length !== 5) throw new Error(`Invalid country label ${index}`);
    const [name, lat, lng, minZoom, rank] = tuple as unknown[];
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name !== name.trim() ||
      names.has(name) ||
      typeof lat !== 'number' ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      typeof lng !== 'number' ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180 ||
      typeof minZoom !== 'number' ||
      !Number.isFinite(minZoom) ||
      minZoom < 0 ||
      minZoom > 12 ||
      typeof rank !== 'number' ||
      !Number.isFinite(rank) ||
      rank < 0 ||
      rank > 20
    )
      throw new Error(`Invalid country label ${index}`);
    names.add(name);
    return { name, lat, lng, minZoom, rank };
  });
}

/** CSS pixels per radian, equivalent to a 256px web-map tile at the equator. */
export function mapZoom(pxPerRadian: number): number {
  return Math.log2((pxPerRadian * 2 * Math.PI) / 256);
}

export function labelStyle(label: CountryLabel, zoom: number): { opacity: number; fontPx: number } | null {
  if (!Number.isFinite(zoom) || zoom < label.minZoom) return null;
  const beyond = zoom - label.minZoom;
  return {
    opacity: Math.min(1, beyond / 0.6),
    fontPx: Math.max(10, Math.min(17, 14.5 - label.rank * 0.65 + beyond * 0.65)),
  };
}

/** Input order is priority; airports always win. Padding keeps neighbouring text visually separate. */
export function placeLabels(candidates: readonly LabelRect[], reserved: readonly LabelRect[]): boolean[] {
  const placed = [...reserved];
  const padding = 4;
  return candidates.map((r) => {
    const collides = placed.some(
      (p) => r.x0 < p.x1 + padding && r.x1 > p.x0 - padding && r.y0 < p.y1 + padding && r.y1 > p.y0 - padding,
    );
    if (!collides) placed.push(r);
    return !collides;
  });
}
