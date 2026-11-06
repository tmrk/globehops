import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeDataset } from '../../src/data/airports.ts';
import type { Airport } from '../../src/types.ts';
import { buildPlaceNames, decodePlaceNameOverrides } from './placeNames.ts';

const airport = (city = 'Vienna', countryCode = 'AT', lat = 48.1, lng = 16.5): Airport => ({
  id: 1,
  ident: 'TEST',
  iata: 'VIE',
  icao: null,
  name: 'Airport',
  city,
  countryCode,
  country: 'Austria',
  region: '',
  lat,
  lng,
  type: 'large',
  scheduled: true,
  keywords: [],
});
const place = (properties: Record<string, unknown> = {}) => ({
  type: 'Feature',
  properties: {
    NAME: 'Vienna',
    NAME_EN: 'Vienna',
    NAMEASCII: 'Vienna',
    NAMEALT: 'Wien|Becs',
    NAME_HU: 'Bécs',
    NAME_SV: 'Wien',
    ISO_A2: 'AT',
    ADM0_A3: 'AUT',
    LATITUDE: 48.2,
    LONGITUDE: 16.37,
    ...properties,
  },
});
const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });

describe('conservative populated-place matching', () => {
  it('matches normalized aliases, parenthetical detail and country codes, emitting only changed names', () => {
    const { dataset, stats } = buildPlaceNames(collection(place()), [
      airport(),
      airport('Wien (city)'),
      airport('Bécs'),
    ]);
    expect(dataset.names.hu).toEqual({ 'Vienna|AT': 'Bécs', 'Wien (city)|AT': 'Bécs' });
    expect(dataset.names.sv).toEqual({ 'Bécs|AT': 'Wien', 'Vienna|AT': 'Wien' });
    expect(stats.matchedCities).toBe(3);
    expect(stats.matchedScheduled).toBe(3);
  });
  it('keeps namesakes in different countries separate and requires an airport within 75 km', () => {
    const raw = collection(
      place({
        NAME: 'London',
        NAME_EN: 'London',
        NAMEASCII: 'London',
        NAMEALT: null,
        ISO_A2: 'GB',
        NAME_HU: 'UK only',
        NAME_SV: 'UK only',
        LATITUDE: 51.5,
        LONGITUDE: -0.1,
      }),
    );
    const { dataset, stats } = buildPlaceNames(raw, [airport('London', 'CA', 43, -81), airport('London', 'GB', 0, 0)]);
    expect(dataset.names.hu).toEqual({});
    expect(stats.matchedCities).toBe(0);
  });
  it('allows a shared city with one nearby airport and skips multiple nearby candidate places', () => {
    const group = [airport(), airport('Vienna', 'AT', 0, 0)];
    expect(buildPlaceNames(collection(place()), group).stats.matchedCities).toBe(1);
    const ambiguous = buildPlaceNames(collection(place(), place({ LATITUDE: 48.21 })), group);
    expect(ambiguous.stats.ambiguousCities).toBe(1);
    expect(ambiguous.dataset.names.hu).toEqual({});
  });
  it('handles NE -99 country codes through the reviewed ADM0_A3 mapping', () => {
    for (const [a3, a2] of [
      ['KOS', 'XK'],
      ['CYN', 'CY'],
      ['SOL', 'SO'],
    ])
      expect(
        buildPlaceNames(collection(place({ ISO_A2: '-99', ADM0_A3: a3 })), [airport('Vienna', a2)]).stats.matchedCities,
      ).toBe(1);
    expect(
      buildPlaceNames(collection(place({ ISO_A2: '-99', ADM0_A3: 'UNKNOWN' })), [airport()]).stats.matchedCities,
    ).toBe(0);
  });
  it('supports reasoned additions, corrections and removals without changing other countries', () => {
    const overrides = decodePlaceNameOverrides({
      format: 1,
      labels: [],
      cities: [
        { key: 'Vienna|AT', names: { hu: null, sv: 'Corrected' }, reason: 'test correction/removal' },
        { key: 'Other|AT', names: { hu: 'Added' }, reason: 'test addition' },
      ],
    });
    const { dataset } = buildPlaceNames(
      collection(place()),
      [airport(), airport('Other'), airport('Other', 'DE')],
      overrides,
    );
    expect(dataset.names.hu).toEqual({ 'Other|AT': 'Added' });
    expect(dataset.names.sv).toEqual({ 'Vienna|AT': 'Corrected' });
  });
  it('is deterministic across source and airport ordering', () => {
    const first = place(),
      second = place({ NAME: 'Other', NAME_EN: 'Other', NAMEASCII: 'Other', NAMEALT: null });
    const airports = [airport(), airport('Other')];
    expect(buildPlaceNames(collection(first, second), airports).dataset).toEqual(
      buildPlaceNames(collection(second, first), [...airports].reverse()).dataset,
    );
  });
  it('skips invalid points and missing translations; rejects malformed source/overrides', () => {
    expect(
      buildPlaceNames(collection(place({ LATITUDE: NaN }), place({ NAME_HU: null, NAME_SV: '' })), [airport()]).dataset
        .names.hu,
    ).toEqual({});
    expect(() => buildPlaceNames(null, [])).toThrow();
    expect(() => buildPlaceNames(collection(null), [])).toThrow();
    for (const raw of [
      null,
      { format: 1, cities: [], labels: [{ kind: 'ocean', key: 'Ocean', names: {}, point: [100, 0], reason: 'test' }] },
      { format: 1, labels: [], cities: [{ key: 'Vienna|AT', names: { hu: 'Bécs' }, reason: '' }] },
      { format: 1, labels: [], cities: [{ key: 'Vienna', names: { hu: 'Bécs' }, reason: 'test' }] },
    ])
      expect(() => decodePlaceNameOverrides(raw)).toThrow();
  });

  const cache = new URL('../../.cache/naturalearth/ne_10m_populated_places.geojson', import.meta.url);
  it.skipIf(!existsSync(cache))('rebuilds the committed city dictionary from the pinned cache', () => {
    const raw: unknown = JSON.parse(readFileSync(cache, 'utf8'));
    const airports = decodeDataset(
      JSON.parse(readFileSync(new URL('../../src/data/generated/airports.json', import.meta.url), 'utf8')),
    ).airports;
    const overrides = decodePlaceNameOverrides(
      JSON.parse(readFileSync(new URL('../../data/place-names.json', import.meta.url), 'utf8')),
    );
    const { dataset, stats } = buildPlaceNames(raw, airports, overrides);
    expect(stats.matchedCities).toBeGreaterThan(3000);
    expect(stats.matchedScheduled / stats.scheduled).toBeGreaterThan(0.5);
    expect(JSON.stringify(dataset) + '\n').toBe(
      readFileSync(new URL('../../src/data/generated/city-names.json', import.meta.url), 'utf8'),
    );
  });
});
