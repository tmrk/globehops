/** Public-domain map-label decoding and screen-space atlas layout. */
export type LabelLocale = 'en' | 'hu' | 'sv';
export type LabelKind = 'country' | 'ocean' | 'sea';
export interface CountryLabel {
  kind: LabelKind;
  /** English identity; translated names need not be unique (e.g. North/South Atlantic). */
  name: string;
  names: Record<LabelLocale, string>;
  lat: number;
  lng: number;
  minZoom: number;
  rank: number;
}
export type MapLabelTuple = [LabelKind, string, string, string, number, number, number, number];

export interface LabelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function labelLocale(locale: string): LabelLocale {
  return locale === 'hu' || locale === 'sv' ? locale : 'en';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}
function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function decodeCountryLabels(raw: unknown): CountryLabel[] {
  if (
    !record(raw) ||
    raw.format !== 2 ||
    !record(raw.meta) ||
    !nonEmpty(raw.meta.source) ||
    !nonEmpty(raw.meta.version) ||
    !nonEmpty(raw.meta.license) ||
    !Array.isArray(raw.labels)
  )
    throw new Error('Invalid country label dataset');
  const names = new Set<string>();
  return raw.labels.map((tuple: unknown, index: number) => {
    if (!Array.isArray(tuple) || tuple.length !== 8) throw new Error(`Invalid country label ${index}`);
    const [kind, en, hu, sv, lat, lng, minZoom, rank] = tuple as unknown[];
    if (
      (kind !== 'country' && kind !== 'ocean' && kind !== 'sea') ||
      !nonEmpty(en) ||
      !nonEmpty(hu) ||
      !nonEmpty(sv) ||
      names.has(`${kind}|${en}`) ||
      !bounded(lat, -90, 90) ||
      !bounded(lng, -180, 180) ||
      !bounded(minZoom, 0, 12) ||
      !bounded(rank, 0, 20)
    )
      throw new Error(`Invalid country label ${index}`);
    names.add(`${kind}|${en}`);
    return { kind, name: en, names: { en, hu, sv }, lat, lng, minZoom, rank };
  });
}

/** CSS pixels per radian, equivalent to a 256px web-map tile at the equator. */
export function mapZoom(pxPerRadian: number): number {
  return Math.log2((pxPerRadian * 2 * Math.PI) / 256);
}

export function labelStyle(label: CountryLabel, zoom: number): { opacity: number; fontPx: number } | null {
  if (!Number.isFinite(zoom) || zoom < label.minZoom) return null;
  const beyond = zoom - label.minZoom;
  const base = label.kind === 'ocean' ? 16 : label.kind === 'sea' ? 13 : 14.5;
  return {
    opacity: Math.min(1, beyond / 0.6),
    fontPx: Math.max(10, Math.min(label.kind === 'ocean' ? 20 : 17, base - label.rank * 0.65 + beyond * 0.65)),
  };
}

/** Oceans lead at whole-globe scales; countries win equal-rank ties over seas. */
export function labelPriority(a: CountryLabel, b: CountryLabel): number {
  const order = { ocean: 0, country: 1, sea: 2 };
  return (
    a.rank - b.rank || order[a.kind] - order[b.kind] || a.minZoom - b.minZoom || a.name.localeCompare(b.name, 'en')
  );
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
