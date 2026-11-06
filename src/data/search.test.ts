import { describe, it, expect } from 'vitest';
import raw from './generated/airports.json';
import { decodeDataset } from './airports.ts';
import { buildSearchIndex, findAirportByCode, searchAirports } from './search.ts';
const { airports } = decodeDataset(raw);
const index = buildSearchIndex(airports);
const codes = (query: string, limit?: number) => searchAirports(index, query, limit).map((a) => a.iata);
describe('real airport search', () => {
  it('prioritizes exact codes and common city/name searches', () => {
    for (const [q, first] of [
      ['cph', 'CPH'],
      ['lhr', 'LHR'],
      ['jfk', 'JFK'],
      ['egll', 'LHR'],
      ['ekch', 'CPH'],
      ['copenhagen', 'CPH'],
      ['kastrup', 'CPH'],
      ['heathrow', 'LHR'],
      ['malmo', 'MMX'],
      ['malmö', 'MMX'],
      ['kobenhavn', 'CPH'],
      ['sydney', 'SYD'],
      ['stockholm', 'ARN'],
    ])
      expect(codes(q)[0], q).toBe(first);
    const london = codes('london');
    expect(london[0]).toBe('LHR');
    for (const c of ['LHR', 'LGW', 'STN', 'LTN', 'LCY']) expect(london).toContain(c);
    const ontario = london.indexOf('YXU');
    if (ontario >= 0)
      for (const c of ['LHR', 'LGW', 'STN', 'LTN', 'LCY']) expect(london.indexOf(c)).toBeLessThan(ontario);
    for (const c of ['JFK', 'LGA']) expect(codes('new york').slice(0, 3)).toContain(c);
    for (const c of ['JFK', 'LGA', 'EWR']) expect(codes('nyc')).toContain(c);
    expect(new Set(codes('tokyo').slice(0, 2))).toEqual(new Set(['HND', 'NRT']));
    for (const c of ['CDG', 'ORY']) expect(codes('paris').slice(0, 3)).toContain(c);
  });
  it.each([
    ['tok', 'HND'],
    ['dub', 'DUB'],
    ['par', 'CDG'],
  ])('ranks the primary scheduled airport first for %s', (query, code) => {
    expect(codes(query)[0]).toBe(code);
  });
  it('ranks Newark above every matching New York heliport and seaplane base', () => {
    const results = searchAirports(index, 'new york', airports.length);
    const newark = results.findIndex((a) => a.iata === 'EWR');
    const minor = results.filter((a) => a.type === 'heliport' || a.type === 'seaplane');
    expect(newark).toBeGreaterThanOrEqual(0);
    expect(minor.length).toBeGreaterThan(0);
    for (const airport of minor) expect(newark).toBeLessThan(results.indexOf(airport));
  });
  it('requires every token to prefix-match and supports partial input', () => {
    expect(codes('new yo').slice(0, 3)).toContain('JFK');
    expect(codes('heath lon')[0]).toBe('LHR');
    expect(codes('copenhagen impossible')).toEqual([]);
    expect(codes('  ! ')).toEqual([]);
    expect(searchAirports(index, 'london', 2)).toHaveLength(2);
    expect(searchAirports(index, 'london', 0)).toEqual([]);
  });
  it('resolves codes, identifiers and numeric ids case-insensitively', () => {
    const cph = findAirportByCode(index, ' cph ')!;
    expect(findAirportByCode(index, 'EKCH')).toBe(cph);
    expect(findAirportByCode(index, String(cph.id))).toBe(cph);
    const local = airports.find((a) => a.ident.includes('-'))!;
    expect(findAirportByCode(index, local.ident.toLowerCase())).toBe(local);
    expect(findAirportByCode(index, 'OBSOLETE')).toBeNull();
    const bare = { ...cph, id: -1, iata: null, icao: null, ident: 'TEST' };
    expect(findAirportByCode(buildSearchIndex([bare]), 'test')).toBe(bare);
  });
  it('handles 100 representative queries in under 50ms after indexing', () => {
    const queries = ['london', 'new yo', 'cph', 'malmo', 'tokyo', 'paris', 'sydney', 'heathrow', 'nyc', 'stockholm'];
    for (const q of queries) searchAirports(index, q);
    const start = performance.now();
    for (let i = 0; i < 100; i++) searchAirports(index, queries[i % queries.length]);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('optional extra city names', () => {
  it('indexes exonyms with city weight while retaining existing codes and English names', () => {
    const localized = buildSearchIndex(airports, {
      extraNames: (airport) => (airport.iata === 'VIE' ? ['Bécs'] : airport.iata === 'CPH' ? ['Köpenhamn'] : []),
    });
    expect(searchAirports(localized, 'Bécs')[0].iata).toBe('VIE');
    expect(searchAirports(localized, 'bec')[0].iata).toBe('VIE');
    expect(searchAirports(localized, 'Köpenhamn')[0].iata).toBe('CPH');
    for (const query of ['cph', 'egll', 'vienna', 'copenhagen', 'london', 'tokyo'])
      expect(searchAirports(localized, query).map((a) => a.id)).toEqual(searchAirports(index, query).map((a) => a.id));
  });
  it('gives an exact extra-name match the same score as an exact original-city match', () => {
    const source = airports.find((a) => a.iata === 'CPH')!;
    const first = {
      ...source,
      id: 1,
      iata: null,
      icao: null,
      ident: 'ONE',
      city: 'Other',
      name: 'A Airport',
      keywords: [],
    };
    const second = { ...first, id: 2, ident: 'TWO', city: 'Köpenhamn', name: 'B Airport' };
    const localized = buildSearchIndex([second, first], { extraNames: (a) => (a.id === 1 ? ['Köpenhamn'] : []) });
    expect(searchAirports(localized, 'Köpenhamn').map((a) => a.id)).toEqual([1, 2]);
  });
});
