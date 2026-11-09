import { describe, expect, it } from 'vitest';
import raw from '../data/generated/airspace.json';
import { decodeAirspace, zoneContains, type AirspaceDataset } from '../data/airspace.ts';
import type { LatLng, LegRoute } from '../types.ts';
import { createAirspaceRouter, dayOf, peakFlightLevel, type RouteEndpoint } from './airspace.ts';
import { centralAngle, greatCircleDistanceKm, initialBearing, interpolateGreatCircle } from './geo.ts';
import { pathLengthKm } from './routePath.ts';

const real = decodeAirspace(raw);
const router = createAirspaceRouter(real);
const NOV_2026 = Date.UTC(2026, 10, 9, 12);
const at = (lat: number, lng: number, countryCode: string): RouteEndpoint => ({ lat, lng, countryCode });
const HEL = at(60.317, 24.963, 'FI');
const NRT = at(35.765, 140.386, 'JP');
const LHR = at(51.47, -0.454, 'GB');
const JFK = at(40.64, -73.78, 'US');
const ICN = at(37.46, 126.44, 'KR');
const FRA = at(50.033, 8.57, 'DE');
const DXB = at(25.253, 55.364, 'AE');
const DOH = at(25.27, 51.6, 'QA');
const VNO = at(54.63, 25.29, 'LT');
const IST = at(41.26, 28.74, 'TR');
const IKA = at(35.42, 51.15, 'IR');
const BEY = at(33.82, 35.49, 'LB');
const PEK = at(40.08, 116.58, 'CN');

/** Every point within 0.05° along the route that lies inside one of the zones. */
function intrusions(route: LegRoute, zones: AirspaceDataset['zones'], ids: string[]): string[] {
  const found = new Set<string>();
  const path = route.path!;
  for (let i = 1; i < path.length; i++) {
    const steps = Math.max(1, Math.ceil((centralAngle(path[i - 1], path[i]) * 180) / Math.PI / 0.05));
    for (let s = 0; s <= steps; s++) {
      const p = interpolateGreatCircle(path[i - 1], path[i], s / steps);
      for (const zone of zones) if (ids.includes(zone.id) && zoneContains(zone, p.lat, p.lng)) found.add(zone.id);
    }
  }
  return [...found];
}
const maxTurnDeg = (path: LatLng[]) => {
  let max = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const turn = Math.abs(
      ((initialBearing(path[i], path[i + 1]) - initialBearing(path[i - 1], path[i]) + 540) % 360) - 180,
    );
    max = Math.max(max, turn);
  }
  return max;
};

function expectDetour(route: LegRoute, from: LatLng, to: LatLng) {
  expect(route.status).toBe('detour');
  const path = route.path!;
  expect(path[0]).toEqual({ lat: from.lat, lng: from.lng });
  expect(path.at(-1)).toEqual({ lat: to.lat, lng: to.lng });
  expect(route.distanceKm).toBeCloseTo(pathLengthKm(path), 6);
  expect(route.distanceKm).toBeGreaterThan(route.greatCircleKm);
  expect(route.distanceKm).toBeLessThan(route.greatCircleKm * 1.5);
  for (let i = 1; i < path.length; i++) expect(centralAngle(path[i - 1], path[i])).toBeLessThan((1.01 * Math.PI) / 180);
  expect(intrusions(route, real.zones, route.avoided)).toEqual([]);
}

