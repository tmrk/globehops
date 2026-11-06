import { describe, expect, it } from 'vitest';
import rawAirports from './generated/airports.json';
import rawTimeZones from './generated/timezones.json';
import { decodeDataset } from './airports.ts';
import { buildSearchIndex } from './search.ts';
import { decodeTimeZones } from './timezones.ts';
import { FALLBACK_HOME, homeAirport, welcomeSuggestions } from './suggestions.ts';
import { estimateFlightMinutes } from '../lib/flightTime.ts';

const { airports } = decodeDataset(rawAirports);
const index = buildSearchIndex(airports);
const zones = decodeTimeZones(rawTimeZones);
const homes = [
  ['Europe/Budapest', 'BUD'],
  ['Europe/Stockholm', 'ARN'],
  ['Europe/London', 'LHR'],
  ['Europe/Copenhagen', 'CPH'],
  ['America/Los_Angeles', 'LAX'],
  ['America/New_York', 'JFK'],
  ['Asia/Calcutta', 'DEL'],
  ['Australia/Sydney', 'SYD'],
  ['Asia/Tokyo', 'HND'],
] as const;

// Independent country grouping checks the diversity of returned destinations.
const regionCountries = [
  ['US', 'CA', 'MX'],
  ['BR', 'AR', 'CL', 'CO', 'PE'],
  ['GB', 'FR', 'TR', 'DE', 'NL', 'ES'],
  ['AE', 'QA'],
  ['ZA', 'KE', 'ET', 'EG'],
  ['HK', 'SG', 'JP', 'KR', 'TH', 'IN', 'CN', 'MY', 'TW', 'PH', 'ID'],
  ['AU', 'NZ'],
];

describe('homeAirport', () => {
  it.each(homes)('%s resolves to %s using the generated airport and zone tables', (zone, code) => {
    expect(homeAirport(zone, { index, zones })?.iata).toBe(code);
  });

  it.each([null, undefined, '', 'nonsense', 'Nonsense/Paris', 'Etc/UTC', 'toString'])('has no home for %s', (zone) => {
    expect(homeAirport(zone, { index, zones })).toBeNull();
  });

  it.each([
    ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
    ['Asia/Katmandu', 'Asia/Kathmandu'],
    ['Europe/Kiev', 'Europe/Kyiv'],
    ['Asia/Rangoon', 'Asia/Yangon'],
    ['America/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
    ['Atlantic/Faeroe', 'Atlantic/Faroe'],
    ['America/Godthab', 'America/Nuuk'],
    ['Asia/Dacca', 'Asia/Dhaka'],
    ['Asia/Ulan_Bator', 'Asia/Ulaanbaatar'],
    ['Pacific/Truk', 'Pacific/Chuuk'],
  ])('normalizes legacy %s to %s independently of the runtime tzdb', (alias, canonical) => {
    expect(homeAirport(alias, { index, zones })).toEqual(homeAirport(canonical, { index, zones }));
  });

  it('works without the zone table using city ranking and gateway overrides', () => {
    for (const [zone, code] of homes) expect(homeAirport(zone, { index, zones: null })?.iata).toBe(code);
    expect(homeAirport('Nonsense/Nowhere', { index, zones: null })).toBeNull();
    expect(index.iata.get(FALLBACK_HOME)?.iata).toBe('LHR');
  });

  it('rejects a city match in the wrong zone and falls back to a primary gateway in the mapped zone', () => {
    const paris = index.iata.get('CDG')!;
    const heathrow = index.iata.get('LHR')!;
    const gatwick = index.iata.get('LGW')!;
    const smallIndex = buildSearchIndex([paris, gatwick, heathrow]);
    const mapped = {
      ...zones,
      byAirportId: new Map([
        [heathrow.id, 'Test/Paris'],
        [gatwick.id, 'Test/Paris'],
      ]),
    };
    expect(homeAirport('Test/Paris', { index: smallIndex, zones: mapped })).toBe(heathrow);
    expect(homeAirport('Europe/Paris', { index: smallIndex, zones: mapped })).toBeNull();
  });

  it('breaks zone-only ties deterministically by IATA regardless of dataset order', () => {
    const lax = index.iata.get('LAX')!;
    const sfo = index.iata.get('SFO')!;
    const mapped = {
      ...zones,
      byAirportId: new Map([
        [lax.id, 'Test/Nowhere'],
        [sfo.id, 'Test/Nowhere'],
      ]),
    };
    for (const order of [
      [sfo, lax],
      [lax, sfo],
    ]) {
      expect(homeAirport('Test/Nowhere', { index: buildSearchIndex(order), zones: mapped })).toBe(lax);
    }
  });
});

describe('welcomeSuggestions', () => {
  it.each(homes)('%s (%s) gets three international long-haul hubs in distinct regions', (_zone, code) => {
    const origin = index.iata.get(code)!;
    const suggestions = welcomeSuggestions(origin, index);
    expect(suggestions).toHaveLength(3);
    expect(welcomeSuggestions(origin, index)).toEqual(suggestions);
    expect(new Set(suggestions.map(({ to }) => to.id)).size).toBe(3);
    const regions = new Set<number>();
    for (const { from, to, distanceKm, minutes } of suggestions) {
      expect(from).toBe(origin);
      expect(to.id).not.toBe(origin.id);
      expect(to.countryCode).not.toBe(origin.countryCode);
      expect(to.type).toBe('large');
      expect(to.scheduled).toBe(true);
      expect(to.iata).toBeTruthy();
      expect(distanceKm).toBeLessThanOrEqual(16_500);
      expect(minutes).toBeGreaterThanOrEqual(720);
      expect(minutes).toBe(estimateFlightMinutes(distanceKm));
      const region = regionCountries.findIndex((countries) => countries.includes(to.countryCode));
      expect(region).toBeGreaterThanOrEqual(0);
      regions.add(region);
    }
    expect(regions.size).toBe(3);
  });

  it('fills from the same region when diversity is unavailable, preserving iconic priority', () => {
    const origin = index.iata.get('SYD')!;
    const sparse = buildSearchIndex(['LAX', 'SFO', 'YVR'].map((code) => index.iata.get(code)!));
    expect(welcomeSuggestions(origin, sparse).map(({ to }) => to.iata)).toEqual(['LAX', 'SFO', 'YVR']);
  });

  it('relaxes only the duration for a sparse dataset, keeping longest routes first and no duplicates', () => {
    const origin = index.iata.get('LHR')!;
    const sparse = buildSearchIndex(['LHR', 'CDG', 'FRA', 'MAD'].map((code) => index.iata.get(code)!));
    expect(welcomeSuggestions(origin, sparse).map(({ to }) => to.iata)).toEqual(['MAD', 'FRA', 'CDG']);
  });

  it('honours counts, excludes same-country hubs and never relaxes the near-antipodal cap', () => {
    const origin = index.iata.get('LHR')!;
    expect(welcomeSuggestions(origin, index, 0)).toEqual([]);
    expect(welcomeSuggestions(origin, index, 1)).toHaveLength(1);
    expect(welcomeSuggestions(origin, index, 5)).toHaveLength(5);
    const sparse = buildSearchIndex(['LHR', 'SYD', 'MEL'].map((code) => index.iata.get(code)!));
    expect(welcomeSuggestions(origin, sparse)).toEqual([]);
  });
});
