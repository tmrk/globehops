import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EARTH_RADIUS_KM } from '../lib/geo.ts';
import { moonAt } from '../lib/moon.ts';
import { latLngToVector3 } from './math3d.ts';
import { moonVantage } from './skyBodies.ts';

const DEG = Math.PI / 180;
const LIMB = 1.055;

describe('moonVantage', () => {
  it.each([Date.UTC(2026, 10, 7, 10, 46), Date.UTC(2026, 10, 24), Date.UTC(2027, 5, 1, 18)])(
    'shows the Moon just above Earth’s limb, within reach (%i)',
    (epochMs) => {
      const { sublunar, distanceKm } = moonAt(epochMs);
      const moon = latLngToVector3(sublunar.lat, sublunar.lng, distanceKm / EARTH_RADIUS_KM);
      const reach = 12.75 * DEG;
      const { direction, distance } = moonVantage(moon, 3, reach, LIMB);
      const camera = direction.clone().multiplyScalar(distance);
      const sight = moon.clone().sub(camera);
      const axis = camera.clone().negate().normalize();
      const offAxis = sight.angleTo(axis);
      // Clear of the glowing limb by the margin, and inside the field of view it may use.
      expect(offAxis).toBeCloseTo(Math.asin(LIMB / distance) + 2.5 * DEG, 9);
      expect(offAxis).toBeLessThanOrEqual(reach + 1e-9);
      // Above the globe in a north-up view: towards the projection of +Y across the screen.
      const up = new Vector3(0, 1, 0).projectOnPlane(axis);
      expect(sight.projectOnPlane(axis).dot(up)).toBeGreaterThan(0);
    },
  );

  it('keeps a camera that is already far enough out', () => {
    const moon = latLngToVector3(5, 40, 60);
    expect(moonVantage(moon, 8, 12.75 * DEG, LIMB).distance).toBe(8);
    expect(moonVantage(moon, 2, 12.75 * DEG, LIMB).distance).toBeCloseTo(LIMB / Math.sin(10.25 * DEG), 9);
  });
});
