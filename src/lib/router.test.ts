import { describe, expect, it } from 'vitest';
import rawDiversion from '../data/generated/diversion-airports.json';
import rawAirspace from '../data/generated/airspace.json';
import rawAirports from '../data/generated/airports.json';
import { decodeDiversionAirports } from '../data/diversion.ts';
import { decodeAirspace, zoneContains } from '../data/airspace.ts';
import { createAirspaceRouter, peakFlightLevel, zoneApplies, type RouteEndpoint } from './airspace.ts';
import { createRouter } from './router.ts';
import {
  coverageAllowanceKm,
  DEFAULT_DIVERSION_PROFILE,
  DiversionIndex,
  diversionProfile,
  diversionRadiusKm,
  pathCovered,
} from './diversion.ts';
import { centralAngle, greatCircleDistanceKm, interpolateGreatCircle, isValidLatLng, toVec3 } from './geo.ts';
import { pathLengthKm } from './routePath.ts';
import type { LegRoute } from '../types.ts';
const diversion = decodeDiversionAirports(rawDiversion),
  airspace = decodeAirspace(rawAirspace);
const router = createRouter({ airspace, diversion });
const epochMs = Date.UTC(2026, 10, 15),
  options = { epochMs, diversion: DEFAULT_DIVERSION_PROFILE };
