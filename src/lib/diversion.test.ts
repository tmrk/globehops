import { describe, expect, it } from 'vitest';
import raw from '../data/generated/diversion-airports.json';
import { decodeDiversionAirports } from '../data/diversion.ts';
import { centralAngle, EARTH_RADIUS_KM, greatCircleDistanceKm, toVec3 } from './geo.ts';
import {
  coverageMetrics,
  createCoverageModel,
  DEFAULT_DIVERSION_PROFILE,
  DiversionIndex,
  diversionProfile,
  diversionRadiusKm,
  pathCovered,
  rasteriseCoverage,
} from './diversion.ts';
const data = decodeDiversionAirports(raw);
const at = (lat: number, lng: number) => ({ lat, lng });
describe('diversion coverage geometry', () => {
  it('defines and validates the illustrative profile', () => {
    expect(diversionRadiusKm(DEFAULT_DIVERSION_PROFILE)).toBeCloseTo(2222.4, 9);
    expect(diversionProfile(330)).toMatchObject({ id: 'twin-330', oeiSpeedKt: 400 });
    for (const n of [NaN, Infinity, 59, 371]) expect(() => diversionProfile(n)).toThrow();
    for (const speed of [NaN, 0, -1, Infinity]) expect(() => diversionProfile(180, speed)).toThrow();
    expect(() => diversionRadiusKm({ ...DEFAULT_DIVERSION_PROFILE, version: 0 })).toThrow();
  });
  it('agrees with brute-force spherical distance across the date line and poles', () => {
    const points = data.airports;
    const index = new DiversionIndex(points);
    for (const lat of [-90, -80, -35, 0, 30, 70, 90])
      for (const lng of [-180, -120, -20, 70, 179.9]) {
        const p = at(lat, lng);
        expect(index.nearestKm(p)).toBeCloseTo(Math.min(...points.map((a) => greatCircleDistanceKm(p, a))), 6);
      }
    expect(new DiversionIndex([]).nearestKm(at(0, 0))).toBe(Infinity);
    expect(new DiversionIndex([at(0, 0)]).nearestKm(at(0, 180))).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 8);
    expect(new DiversionIndex([at(0, 0)]).nearestKm(at(0, 0))).toBe(0);
  });
  it('rasterises only conservative cells, including wrapped and polar spherical caps', () => {
    const airports = [at(0, 179), at(89, 100), at(-90, -180)];
    const radius = 800,
      grid = rasteriseCoverage(airports, radius);
    const index = new DiversionIndex(airports);
    for (let r = 0; r < 360; r++)
      for (let c = 0; c < 720; c++) {
        if (!grid[r * 720 + c]) continue;
        expect(index.nearestKm(at(-90 + (r + 0.5) * 0.5, -180 + (c + 0.5) * 0.5))).toBeLessThanOrEqual(
          radius - 40 + 1e-7,
        );
      }
    expect(grid[180 * 720]).toBe(1);
    expect(grid[359 * 720]).toBe(1);
    expect(rasteriseCoverage([], radius).some(Boolean)).toBe(false);
  });
  it('certifies whole arcs using the half-spacing bound, not just covered vertices', () => {
    const endpoints = [at(0, -20), at(0, 20)],
      index = new DiversionIndex(endpoints);
    expect(pathCovered(endpoints.map(toVec3), index, 2000)).toBe(false);
    expect(pathCovered(endpoints.map(toVec3), index, 2300)).toBe(true);
    // Exactly on the radius cannot be certified just because the vertex is covered.
    expect(
      pathCovered(
        [at(0, 0), at(0, 0.1)].map(toVec3),
        new DiversionIndex([at(0, 0)]),
        EARTH_RADIUS_KM * centralAngle(at(0, 0), at(0, 0.1)),
      ),
    ).toBe(false);
    const metrics = coverageMetrics(endpoints, index, DEFAULT_DIVERSION_PROFILE);
    expect(metrics.maxMin).toBeGreaterThan(180);
    expect(metrics.outsideKm).toBeGreaterThan(0);
    expect(metrics.beyondThresholdKm).toBeGreaterThan(metrics.outsideKm);
  });
  it('reuses grids by radius and stable exclusion set, isolates endpoint caps and bounds the LRU', () => {
    const model = createCoverageModel(data),
      none = new Set<number>();
    const a = model.grid(2222.4, none, []);
    const b = model.grid(2222.4, none, [at(-65, -120)]);
    expect(model.gridBuilds).toBe(1);
    expect(a).not.toBe(b);
    expect(b.reduce((s, x) => s + x, 0)).toBeGreaterThan(a.reduce((s, x) => s + x, 0));
    const excluded = new Set(data.airports.slice(0, 2).map((a) => a.id));
    model.grid(2222.4, excluded, []);
    model.grid(2222.4, new Set([...excluded].reverse()), []);
    expect(model.gridBuilds).toBe(2);
    for (const radius of [1000, 1500, 3000, 4000]) model.grid(radius, none, []);
    expect(model.cachedGrids).toBe(4);
    model.grid(2222.4, none, []);
    expect(model.gridBuilds).toBe(7);
  });
  it('builds the real coverage grid within a generous CI budget', () => {
    const start = performance.now();
    const grid = rasteriseCoverage(data.airports, 2222.4);
    expect(grid.length).toBe(259200);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
