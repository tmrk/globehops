import { describe, expect, it } from 'vitest';
import rawAirports from './generated/airports.json';
import { decodeDataset } from './airports.ts';
import { buildSearchIndex } from './search.ts';
import { similarRoutes } from './similarRoutes.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';

const { airports } = decodeDataset(rawAirports);
const index = buildSearchIndex(airports);
const route = (...codes: string[]) => codes.map((code) => index.iata.get(code)!);
const ids = (list: { id: number }[]) => list.map((airport) => airport.id);
const codes = (options: ReturnType<typeof similarRoutes>) =>
  options.map((o) => o.airports.map((a) => a.iata).join('-'));

describe('similarRoutes', () => {
  it('offers different hubs between the same airports, never the route itself', () => {
    const bud = route('BUD', 'SYD');
    const options = similarRoutes(bud, index, [ids(bud)]);
    expect(codes(options)).toEqual(['BUD-DXB-SYD', 'BUD-SIN-SYD', 'BUD-HKG-SYD']);
    for (const option of options) {
      expect(option.airports[0]).toBe(bud[0]);
      expect(option.airports.at(-1)).toBe(bud[1]);
      expect(option.minutes).toBeGreaterThan(0);
    }
  });

  it('starts with nonstop for a connecting route and keeps away from its existing stop', () => {
    const viaDoha = route('BUD', 'DOH', 'SYD');
    const options = similarRoutes(viaDoha, index, [ids(viaDoha)]);
    expect(codes(options)[0]).toBe('BUD-SYD');
    // Dubai is a few hundred kilometres from Doha: on the globe it would be the same arc.
    expect(codes(options)).not.toContain('BUD-DXB-SYD');
    const doha = viaDoha[1];
    for (const option of options.slice(1)) {
      expect(greatCircleDistanceKm(option.airports[1], doha)).toBeGreaterThan(1000);
    }
  });

  it('skips routes other journeys already show and stays deterministic', () => {
    const bud = route('BUD', 'SYD');
    const viaDubai = route('BUD', 'DXB', 'SYD');
    const options = similarRoutes(bud, index, [ids(bud), ids(viaDubai)]);
    expect(codes(options)).not.toContain('BUD-DXB-SYD');
    expect(options).toHaveLength(3);
    expect(codes(similarRoutes(bud, index, [ids(bud), ids(viaDubai)]))).toEqual(codes(options));
  });

  it('keeps each leg meaningful and the detour modest', () => {
    for (const [from, to] of [
      ['BUD', 'JFK'],
      ['JFK', 'LAX'],
      ['LHR', 'SYD'],
      ['ARN', 'GRU'],
    ]) {
      const direct = greatCircleDistanceKm(index.iata.get(from)!, index.iata.get(to)!);
      for (const option of similarRoutes(route(from, to), index)) {
        const [a, hub, b] = option.airports;
        expect(greatCircleDistanceKm(a, hub)).toBeGreaterThanOrEqual(direct * 0.1);
        expect(greatCircleDistanceKm(hub, b)).toBeGreaterThanOrEqual(direct * 0.1);
        expect(option.distanceKm / direct).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('has nothing to offer for short hops, a single airport or a count of zero', () => {
    expect(similarRoutes(route('BUD', 'VIE'), index)).toEqual([]);
    expect(similarRoutes(route('BUD'), index)).toEqual([]);
    expect(similarRoutes([], index)).toEqual([]);
    expect(similarRoutes(route('BUD', 'SYD'), index, [], 0)).toEqual([]);
  });
});
