import { describe, expect, it } from 'vitest';
import { greatCircleDistanceKm, interpolateGreatCircle } from './geo.ts';
import { mergeFractions, pathLengthKm, pathSignature, pathVertexFractions, pointAlongPath } from './routePath.ts';

const a = { lat: 0, lng: 0 };
const b = { lat: 0, lng: 10 };
const c = { lat: 10, lng: 10 };

describe('route paths', () => {
  it('measures and walks a polyline of great-circle arcs by distance', () => {
    const path = [a, b, c];
    expect(pathLengthKm(path)).toBeCloseTo(greatCircleDistanceKm(a, b) + greatCircleDistanceKm(b, c), 6);
    expect(pathVertexFractions(path)).toEqual([0, expect.closeTo(0.5, 6), 1]);
    expect(pointAlongPath(path, 0)).toEqual(expect.objectContaining({ lat: expect.closeTo(0, 9) }));
    const middle = pointAlongPath(path, 0.5);
    expect(middle.lat).toBeCloseTo(0, 6);
    expect(middle.lng).toBeCloseTo(10, 6);
    const quarter = pointAlongPath(path, 0.25);
    const expected = interpolateGreatCircle(a, b, 0.5);
    expect(quarter.lat).toBeCloseTo(expected.lat, 6);
    expect(quarter.lng).toBeCloseTo(expected.lng, 6);
    expect(pointAlongPath(path, 2).lat).toBeCloseTo(10, 6);
  });

  it('merges sample fractions and signs shapes', () => {
    expect(mergeFractions([0, 0.25, 1], [0, 0.5, 1])).toEqual([0, 0.25, 0.5, 1]);
    expect(pathSignature([a, b, c])).toBe(pathSignature([{ ...a }, { ...b }, { ...c }]));
    expect(pathSignature([a, b, c])).not.toBe(pathSignature([a, { lat: 1, lng: 10 }, c]));
  });
});