describe('airspace routing on the bundled advisories', () => {
  it('keeps unaffected flights on their exact great circle', () => {
    const route = router.route(LHR, JFK, { epochMs: NOV_2026 });
    expect(route).toMatchObject({ status: 'clear', path: null, avoided: [], crossed: [] });
    expect(route.distanceKm).toBe(greatCircleDistanceKm(LHR, JFK));
  });

  it('detours around Russian airspace for an EU airline (Helsinki–Tokyo)', () => {
    const route = router.route(HEL, NRT, { epochMs: NOV_2026 });
    expectDetour(route, HEL, NRT);
    expect(route.avoided).toEqual(expect.arrayContaining(['ru', 'ru-west']));
    expect(route.avoidedPlaces).toEqual(['RU']);
  });

  it('goes around several zones at once with smooth turns (Frankfurt–Dubai, Vilnius–Istanbul)', () => {
    const dubai = router.route(FRA, DXB, { epochMs: NOV_2026 });
    expectDetour(dubai, FRA, DXB);
    expect(dubai.avoided).toEqual(expect.arrayContaining(['ir', 'iq']));
    const istanbul = router.route(VNO, IST, { epochMs: NOV_2026 });
    expectDetour(istanbul, VNO, IST);
    expect(istanbul.avoided).toEqual(expect.arrayContaining(['by', 'ua']));
    // Corners are rounded into bends rather than kinks.
    for (const route of [dubai, istanbul]) expect(maxTurnDeg(route.path!)).toBeLessThan(25);
  });

  it('finds the Caucasus corridor between Russia and Iran (Frankfurt–Beijing)', () => {
    const route = router.route(FRA, PEK, { epochMs: NOV_2026 });
    expectDetour(route, FRA, PEK);
    expect(route.path!.some((p) => p.lat > 39 && p.lat < 42.5 && p.lng > 44 && p.lng < 50)).toBe(true);
    expect(route.distanceKm).toBeLessThan(route.greatCircleKm * 1.25);
  });

  it('crosses the antimeridian when the way around lies across it (Seoul–New York)', () => {
    const route = router.route(ICN, JFK, { epochMs: NOV_2026 });
    expectDetour(route, ICN, JFK);
    expect(route.avoided).toContain('ru');
    const path = route.path!;
    expect(path.some((p, i) => i > 0 && Math.abs(p.lng - path[i - 1].lng) > 180)).toBe(true);
  });

  it('applies advisories only on the days they are valid', () => {
    // Iran, Iraq and Syria bulletins end in November 2026; nothing else lies between Frankfurt and Dubai.
    expect(router.route(FRA, DXB, { epochMs: Date.UTC(2030, 0, 1) }).status).toBe('clear');
    // Before 2021 neither Belarus nor Ukraine was restricted.
    expect(router.route(VNO, IST, { epochMs: Date.UTC(2019, 5, 1) }).status).toBe('clear');
    expect(dayOf(Date.UTC(2026, 10, 16, 23, 59))).toBe('2026-11-16');
  });

  it('applies advisories only to the operators they address', () => {
    const tco = router.route(HEL, NRT, { epochMs: NOV_2026, operator: 'tco' });
    expect(tco.avoided).toContain('ru-west');
    expect(tco.avoided).not.toContain('ru');
    expect(tco.distanceKm).toBeLessThan(router.route(HEL, NRT, { epochMs: NOV_2026 }).distanceKm);
    expect(router.route(HEL, NRT, { epochMs: NOV_2026, operator: 'other' }).status).toBe('clear');
  });

  it('exempts arrivals and departures the advisory allows (Doha and the Persian Gulf)', () => {
    const route = router.route(DOH, LHR, { epochMs: NOV_2026 });
    expect(route.avoided).not.toContain('gulf');
    expect(route.avoided).toEqual(expect.arrayContaining(['iq']));
  });

  it('reports flights that start or end inside a zone as not guaranteed, avoiding the rest', () => {
    const tehran = router.route(FRA, IKA, { epochMs: NOV_2026 });
    expect(tehran.status).toBe('partial');
    expect(tehran.crossed).toEqual(['ir']);
    if (tehran.path) expect(intrusions(tehran, real.zones, tehran.avoided)).toEqual([]);
    // Beirut sits on the coast, just outside the simplified outline of its own country.
    expect(router.route(LHR, BEY, { epochMs: NOV_2026 })).toMatchObject({ status: 'partial', crossed: ['lb'] });
  });

  it('caches results per day and operator', () => {
    const a = router.route(HEL, NRT, { epochMs: NOV_2026 });
    expect(router.route(HEL, NRT, { epochMs: NOV_2026 + 3600_000 })).toBe(a);
    expect(router.route(HEL, NRT, { epochMs: NOV_2026, operator: 'tco' })).not.toBe(a);
  });
});

