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

/** The most prominent country names (Natural Earth rank 2, shown from zoom 1.7: USA, Brazil, China…). */
const LEADING_COUNTRY = { rank: 2, minZoom: 1.7 };

function namePx(base: number, rank: number, beyond: number): number {
  return Math.max(10, Math.min(17, base - rank * 0.65 + beyond * 0.65));
}

/**
 * Whole-globe views (about zoom 1.7–2.7 on a phone, 2.7–3.6 on a desktop) keep ocean names smaller and fainter, as
 * background; they ease back to the leading country size and full strength by regional zoom.
 */
const OCEAN_QUIET = { fullBelow: 3.6, goneAt: 5.2, fontPx: 2.5, opacity: 0.3 };

export function labelStyle(label: CountryLabel, zoom: number): { opacity: number; fontPx: number } | null {
  if (!Number.isFinite(zoom) || zoom < label.minZoom) return null;
  const beyond = zoom - label.minZoom;
  const opacity = Math.min(1, beyond / 0.6);
  if (label.kind === 'ocean') {
    const quiet = Math.min(1, Math.max(0, (OCEAN_QUIET.goneAt - zoom) / (OCEAN_QUIET.goneAt - OCEAN_QUIET.fullBelow)));
    return {
      opacity: opacity * (1 - OCEAN_QUIET.opacity * quiet),
      // Oceans appear first but never outgrow the leading country names at the same zoom.
      fontPx: Math.max(
        10,
        namePx(14.5, LEADING_COUNTRY.rank, zoom - LEADING_COUNTRY.minZoom) - OCEAN_QUIET.fontPx * quiet,
      ),
    };
  }
  // Seas sit just below countries of the same rank.
  return { opacity, fontPx: namePx(label.kind === 'sea' ? 13 : 14.5, label.rank, beyond) };
}

/**
 * Oceans rank with the leading country names: those countries and the major seas win collisions, while oceans
 * still lead smaller seas and countries. Countries win equal-rank ties over oceans and seas.
 */
export function labelPriority(a: CountryLabel, b: CountryLabel): number {
  const order = { country: 0, ocean: 1, sea: 2 };
  const rank = (label: CountryLabel) =>
    label.kind === 'ocean' ? Math.max(label.rank, LEADING_COUNTRY.rank) : label.rank;
  return (
    rank(a) - rank(b) || order[a.kind] - order[b.kind] || a.minZoom - b.minZoom || a.name.localeCompare(b.name, 'en')
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
