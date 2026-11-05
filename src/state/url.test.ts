import { describe, it, expect } from 'vitest';
import raw from '../data/generated/airports.json';
import { decodeDataset } from '../data/airports.ts';
import { buildSearchIndex, findAirportByCode } from '../data/search.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';
import { buildShareUrl, parseRouteParam, parseRouteToken, resolveRouteCodes, serializeRoute } from './url.ts';
import type { RouteStopSpec } from './url.ts';
const index = buildSearchIndex(decodeDataset(raw).airports);
const route = ['CPH', 'LHR', 'JFK'].map((c) => findAirportByCode(index, c)!);
const specs = (layovers: (number | null)[] = []): RouteStopSpec[] =>
  route.map((airport, i) => ({ airport, layoverMin: layovers[i] ?? null }));
describe('route URLs', () => {
  it('round trips route codes and builds URLs with an optional route', () => {
    expect(serializeRoute(specs())).toBe('CPH-LHR-JFK');
    const url = buildShareUrl('https://example.com/globehops/', specs());
    expect(url).toBe('https://example.com/globehops/?route=CPH-LHR-JFK');
    const codes = parseRouteParam(new URL(url).search)!;
    expect(resolveRouteCodes(codes, index)).toEqual({ stops: specs(), missing: [] });
    expect(buildShareUrl('https://example.com/globehops/', [])).toBe('https://example.com/globehops/');
  });
  it('round trips custom layovers at transfers only', () => {
    expect(serializeRoute(specs([45, 180, 30]))).toBe('CPH-LHR_180-JFK');
    expect(serializeRoute(specs([null, DEFAULT_LAYOVER_MIN]))).toBe('CPH-LHR-JFK');
    const url = buildShareUrl('https://example.com/globehops/', specs([null, 180]));
    expect(url).toBe('https://example.com/globehops/?route=CPH-LHR_180-JFK');
    expect(resolveRouteCodes(parseRouteParam(new URL(url).search)!, index)).toEqual({
      stops: specs([null, 180]),
      missing: [],
    });
  });
  it('parses tokens tolerantly, ignoring invalid layovers', () => {
    expect(parseRouteToken('lhr_240')).toEqual({ code: 'LHR', layoverMin: 240 });
    expect(parseRouteToken('LHR')).toEqual({ code: 'LHR', layoverMin: null });
    expect(parseRouteToken(`LHR_${DEFAULT_LAYOVER_MIN}`)).toEqual({ code: 'LHR', layoverMin: null });
    expect(parseRouteToken('LHR_99999')).toEqual({ code: 'LHR', layoverMin: null });
    expect(parseRouteParam('?route=CPH-LHR_120-LHR_-JFK_x')).toEqual(['CPH', 'LHR_120']);
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
    expect(resolveRouteCodes(['CPH', 'OBSOLETE', 'ZZZZ_60'], index)).toEqual({
      stops: [{ airport: route[0], layoverMin: null }],
      missing: ['OBSOLETE', 'ZZZZ'],
    });
    const local = { ...route[0], iata: null, icao: null, ident: 'DK-1234' };
    expect(serializeRoute([{ airport: local, layoverMin: null }])).toBe(String(local.id));
    expect(
      resolveRouteCodes(parseRouteParam('?route=' + serializeRoute([{ airport: local, layoverMin: null }]))!, index)
        .stops,
    ).toEqual([{ airport: route[0], layoverMin: null }]);
  });
});
