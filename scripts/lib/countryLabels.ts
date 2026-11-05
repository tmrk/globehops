/** Pure extraction of Natural Earth's cartographic names and curated label points. */
import { decodeCountryLabels } from '../../src/lib/countryLabels.ts';

export const COUNTRY_LABEL_SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';
export const MIN_COUNTRY_LABELS = 180;
export interface CountryLabelDataset {
  format: 1;
  meta: { source: string; version: string; license: string };
  labels: [string, number, number, number, number][];
}

// NAME already uses cartographic abbreviations. Only this unusually long name needs shortening.
const DISPLAY_NAMES: Readonly<Record<string, string>> = { 'United States of America': 'United States' };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function buildCountryLabels(raw: unknown): CountryLabelDataset {
  if (!record(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    throw new Error('Country labels source must be a GeoJSON FeatureCollection');
  }
  const labels: CountryLabelDataset['labels'] = [];
  for (const feature of raw.features) {
    if (!record(feature) || feature.type !== 'Feature') throw new Error('Invalid country label feature');
    const p = feature.properties;
    if (
      !record(p) ||
      typeof p.NAME !== 'string' ||
      !p.NAME.trim() ||
      !inRange(p.LABEL_Y, -90, 90) ||
      !inRange(p.LABEL_X, -180, 180)
    )
      continue;
    if (!inRange(p.MIN_LABEL, 0, 12) || !inRange(p.LABELRANK, 0, 20)) {
      throw new Error(`Invalid country label zoom/rank: ${p.NAME}`);
    }
    const name = p.NAME.trim();
    labels.push([
      Object.hasOwn(DISPLAY_NAMES, name) ? DISPLAY_NAMES[name] : name,
      Math.round(p.LABEL_Y * 100) / 100,
      Math.round(p.LABEL_X * 100) / 100,
      Math.round(p.MIN_LABEL * 10) / 10,
      p.LABELRANK,
    ]);
  }
  labels.sort((a, b) => a[4] - b[4] || a[3] - b[3] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    format: 1,
    meta: { source: COUNTRY_LABEL_SOURCE_URL, version: '5.1.2', license: 'Public domain (Natural Earth)' },
    labels,
  };
}

/** A lower threshold is only for small synthetic fixtures; production writes always require 180. */
export function validateCountryLabels(dataset: CountryLabelDataset, minLabels = MIN_COUNTRY_LABELS): number {
  const labels = decodeCountryLabels(dataset);
  if (labels.length < minLabels)
    throw new Error(`Too few country labels: ${labels.length}; expected at least ${minLabels}`);
  return labels.length;
}
