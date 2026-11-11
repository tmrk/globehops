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

/** How a kind of place name is set. */
export interface LabelType {
  italic: boolean;
  weight: number;
  /** Letter spacing in em; null takes the stylesheet's tracking for capitals (`--track-caps`). */
  tracking: number | null;
  lineHeight: number;
  uppercase: boolean;
  color: string;
  /** Lines wrap between words at this width in em; null keeps each written line whole. */
  wrapEm: number | null;
}

/**
 * Countries in tracked capitals; oceans in italic capitals, with their generic term on a second line; seas in
 * italic upper and lower case, wrapped at 11 em. Water is as bright as land, so it reads as background.
 */
export const LABEL_TYPE: Record<LabelKind, LabelType> = {
  country: {
    italic: false,
    weight: 600,
    tracking: 0.14,
    lineHeight: 1.3,
    uppercase: true,
    color: 'rgba(244, 241, 234, 0.78)',
    wrapEm: null,
  },
  ocean: {
    italic: true,
    weight: 500,
    tracking: null,
    lineHeight: 1.45,
    uppercase: true,
    color: 'rgba(177, 206, 222, 0.8)',
    wrapEm: null,
  },
  sea: {
    italic: true,
    weight: 500,
    tracking: 0.04,
    lineHeight: 1.3,
    uppercase: false,
    color: 'rgba(177, 206, 222, 0.8)',
    wrapEm: 11,
  },
};

/** Shadows that keep names legible over bright land and cloud, in CSS pixels, the topmost first. */
export const LABEL_SHADOWS = [
  { y: 1, blur: 4, color: 'rgba(3, 10, 19, 0.9)' },
  { y: 0, blur: 10, color: 'rgba(3, 10, 19, 0.5)' },
] as const;

/** A label's text in a locale, as set: a long ocean name keeps its generic term on a line of its own. */
export function labelText(label: CountryLabel, locale: LabelLocale): string {
  const name = label.names[locale];
  const text =
    label.kind === 'ocean' && name.length > 12 && name.includes(' ')
      ? `${name.slice(0, name.lastIndexOf(' '))}\n${name.slice(name.lastIndexOf(' ') + 1)}`
      : name;
  return LABEL_TYPE[label.kind].uppercase ? text.toLocaleUpperCase(locale) : text;
}

/**
 * Breaks text into lines at its own line breaks, then between words wherever a line would grow wider than
 * `maxWidth` (a single longer word keeps its own line). `measure` gives a line's width.
 */
export function labelLines(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  for (const written of text.split('\n')) {
    if (!(maxWidth < Infinity)) {
      lines.push(written);
      continue;
    }
    let line = '';
    for (const word of written.split(' ')) {
      const longer = line ? `${line} ${word}` : word;
      if (line && measure(longer) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = longer;
    }
    lines.push(line);
  }
  return lines;
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

export interface LabelStyle {
  opacity: number;
  fontPx: number;
}

/** A label's look at a zoom, or null while it is hidden; written into `target` when given (no allocation). */
export function labelStyle(
  label: CountryLabel,
  zoom: number,
  target: LabelStyle = { opacity: 0, fontPx: 0 },
): LabelStyle | null {
  if (!Number.isFinite(zoom) || zoom < label.minZoom) return null;
  const beyond = zoom - label.minZoom;
  const opacity = Math.min(1, beyond / 0.6);
  if (label.kind === 'ocean') {
    const quiet = Math.min(1, Math.max(0, (OCEAN_QUIET.goneAt - zoom) / (OCEAN_QUIET.goneAt - OCEAN_QUIET.fullBelow)));
    target.opacity = opacity * (1 - OCEAN_QUIET.opacity * quiet);
    // Oceans appear first but never outgrow the leading country names at the same zoom.
    target.fontPx = Math.max(
      10,
      namePx(14.5, LEADING_COUNTRY.rank, zoom - LEADING_COUNTRY.minZoom) - OCEAN_QUIET.fontPx * quiet,
    );
    return target;
  }
  // Seas sit just below countries of the same rank.
  target.opacity = opacity;
  target.fontPx = namePx(label.kind === 'sea' ? 13 : 14.5, label.rank, beyond);
  return target;
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
const LABEL_PADDING = 4;
const overlaps = (r: LabelRect, p: LabelRect) =>
  r.x0 < p.x1 + LABEL_PADDING &&
  r.x1 > p.x0 - LABEL_PADDING &&
  r.y0 < p.y1 + LABEL_PADDING &&
  r.y1 > p.y0 - LABEL_PADDING;

/**
 * Greedy placement in candidate order: a label shows unless it overlaps a reserved box or a label already
 * shown. Fills and returns `result`, so a caller placing labels every frame can reuse one array.
 */
export function placeLabels(
  candidates: readonly LabelRect[],
  reserved: readonly LabelRect[],
  result: boolean[] = [],
): boolean[] {
  result.length = candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i];
    let free = true;
    for (let j = 0; free && j < reserved.length; j++) free = !overlaps(r, reserved[j]);
    for (let j = 0; free && j < i; j++) free = !(result[j] && overlaps(r, candidates[j]));
    result[i] = free;
  }
  return result;
}
