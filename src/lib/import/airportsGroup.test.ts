import { describe, expect, it } from 'vitest';
import { matchAirport } from './airports.ts';
import { airport, context, JFK, LHR, SFO } from './testContext.ts';
import { groupFlights, importRoute, type ImportedFlight } from './index.ts';
import type { Airport } from '../../types.ts';
const flight = (from: Airport, to: Airport): ImportedFlight => ({
  from,
  to,
  fromDistanceKm: 0,
  toDistanceKm: 0,
  track: {
    kind: 'planned',
    points: [from, to].map((a) => ({ lat: a.lat, lng: a.lng, altM: null, time: null })),
    source: { format: 'route', name: null },
  },
});
describe('endpoint matching', () => {
  it('scores type and scheduled service within the cap and honours nearby explicit names', () => {
    const small = { ...airport('SMAL', 'SML', 0.01, 0, 11), type: 'small' as const, scheduled: false };
    const large = airport('LARG', 'LRG', 0.03, 0, 12);
    const ctx = { airports: [small, large], byCode: () => undefined };
    expect(matchAirport({ lat: 0, lng: 0 }, ctx)?.airport.id).toBe(12);
    expect(matchAirport({ lat: 0, lng: 0 }, ctx, small)?.airport.id).toBe(11);
    const sameDistance = { ...large, id: 13, scheduled: false };
    expect(matchAirport({ lat: 0, lng: 0 }, { ...ctx, airports: [sameDistance, large] })?.airport.id).toBe(12);
  });
  it('wraps longitude and searches all relevant longitudes at poles', () => {
    const dateline = airport('DATE', 'DAT', 0, -179.99, 11);
    const polar = airport('POLE', 'POL', 89.99, 140, 12);
    const ctx = { airports: [dateline, polar], byCode: () => undefined };
    expect(matchAirport({ lat: 0, lng: 179.99 }, ctx)?.km).toBeLessThan(3);
    expect(matchAirport({ lat: 90, lng: -20 }, ctx)?.km).toBeLessThan(2);
  });
  it('ignores a distant name hint and falls back to exact nearest when outside the cap', () => {
    expect(matchAirport(JFK, context, LHR)?.airport.id).toBe(JFK.id);
    expect(matchAirport({ lat: 0, lng: -70 }, context)?.airport.id).toBe(JFK.id);
  });
  it('uses nearby endpoint names, including a name/description airport pair within 50 km', async () => {
    const nearby = { ...LHR, id: 90, ident: 'XLLL', icao: 'XLLL', iata: 'XXX', lng: -0.44 };
    const ctx = { ...context, airports: [...context.airports, nearby] };
    const text = JSON.stringify({
      type: 'Feature',
      properties: { description: 'AAL100 LHR → JFK' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.44, 51.47],
          [-73.78, 40.64],
        ],
      },
    });
    const r = await importRoute(text, ctx);
    expect(r.flights[0].from.id).toBe(LHR.id);
    expect(r.flights[0].track.points[0].lng).toBe(-0.44);
  });
  it('warns about distant endpoints and same-airport circuits', async () => {
    const far = await importRoute('lat,lon\n0,0\n1,1', context);
    expect(far.warnings.filter((w) => w.code === 'far_endpoint')).toHaveLength(2);
    expect(far.warnings.find((w) => w.code === 'far_endpoint')?.params).toMatchObject({
      end: 'start',
      flight: 1,
      code: expect.any(String),
      km: expect.any(Number),
    });
    const circuit = await importRoute('lat,lon\n51.47,-0.45\n51.48,-0.45\n51.47,-0.45', context);
    expect(circuit.warnings).toContainEqual(
      expect.objectContaining({ code: 'same_airport', params: { flight: 1, code: 'LHR' } }),
    );
  });
});
describe('pure airport-continuity grouping', () => {
  it('groups connections and separates open jaws', () => {
    const flights = [flight(LHR, JFK), flight(JFK, SFO), flight(LHR, SFO)];
    expect(groupFlights(flights)).toEqual({ journeys: [[flights[0], flights[1]], [flights[2]]], dropped: 0 });
    expect(groupFlights([])).toEqual({ journeys: [], dropped: 0 });
  });
  it('drops overflow without inventing a new journey', () => {
    const connections = Array.from({ length: 11 }, () => flight(LHR, LHR));
    const groups = groupFlights([...connections, flight(JFK, SFO)]);
    expect(groups.journeys.map((j) => j.length)).toEqual([9, 1]);
    expect(groups.dropped).toBe(2);
    const openJaws = groupFlights(Array.from({ length: 8 }, () => flight(LHR, JFK)));
    expect(openJaws.journeys).toHaveLength(6);
    expect(openJaws.dropped).toBe(2);
  });
});
