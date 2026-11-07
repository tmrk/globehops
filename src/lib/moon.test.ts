import { describe, expect, it } from 'vitest';
import {
  EquatorFromVector,
  GeoMoon,
  KM_PER_AU,
  Libration,
  RotateVector,
  Rotation_EQJ_EQD,
  SiderealTime,
} from 'astronomy-engine';
import { centralAngle, normalizeLng, toVec3, type Vec3 } from './geo.ts';
import { moonAt } from './moon.ts';
import { subsolarPoint } from './sun.ts';

const DEG = 180 / Math.PI;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// Every 37 days across 1900–2100 (about 2,000 instants), which walks through every phase and node.
const start = Date.UTC(1900, 0, 1);
const end = Date.UTC(2100, 11, 31);
const instants = Array.from({ length: Math.floor((end - start) / (37 * 86_400_000)) }, (_, i) => {
  return start + i * 37 * 86_400_000 + ((i * 7_919_000) % 86_400_000);
});

describe('moonAt', () => {
  it('places the sublunar point within 0.04° and the distance within 50 km of astronomy-engine', () => {
    let maxAngle = 0;
    let maxDistance = 0;
    for (const epochMs of instants) {
      const date = new Date(epochMs);
      const vector = GeoMoon(date);
      const eq = EquatorFromVector(RotateVector(Rotation_EQJ_EQD(date), vector));
      const expected = { lat: eq.dec, lng: normalizeLng((eq.ra - SiderealTime(date)) * 15) };
      const moon = moonAt(epochMs);
      maxAngle = Math.max(maxAngle, centralAngle(moon.sublunar, expected) * DEG);
      maxDistance = Math.max(maxDistance, Math.abs(moon.distanceKm - vector.Length() * KM_PER_AU));
    }
    expect(maxAngle).toBeLessThan(0.04);
    expect(maxDistance).toBeLessThan(50);
  });

  it('turns the near side to Earth with the observed libration', () => {
    let maxError = 0;
    for (const epochMs of instants) {
      const { sublunar, pole, primeMeridian } = moonAt(epochMs);
      expect(dot(pole, primeMeridian)).toBeCloseTo(0, 12);
      const toEarth = toVec3(sublunar).map((v) => -v) as Vec3;
      // Selenographic coordinates of the sub-Earth point: east longitude, north latitude.
      const lat = Math.asin(dot(toEarth, pole)) * DEG;
      const lon = Math.atan2(dot(toEarth, cross(pole, primeMeridian)), dot(toEarth, primeMeridian)) * DEG;
      const expected = Libration(new Date(epochMs));
      maxError = Math.max(maxError, Math.abs(lat - expected.elat), Math.abs(normalizeLng(lon - expected.elon)));
    }
    expect(maxError).toBeLessThan(0.1);
  });

  it('puts the Moon in Earth’s shadow at the greatest total lunar eclipse of 2025-09-07, 18:11:48 UTC', () => {
    const epochMs = Date.UTC(2025, 8, 7, 18, 11, 48);
    const sun = subsolarPoint(epochMs);
    // Gamma −0.275: the Moon's centre passed 0.275 Earth radii (about 0.26°) from the shadow's axis.
    const offAxis = centralAngle(moonAt(epochMs).sublunar, { lat: -sun.lat, lng: normalizeLng(sun.lng + 180) });
    expect(offAxis * DEG).toBeGreaterThan(0.1);
    expect(offAxis * DEG).toBeLessThan(0.4);
  });
});