const at = (code: string): RouteEndpoint => {
  const a = rawAirports.airports.find((a) => a[2] === code)!;
  return { lat: Number(a[8]), lng: Number(a[9]), countryCode: String(a[6]) };
};
const route = (a: string, b: string, avoidAirspace = true) => router.route(at(a), at(b), { ...options, avoidAirspace });
function expectCovered(r: LegRoute, from: RouteEndpoint, to: RouteEndpoint) {
  expect(r.diversion?.status).not.toBe('gap');
  expect(r.diversion?.maxMin).toBeLessThanOrEqual(180);
  expect(r.diversion?.outsideKm).toBe(0);
  const pts = r.path ?? [from, to];
  expect(pathCovered(pts.map(toVec3), new DiversionIndex([...diversion.airports, from, to]), 2222.4)).toBe(true);
  for (let i = 1; i < pts.length; i++) {
    expect(isValidLatLng(pts[i])).toBe(true);
    if (r.path) expect(centralAngle(pts[i - 1], pts[i])).toBeLessThanOrEqual(Math.PI / 180 + 1e-8);
  }
}
describe('combined routing on real airport and airspace datasets', () => {
  it('preserves the great circle over the Atlantic, high latitudes and the antimeridian', () => {
    for (const [a, b] of [
      ['CPH', 'JFK'],
      ['LHR', 'LAX'],
      ['SFO', 'HND'],
    ])
      for (const avoid of [false, true]) {
        const r = route(a, b, avoid);
        expectCovered(r, at(a), at(b));
        expect(r.diversion?.status).toBe('covered');
        expect(r.path).toBeNull();
        expect(r.distanceKm).toBe(greatCircleDistanceKm(at(a), at(b)));
      }
    expect(Math.abs(at('SFO').lng - at('HND').lng)).toBeGreaterThan(180);
  });
  it('shows South Pacific gaps rather than huge covered detours, and supports longer profiles', () => {
    const r = route('SYD', 'SCL');
    expect(r.path).toBeNull();
    expect(r.diversion).toMatchObject({ status: 'gap', extraKm: 0 });
    expect(r.diversion!.maxMin).toBeGreaterThan(180);
    expect(r.diversion!.outsideKm).toBeGreaterThan(0);
    const longer = router.route(at('SYD'), at('SCL'), { epochMs, diversion: diversionProfile(330) });
    expect(longer.diversion?.status).toBe('covered');
    expect(longer.diversion!.maxMin).toBeLessThanOrEqual(330);
    expect(longer.path).toBeNull();
  });
  it('finds modest, fully covered detours in the Indian Ocean and South Atlantic', () => {
    for (const [a, b] of [
      ['JNB', 'PER'],
      ['GRU', 'JNB'],
      ['AKL', 'SCL'],
    ]) {
      const r = route(a, b);
      expect(r.diversion?.status).toBe('adjusted');
      expect(r.path).not.toBeNull();
      expect(r.diversion!.extraKm).toBeGreaterThan(0);
      expect(r.diversion!.extraKm).toBeLessThanOrEqual(coverageAllowanceKm(r.greatCircleKm));
      expect(r.distanceKm).toBeCloseTo(pathLengthKm(r.path!), 6);
      expectCovered(r, at(a), at(b));
    }
    const r = route('JNB', 'PER', false);
    expect(r).toMatchObject({ status: 'clear', avoided: [], crossed: [], avoidedPlaces: [], crossedPlaces: [] });
  });
  it('keeps combined detours outside applicable zones and removes their airports from coverage', () => {
    for (const [a, b] of [
      ['HEL', 'NRT'],
      ['FRA', 'ICN'],
    ]) {
      const from = at(a),
        to = at(b),
        r = route(a, b);
      expect(r.status).toBe('detour');
      expect(r.avoided).toContain('ru');
      const zones = airspace.zones.filter((z) =>
        zoneApplies(z, {
          day: '2026-11-15',
          operator: 'easa',
          peakFl: peakFlightLevel(r.greatCircleKm),
          countries: [from.countryCode, to.countryCode],
        }),
      );
      const allowed = diversion.airports.filter((a) => !zones.some((z) => zoneContains(z, a.lat, a.lng)));
      expect(allowed.length).toBeLessThan(diversion.airports.length);
      expect(pathCovered(r.path!.map(toVec3), new DiversionIndex([...allowed, from, to]), 2222.4)).toBe(true);
      for (let i = 1; i < r.path!.length; i++) {
        const start = r.path![i - 1],
          end = r.path![i],
          n = Math.ceil((centralAngle(start, end) * 180) / Math.PI / 0.05);
        for (let j = 0; j <= n; j++) {
          const p = interpolateGreatCircle(start, end, j / Math.max(1, n));
          expect(zones.some((z) => zoneContains(z, p.lat, p.lng))).toBe(false);
        }
      }
    }
    const russian = diversion.airports.find((a) =>
      zoneContains(
        airspace.zones.find((z) => z.id === 'ru')!,
        a.lat,
        a.lng,
      ),
    )!;
    const all = new DiversionIndex(diversion.airports);
    const allowed = new DiversionIndex(
      diversion.airports.filter(
        (a) =>
          !zoneContains(
            airspace.zones.find((z) => z.id === 'ru')!,
            a.lat,
            a.lng,
          ),
      ),
    );
    expect(all.nearestKm(russian)).toBeLessThan(0.001);
    expect(allowed.nearestKm(russian)).toBeGreaterThan(10);
    expect(route('HEL', 'NRT', false).diversion!.maxMin).toBeLessThan(route('HEL', 'NRT').diversion!.maxMin);
  });
  it('includes remote endpoints in modelled coverage, even absent from the dataset', () => {
    for (const [a, b] of [
      ['IPC', 'PPT'],
      ['CCK', 'PER'],
    ])
      expectCovered(route(a, b), at(a), at(b));
    const empty = createRouter({ diversion: { ...diversion, airports: [] } });
    const a = { lat: 0, lng: 170 },
      b = { lat: 0, lng: -170 };
    expect(empty.route(a, b, options).diversion?.status).toBe('covered');
    const impossible = empty.route({ lat: 0, lng: 0 }, { lat: 0, lng: 100 }, options);
    expect(impossible.diversion?.status).toBe('gap');
    expect(impossible.diversion!.maxMin).toBeGreaterThan(180);
    expect(impossible.path).toBeNull();
    expect(empty.route({ lat: 80, lng: 0 }, { lat: 80, lng: 180 }, options).diversion?.status).toBe('covered');
  });

  it('combines an airspace detour with loss of the only bridging airport, without patching routes', () => {
    const ring = new Float64Array([-2, -2, 2, -2, 2, 2, -2, 2]);
    const zones = {
      reviewed: '2026-11-09',
      index: 'test',
      zones: [
        {
          id: 'bridge',
          name: 'bridge',
          place: 'XX',
          reference: 'test',
          url: 'https://example.org',
          issued: '2020-01-01',
          validUntil: null,
          ceilingFl: null,
          operators: ['easa' as const],
          exemptCountries: [],
          approximate: false,
          rings: [ring],
          bbox: { minLat: -2, maxLat: 2, minLng: -2, maxLng: 2 },
        },
      ],
    };
    const bridging = {
      ...diversion,
      airports: [{ id: 1, code: 'TEST', lat: 0, lng: 0, runwayM: 2500, widthM: 45, surface: 'asphalt' as const }],
    };
    const model = createRouter({ airspace: zones, diversion: bridging });
    const from = { lat: 0, lng: -30 },
      to = { lat: 0, lng: 30 };
    expect(model.route(from, to, { ...options, avoidAirspace: false }).diversion?.status).toBe('covered');
    expect(model.route(from, to, { ...options, operator: 'other' }).diversion?.status).toBe('covered');
    const r = model.route(from, to, options);
    expect(r).toMatchObject({ status: 'detour', avoided: ['bridge'], diversion: { status: 'gap' } });
    expect(r.diversion!.outsideKm).toBeGreaterThan(0);
    for (const p of r.path!) expect(zoneContains(zones.zones[0], p.lat, p.lng)).toBe(false);
    // Endpoint zones are deliberately exempt from airport exclusion and routing obstacles.
    const endpointZone = {
      ...zones,
      zones: [
        {
          ...zones.zones[0],
          rings: [new Float64Array([-31, -2, 2, -2, 2, 2, -31, 2])],
          bbox: { minLat: -2, maxLat: 2, minLng: -31, maxLng: 2 },
        },
      ],
    };
    const exempt = createRouter({ airspace: endpointZone, diversion: bridging }).route(from, to, options);
    expect(exempt).toMatchObject({ status: 'partial', crossed: ['bridge'], diversion: { status: 'covered' } });
  });

  it('routes a combined obstacle path over a pole without leaving coverage', () => {
    const zone = {
      id: 'cap',
      name: 'cap',
      place: 'XX',
      reference: 'test',
      url: 'https://example.org',
      issued: '2020-01-01',
      validUntil: null,
      ceilingFl: null,
      operators: ['easa' as const],
      exemptCountries: [],
      approximate: false,
      rings: [new Float64Array([-70, 76, -50, 76, -50, 84, -70, 84])],
      bbox: { minLat: 76, maxLat: 84, minLng: -70, maxLng: -50 },
    };
    const poleData = {
      ...diversion,
      airports: [{ id: 1, code: 'POLE', lat: 90, lng: 0, runwayM: 2500, widthM: 45, surface: 'asphalt' as const }],
    };
    const from = { lat: 70, lng: -60 },
      to = { lat: 70, lng: 120 };
    const r = createRouter({
      airspace: { reviewed: '2026-11-09', index: 'test', zones: [zone] },
      diversion: poleData,
    }).route(from, to, options);
    expect(r.status).toBe('detour');
    expect(r.diversion?.status).not.toBe('gap');
    expect(Math.max(...r.path!.map((p) => p.lat))).toBeGreaterThan(88);
    expect(pathCovered(r.path!.map(toVec3), new DiversionIndex([...poleData.airports, from, to]), 2222.4)).toBe(true);
    for (const p of r.path!) expect(zoneContains(zone, p.lat, p.lng)).toBe(false);
    const dateline = route('AKL', 'SCL');
    expect(dateline.path!.some((p, i, path) => i > 0 && Math.abs(p.lng - path[i - 1].lng) > 180)).toBe(true);
  });

  it('is deterministic and caches all routing choices, countries, dates and profile fields', () => {
    const a = at('JNB'),
      b = at('PER'),
      r = router.route(a, b, options);
    expect(router.route(a, b, { ...options, epochMs: epochMs + 1000 })).toBe(r);
    expect(createRouter({ airspace, diversion }).route(a, b, options)).toEqual(r);
    for (const patch of [
      { avoidAirspace: false },
      { operator: 'other' as const },
      { epochMs: epochMs + 86400000 },
      { diversion: { ...DEFAULT_DIVERSION_PROFILE, id: 'custom' } },
      { diversion: { ...DEFAULT_DIVERSION_PROFILE, version: 2 } },
      { diversion: diversionProfile(181) },
      { diversion: diversionProfile(180, 401) },
    ])
      expect(router.route(a, b, { ...options, ...patch })).not.toBe(r);
    expect(router.route({ ...a, countryCode: 'XX' }, b, options)).not.toBe(r);
  });
  it('is exactly backwards-compatible with diversion disabled and entirely clear with both off', () => {
    const old = createAirspaceRouter(airspace);
    for (const [a, b] of [
      ['HEL', 'NRT'],
      ['FRA', 'ICN'],
      ['CPH', 'JFK'],
      ['SYD', 'SCL'],
      ['JNB', 'PER'],
      ['SFO', 'HND'],
    ]) {
      const from = at(a),
        to = at(b),
        legacy = old.route(from, to, { epochMs });
      for (const disabled of [undefined, null]) {
        const r = router.route(from, to, { epochMs, diversion: disabled });
        expect(r).toEqual(legacy);
        expect(r).not.toHaveProperty('diversion');
      }
      const r = router.route(from, to, { epochMs, avoidAirspace: false });
      expect(r).toEqual({
        status: 'clear',
        path: null,
        greatCircleKm: greatCircleDistanceKm(from, to),
        distanceKm: greatCircleDistanceKm(from, to),
        avoided: [],
        crossed: [],
        avoidedPlaces: [],
        crossedPlaces: [],
      });
    }
  });
  it('omits diversion on internal failure and preserves the safe great-circle fallback', () => {
    const broken = { ...DEFAULT_DIVERSION_PROFILE, oeiSpeedKt: NaN };
    expect(router.route(at('HEL'), at('NRT'), { epochMs, diversion: broken })).toMatchObject({
      status: 'unavoided',
      path: null,
    });
    expect(router.route(at('HEL'), at('NRT'), { epochMs, diversion: broken })).not.toHaveProperty('diversion');
    expect(router.route(at('HEL'), at('NRT'), { epochMs, diversion: broken, avoidAirspace: false }).status).toBe(
      'clear',
    );
    expect(createRouter({}).route(at('CPH'), at('JFK'), options)).not.toHaveProperty('diversion');
    for (const epochMs of [NaN, Infinity, 9e15]) {
      const r = router.route(at('HEL'), at('NRT'), { ...options, epochMs });
      expect(r).toMatchObject({ status: 'unavoided', path: null });
      expect(r).not.toHaveProperty('diversion');
    }
  });
  it('routes a representative cold leg within a generous CI budget', () => {
    const start = performance.now();
    const r = createRouter({ airspace, diversion }).route(at('JNB'), at('PER'), options);
    expect(r.diversion!.status).toBe('adjusted');
    expect(performance.now() - start).toBeLessThan(2000);
    expect(diversionRadiusKm(DEFAULT_DIVERSION_PROFILE)).toBeGreaterThan(2200);
  });
});
