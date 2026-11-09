import { describe, expect, it } from 'vitest';
import raw from './generated/airspace.json';
import { decodeAirspace, zoneContains } from './airspace.ts';

describe('airspace dataset', () => {
  it('decodes the generated advisories with their validity, operators and outlines', () => {
    const dataset = decodeAirspace(raw);
    expect(dataset.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ukraine = dataset.zones.find((zone) => zone.id === 'ua')!;
    expect(ukraine).toMatchObject({ place: 'UA', ceilingFl: null, operators: ['easa', 'tco'] });
    expect(zoneContains(ukraine, 50.45, 30.52)).toBe(true); // Kyiv
    expect(zoneContains(ukraine, 44.95, 34.1)).toBe(true); // Simferopol, Crimea
    expect(zoneContains(ukraine, 52.23, 21.01)).toBe(false); // Warsaw
    const west = dataset.zones.find((zone) => zone.id === 'ru-west')!;
    expect(zoneContains(west, 55.75, 37.62)).toBe(true); // Moscow
    expect(zoneContains(west, 55.03, 82.92)).toBe(false); // Novosibirsk, east of 60°E
    expect(zoneContains(west, 54.71, 20.51)).toBe(false); // Kaliningrad
  });

  it('rejects malformed data', () => {
    const copy = () => structuredClone(raw) as { zones: Record<string, unknown>[]; format: number };
    expect(() => decodeAirspace({ ...copy(), format: 2 })).toThrow(/format 1/);
    const badDate = copy();
    badDate.zones[0].issued = '1 Jan 2026';
    expect(() => decodeAirspace(badDate)).toThrow(/zone 0/);
    const badRing = copy();
    badRing.zones[0].rings = [[1, 2, 3]];
    expect(() => decodeAirspace(badRing)).toThrow(/ring 0/);
    const duplicate = copy();
    duplicate.zones[1].id = duplicate.zones[0].id;
    expect(() => decodeAirspace(duplicate)).toThrow(/Duplicate/);
  });
});