/** A dataset in the generated format with square or custom rings (lng/lat degrees). */
function synthetic(zones: { id: string; rings: [number, number][][]; ceilingFl?: number | null }[]): AirspaceDataset {
  return decodeAirspace({
    format: 1,
    precision: 100,
    reviewed: '2026-11-09',
    index: 'https://example.org',
    zones: zones.map(({ id, rings, ceilingFl = null }) => ({
      id,
      name: id,
      place: 'XX',
      reference: 'TEST',
      url: 'https://example.org',
      issued: '2020-01-01',
      validUntil: null,
      ceilingFl,
      operators: ['easa'],
      exemptCountries: [],
      approximate: false,
      rings: rings.map((ring) => {
        let previous = [0, 0];
        return ring.flatMap(([lng, lat]) => {
          const point = [Math.round(lng * 100), Math.round(lat * 100)];
          const delta = [point[0] - previous[0], point[1] - previous[1]];
          previous = point;
          return delta;
        });
      }),
    })),
  });
}
const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe('airspace routing edge cases', () => {
  const epochMs = NOV_2026;

  it('keeps the great circle and says so when no way around exists', () => {
    // The origin sits in a hole of a ring-shaped zone.
    const ring = createAirspaceRouter(synthetic([{ id: 'ring', rings: [box(-5, -5, 5, 5), box(-2, -2, 2, 2)] }]));
    const route = ring.route(at(0, 0, 'AA'), at(0, 20, 'BB'), { epochMs });
    expect(route).toMatchObject({ status: 'unavoided', path: null, crossed: ['ring'] });
    expect(route.distanceKm).toBe(route.greatCircleKm);
  });

  it('rejects detours far longer than the flight', () => {
    // A wall from pole to pole: going around would mean crossing the polar caps.
    const wall = createAirspaceRouter(synthetic([{ id: 'wall', rings: [box(9.5, -89, 10.5, 89)] }]));
    expect(wall.route(at(0, 9, 'AA'), at(0, 11, 'BB'), { epochMs })).toMatchObject({ status: 'unavoided', path: null });
  });

  it('applies altitude-limited advisories only to flights too short to climb above them', () => {
    const low = createAirspaceRouter(synthetic([{ id: 'low', rings: [box(9.8, -0.5, 10.2, 0.5)], ceilingFl: 260 }]));
    expect(peakFlightLevel(180)).toBeLessThan(260);
    expect(peakFlightLevel(300)).toBeGreaterThan(260);
    expect(peakFlightLevel(3000)).toBeGreaterThan(350);
    // About 180 km, peaking below FL260: avoided.
    expectDetourAround(low.route(at(0, 9.2, 'AA'), at(0, 10.8, 'BB'), { epochMs }), 'low', low.dataset);
    // A long flight over the same box cruises above it.
    expect(low.route(at(0, -20, 'AA'), at(0, 40, 'BB'), { epochMs }).status).toBe('clear');
  });

  it('wraps across the antimeridian and over a pole', () => {
    const dateline = createAirspaceRouter(
      synthetic([{ id: 'dateline', rings: [box(178, -10, 180, 10), box(-180, -10, -178, 10)] }]),
    );
    const route = dateline.route(at(0, 170, 'AA'), at(0, -170, 'BB'), { epochMs });
    expectDetourAround(route, 'dateline', dateline.dataset);
    // The direct route runs over the North Pole; the way round a zone on it still does.
    const pole = createAirspaceRouter(synthetic([{ id: 'cap', rings: [box(-70, 76, -50, 84)] }]));
    const polar = pole.route(at(70, -60, 'AA'), at(70, 120, 'BB'), { epochMs });
    expectDetourAround(polar, 'cap', pole.dataset);
    expect(Math.max(...polar.path!.map((p) => p.lat))).toBeGreaterThan(88);
  });

  function expectDetourAround(route: LegRoute, id: string, dataset: AirspaceDataset) {
    expect(route.status).toBe('detour');
    expect(route.avoided).toEqual([id]);
    expect(intrusions(route, dataset.zones, [id])).toEqual([]);
  }
});
