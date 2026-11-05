import { describe, it, expect } from 'vitest';
import raw from '../data/generated/airports.json';
import { decodeDataset } from '../data/airports.ts';
import { buildSearchIndex, findAirportByCode } from '../data/search.ts';
import { buildShareUrl, parseRouteParam, resolveRouteCodes, serializeRoute } from './url.ts';
const index = buildSearchIndex(decodeDataset(raw).airports);
const route = ['CPH', 'LHR', 'JFK'].map((c) => findAirportByCode(index, c)!);
describe('route URLs', () => {
  it('round trips route codes and builds URLs with an optional route', () => {
    expect(serializeRoute(route)).toBe('CPH-LHR-JFK');
    const url = buildShareUrl('https://example.com/globehops/', route);
    expect(url).toBe('https://example.com/globehops/?route=CPH-LHR-JFK');
    const codes = parseRouteParam(new URL(url).search)!;
    expect(resolveRouteCodes(codes, index)).toEqual({ airports: route, missing: [] });
    expect(buildShareUrl('https://example.com/globehops/', [])).toBe('https://example.com/globehops/');
  });
  it('parses tolerant separators, casing, whitespace and limits', () => {
    expect(parseRouteParam('?ROUTE= cph,lhr>jfk~lax.syd sin-DXB ')).toEqual([
      'CPH',
      'LHR',
      'JFK',
      'LAX',
      'SYD',
      'SIN',
      'DXB',
    ]);
    expect(parseRouteParam('?route=CPH-!-X-TOOLONGCODE-LHR')).toEqual(['CPH', 'LHR']);
    expect(parseRouteParam('?route=')).toEqual([]);
    expect(parseRouteParam('?other=x')).toBeNull();
    expect(parseRouteParam('?route=' + Array(12).fill('CPH').join('-'))).toHaveLength(10);
  });
  it('reports missing codes and falls back to ids for unsafe identifiers', () => {
    expect(resolveRouteCodes(['CPH', 'OBSOLETE', 'ZZZZ'], index)).toEqual({
      airports: [route[0]],
      missing: ['OBSOLETE', 'ZZZZ'],
    });
    const local = { ...route[0], iata: null, icao: null, ident: 'DK-1234' };
    expect(serializeRoute([local])).toBe(String(local.id));
    expect(resolveRouteCodes(parseRouteParam('?route=' + serializeRoute([local]))!, index).airports).toEqual([
      route[0],
    ]);
  });
});
