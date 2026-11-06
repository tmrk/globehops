import { describe, expect, it } from 'vitest';
import { Matrix3, PerspectiveCamera, SphereGeometry, Vector3 } from 'three';
import { toVec3 } from '../lib/geo.ts';
import {
  ecefToScene,
  latLngToVector3,
  sceneToEcef,
  slerpUnit,
  sunDirectionScene,
  projectToScreen,
  surfaceFacing,
} from './math3d.ts';

const expectVector = (actual: Vector3, expected: Vector3) => {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-12);
};

describe('scene coordinate convention', () => {
  it.each([
    { lat: 0, lng: -91.8 },
    { lat: 23.44, lng: 179.9 },
    { lat: -23.44, lng: -179.9 },
    { lat: 90, lng: 42 },
    { lat: -90, lng: -42 },
  ])('aligns sunlight with a subsolar marker at $lat, $lng', (subsolar) => {
    const target = new Vector3();
    const sun = sunDirectionScene(subsolar, target);
    expect(sun).toBe(target);
    expect(sun.dot(latLngToVector3(subsolar.lat, subsolar.lng))).toBeCloseTo(1, 12);
    expect(sun.dot(latLngToVector3(-subsolar.lat, subsolar.lng + 180))).toBeCloseTo(-1, 12);
  });

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

describe('surface, texture and shader coordinate spaces', () => {
  it('aligns SphereGeometry equirectangular UVs (−180° at the left edge) with geographic markers', () => {
    const geometry = new SphereGeometry(1, 128, 64);
    const positions = geometry.getAttribute('position');
    const uvs = geometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      const lat = uvs.getY(i) * 180 - 90;
      if (Math.abs(lat) === 90) continue; // Three shifts U at poles to avoid texture pinching.
      const lng = uvs.getX(i) * 360 - 180;
      const vertex = new Vector3().fromBufferAttribute(positions, i);
      expect(vertex.distanceTo(latLngToVector3(lat, lng))).toBeLessThan(1e-7);
    }
    geometry.dispose();
  });

  it('preserves solar elevation in view space after camera moves with unchanged sunlight', () => {
    const camera = new PerspectiveCamera(30, 1.6, 0.1, 100);
    const sun = sunDirectionScene({ lat: -23.44, lng: -45.4 });
    const normals = [
      [0, 0],
      [55.618, 12.656],
      [40.641, -73.778],
      [-90, 0],
      [0, 180],
    ];
    const uniform = new Vector3();
    for (const [lat, lng, distance] of [
      [30, 0, 5],
      [-45, 150, 3],
      [80, -100, 2],
      [0, 179, 7],
    ]) {
      camera.position.copy(latLngToVector3(lat, lng, distance));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      // Same per-frame transform as renderFrame; includes camera rotations AND translations.
      uniform.copy(sun).transformDirection(camera.matrixWorldInverse);
      const normalMatrix = new Matrix3().getNormalMatrix(camera.matrixWorldInverse);
      for (const [latitude, longitude] of normals) {
        const normal = latLngToVector3(latitude, longitude);
        const mu = normal.dot(sun);
        normal.applyMatrix3(normalMatrix).normalize();
        expect(normal.dot(uniform)).toBeCloseTo(mu, 12);
      }
    }
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

  it('supports targets that alias either endpoint', () => {
    for (const b of [latLngToVector3(-34, 151), latLngToVector3(55, 12).negate()]) {
      const a = latLngToVector3(55, 12);
      const expected = slerpUnit(a, b, 0.4);
      const aliasedA = a.clone();
      expectVector(slerpUnit(aliasedA, b, 0.4, aliasedA), expected);
      const aliasedB = b.clone();
      expectVector(slerpUnit(a, aliasedB, 0.4, aliasedB), expected);
    }
  });

  it('handles identical endpoints and writes into a supplied target', () => {
    const a = latLngToVector3(10, 20);
    const target = new Vector3();
    expect(slerpUnit(a, a, 0.5, target)).toBe(target);
    expectVector(target, a);
  });
});

describe('screen-space geometry', () => {
  it('writes pixel coordinates into the supplied buffer and rejects points past the far plane', () => {
    const camera = new PerspectiveCamera(30, 1.6, 0.1, 100);
    camera.position.set(5, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const target = new Vector3();
    expect(projectToScreen(new Vector3(1, 0, 0), camera, 1440, 900, target)).toBe(true);
    expect(target.x).toBeCloseTo(720, 10);
    expect(target.y).toBeCloseTo(450, 10);
    expect(projectToScreen(new Vector3(-200, 0, 0), camera, 1440, 900, target)).toBe(false);
  });

  it('agrees with normalized sightlines for surface and lifted points', () => {
    const camera = new Vector3(4, 2, 1);
    for (const point of [latLngToVector3(40, 25), latLngToVector3(-20, 170, 1.1), new Vector3(0, 1, 0)]) {
      const expected = point.clone().normalize().dot(camera.clone().sub(point).normalize());
      expect(surfaceFacing(point, camera)).toBeCloseTo(expected, 14);
    }
    expect(surfaceFacing(new Vector3(), camera)).toBe(0);
    expect(surfaceFacing(camera, camera)).toBe(0);
  });
});
