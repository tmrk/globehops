import { describe, expect, it } from 'vitest';
import type { Airport } from '../types.ts';
import { computeTripComparison } from '../lib/compareTrips.ts';
import type { TripSectionInput } from '../lib/trip.ts';
import { tripCaptions, tripCodes, tripColumnNames } from './tripCompareText.ts';

const airport = (id: number, code: string, city: string): Airport => ({
  id,
  ident: code,
  iata: code,
  icao: null,
  name: code,
  city,
  lat: id * 5,
  lng: id * 10,
  country: '',
  countryCode: 'XX',
  region: '',
  type: 'large',
  scheduled: true,
  keywords: [],
});
const [BUD, FRA, JFK, AMS, BOS] = [
  airport(1, 'BUD', 'Budapest'),
  airport(2, 'FRA', 'Frankfurt'),
  airport(3, 'JFK', 'New York'),
  airport(4, 'AMS', 'Amsterdam'),
  airport(5, 'BOS', 'Boston'),
];
const section = (...airports: Airport[]): TripSectionInput => ({
  label: null,
  stayMin: null,
  input: {
    id: 'x',
    stops: airports.map((a) => ({ airport: a, zone: 'UTC', layoverMin: null, arrival: null, departure: null })),
  },
});
const i18n = {
  t: (key: string, ...args: (string | number)[]) => `${key}(${args.join('|')})`,
  fmt: { number: String },
} as unknown as Parameters<typeof tripCaptions>[1];
const compare = (...options: TripSectionInput[][]) =>
  computeTripComparison(
    options.map((sections, i) => ({ label: i === 3 ? 'Mine' : null, sections })),
    { assumedStart: null },
  );

describe('compared trip captions', () => {
  it('tells trips between the same places apart by their connections', () => {
    const list = compare(
      [section(BUD, FRA, JFK), section(JFK, AMS, BUD)],
      [section(BUD, JFK), section(JFK, BUD)],
      [section(), section()],
      [section(BUD, JFK), section(JFK, FRA, BUD)],
    );
    expect(tripCodes(list[0])).toBe('BUD → JFK → BUD');
    expect(tripCaptions(list, i18n)).toEqual([
      'trips.via(FRA, AMS)',
      'trips.nonstop()',
      'compare.chooseAirports()',
      'Mine',
    ]);
    expect(tripColumnNames(list, i18n)).toEqual(['trip.outbound()', 'trip.return()']);
  });

  it('names a lone trip by its connections, and trips to different places by their routes', () => {
    expect(tripCaptions(compare([section(BUD, FRA, JFK), section(JFK, BUD)], [section(), section()]), i18n)).toEqual([
      'trips.via(FRA)',
      'compare.chooseAirports()',
    ]);
    const list = compare([section(BUD, JFK), section(JFK, BUD)], [section(BUD, BOS), section(BOS, BUD)]);
    expect(tripCaptions(list, i18n)).toEqual(['BUD → JFK → BUD', 'BUD → BOS → BUD']);
  });
});
