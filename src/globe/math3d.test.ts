import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { toVec3 } from '../lib/geo.ts';
import { ecefToScene, latLngToVector3, sceneToEcef, slerpUnit } from './math3d.ts';

const expectVector = (actual: Vector3, expected: Vector3) => {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-12);
};

describe('scene coordinate convention', () => {
  it.each([
    [0, 0, [1, 0, 0]],
    [0, 90, [0, 0, -1]],
    [0, -90, [0, 0, 1]],
    [90, 0, [0, 1, 0]],
  ] as const)('maps (%s, %s) to the expected axis', (lat, lng, xyz) => {
    expectVector(latLngToVector3(lat, lng), new Vector3(...xyz));
  });

  it.each([
    { lat: 0, lng: 0 },
    { lat: 55.618, lng: 12.656 },
    { lat: -33.946, lng: 151.177 },
    { lat: 90, lng: 180 },
    { lat: -90, lng: -180 },
    { lat: 40.64, lng: -73.779 },
  ])('agrees with ECEF and inverts the conversion for $lat, $lng', (point) => {
    const ecef = toVec3(point);
    const scene = latLngToVector3(point.lat, point.lng);
    expectVector(ecefToScene(ecef), scene);
    const restored = sceneToEcef(scene);
    restored.forEach((value, i) => expect(value).toBeCloseTo(ecef[i], 12));
    // sceneToEcef deliberately normalises non-unit scene radii.
    const scaled = sceneToEcef(scene.clone().multiplyScalar(7));
    scaled.forEach((value, i) => expect(value).toBeCloseTo(ecef[i], 12));
    expectVector(ecefToScene(ecef, 7), scene.clone().multiplyScalar(7));
  });
});

describe('slerpUnit', () => {
  it('preserves endpoints and unit length without mutating inputs', () => {
    const a = latLngToVector3(55, 12);
    const b = latLngToVector3(-34, 151);
    const before = [a.clone(), b.clone()];
    expectVector(slerpUnit(a, b, 0), a);
    expectVector(slerpUnit(a, b, 1), b);
    for (const t of [0, 0.1, 0.25, 0.5, 0.9, 1]) expect(slerpUnit(a, b, t).length()).toBeCloseTo(1, 12);
    expectVector(a, before[0]);
    expectVector(b, before[1]);
  });

  it.each([new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(1, 2, 3).normalize()])(
    'handles antipodes without NaN, including the vertical-axis fallback (%s)',
    (a) => {
      const b = a.clone().negate();
      for (const t of [0, 0.1, 0.5, 0.9, 1]) {
        const result = slerpUnit(a, b, t);
        expect(result.toArray().every(Number.isFinite)).toBe(true);
        expect(result.length()).toBeCloseTo(1, 12);
      }
      expectVector(slerpUnit(a, b, 0), a);
      expectVector(slerpUnit(a, b, 1), b);
    },
  );

  it('handles identical endpoints and writes into a supplied target', () => {
    const a = latLngToVector3(10, 20);
    const target = new Vector3();
    expect(slerpUnit(a, a, 0.5, target)).toBe(target);
    expectVector(target, a);
  });
});
