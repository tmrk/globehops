import { describe, expect, it } from 'vitest';
import { importRoute, looksLikeRoute } from './index.ts';
import { routeCoordinate } from './route.ts';
import { context, LHR, JFK } from './testContext.ts';
import type { Navaid, NavaidDataset } from '../../data/navaids.ts';
import raw from '../../data/generated/navaids.json';
import { decodeNavaids } from '../../data/navaids.ts';
const dataset = decodeNavaids(raw);
function aids(navaids: Navaid[]): NavaidDataset {
  const byIdent = new Map<string, Navaid[]>();
  for (const n of navaids) byIdent.set(n.ident, [...(byIdent.get(n.ident) ?? []), n]);
  return { meta: dataset.meta, navaids, byIdent };
}

describe('aviation coordinates', () => {
  it.each([
    ['5320N01500W', 53 + 20 / 60, -15],
    ['5330N02000W', 53.5, -20],
    ['54N030W', 54, -30],
    ['37N130W', 37, -130],
    ['35S140E', -35, 140],
    ['5040N', 50, -40],
    ['50N40', 50, -140],
    ['5020E', 50, 20],
    ['50E20', 50, 120],
    ['5020W', -50, -20],
    ['50W20', -50, -120],
    ['6030S', -60, 30],
    ['60S30', -60, 130],
    ['H5060', 50.5, -60],
    ['51.47,-0.45', 51.47, -0.45],
    ['40.64/-73.78', 40.64, -73.78],
    ['N51°28\'39"W000°27\'41"', 51 + 28 / 60 + 39 / 3600, -(27 / 60 + 41 / 3600)],
  ])('decodes %s', (token, lat, lng) => {
    expect(routeCoordinate(token)?.lat).toBeCloseTo(lat, 9);
    expect(routeCoordinate(token)?.lng).toBeCloseTo(lng, 9);
  });
});
describe('aviation routes', () => {
  it('resolves airports, radio aids, runway suffixes and direct approximations', async () => {
    const r = await importRoute('EGLL/27R CPT3F CPT UL9 KONAN UL607 SPI DCT KJFK/31L', {
      ...context,
      navaids: dataset,
    });
    expect(r.ok).toBe(true);
    expect(r.flights[0].from.id).toBe(LHR.id);
    expect(r.flights[0].to.id).toBe(JFK.id);
    expect(r.flights[0].track.kind).toBe('planned');
    expect(r.flights[0].track.points.map((p) => p.name)).toEqual(['EGLL', 'CPT', 'SPI', 'KJFK']);
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'procedure_direct', params: { names: 'CPT3F' } }),
        expect.objectContaining({ code: 'airway_direct', params: { airways: 'UL9, UL607', count: 2 } }),
        expect.objectContaining({ code: 'unresolved_waypoints', params: { names: 'KONAN', count: 1 } }),
      ]),
    );
  });
  it('reports navaid names unresolved when the optional dataset is absent', async () => {
    const r = await importRoute('LHR CPT NATA KONAN JFK', context);
    expect(r.flights[0].track.points).toHaveLength(2);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'unresolved_waypoints', params: { names: 'CPT, NATA, KONAN', count: 3 } }),
    );
  });
  it.each([
    'EGLL-KJFK',
    'LHR JFK',
    'egll kjfk',
    '51.47,-0.45 40.64,-73.78',
    'N51°28\'39" W000°27\'41" N40°38\'24" W073°46\'48"',
  ])('accepts %s', async (text) => {
    expect(looksLikeRoute(text)).toBe(true);
    const r = await importRoute(text, context);
    expect(r.ok).toBe(true);
    expect(r.flights[0].from.id).toBe(LHR.id);
    expect(r.flights[0].to.id).toBe(JFK.id);
  });
  it('parses field 15, joined lines, spaced degree coordinates and metric/feet level changes', async () => {
    const r = await importRoute(
      'N0485F370 DCT 5320N01500W\n5330N02000W N0450A045 54N 030W\nK0830S1130 55N040W M082M1200 56N050W DCT KJFK',
      context,
    );
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([
      37000 * 0.3048,
      37000 * 0.3048,
      4500 * 0.3048,
      11300,
      12000,
      null,
    ]);
  });
  it('changes levels on subsequent waypoints and keeps airports at null altitude', async () => {
    const r = await importRoute('EGLL N0450F350 CPT/N0450F370 50N030W KJFK', { ...context, navaids: dataset });
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([null, 35000 * 0.3048, 37000 * 0.3048, null]);
    expect(r.flights[0].track.points.map((p) => p.name)).toEqual(['EGLL', 'CPT', '50N030W', 'KJFK']);
  });
  it('keeps intermediate airports in one flight and separates independently complete lines', async () => {
    const single = await importRoute('EGLL KJFK KSFO PHNL', context);
    expect(single.flights).toHaveLength(1);
    expect(single.flights[0].track.points).toHaveLength(4);
    const multiple = await importRoute('EGLL KJFK\nKJFK KSFO\nKSFO PHNL', context);
    expect(multiple.flights).toHaveLength(3);
  });
  it('selects the minimal-detour navaid and warns only for a nearby competing interpretation', async () => {
    const nearby = aids([
      { ident: 'XX', type: 'VOR', lat: 50, lng: -10, country: 'GB' },
      { ident: 'XX', type: 'NDB', lat: 49.99, lng: -10, country: 'GB' },
      { ident: 'XX', type: 'DME', lat: -30, lng: 150, country: 'AU' },
    ]);
    const r = await importRoute('EGLL XX KJFK', { ...context, navaids: nearby });
    expect(r.flights[0].track.points).toHaveLength(3);
    expect(r.warnings.filter((w) => w.code === 'ambiguous_waypoint')).toHaveLength(1);
    const remote = await importRoute('EGLL XX KJFK', { ...context, navaids: aids(nearby.navaids.slice(2)) });
    expect(remote.flights[0].track.points).toHaveLength(2);
    expect(remote.warnings.some((w) => w.code === 'unresolved_waypoints')).toBe(true);
    const unique = await importRoute('EGLL XX KJFK', {
      ...context,
      navaids: aids([nearby.navaids[0], nearby.navaids[2]]),
    });
    expect(unique.warnings.some((w) => w.code === 'ambiguous_waypoint')).toBe(false);
  });
  it('limits unresolved names to twelve while reporting the full count', async () => {
    const r = await importRoute(
      `EGLL ${Array.from({ length: 20 }, (_, i) => `FIX${String.fromCharCode(65 + i)}X`).join(' ')} KJFK`,
      context,
    );
    const warning = r.warnings.find((w) => w.code === 'unresolved_waypoints');
    expect(warning?.params.count).toBe(20);
    expect(String(warning?.params.names).split(', ')).toHaveLength(13);
    expect(String(warning?.params.names).endsWith('…')).toBe(true);
  });
  it('requires two airport/coordinate endpoints and drops invalid coordinates', async () => {
    expect((await importRoute('EGLL CPT KONAN', context, { format: 'route' })).error?.code).toBe('no_path');
    const r = await importRoute('EGLL 999N030W 5360N01500W KJFK', context, { format: 'route' });
    expect(r.stats.droppedPoints).toBe(1); // malformed width is unresolved; invalid minutes is a dropped coordinate
    expect(r.flights[0].track.points).toHaveLength(2);
  });
});

it.each(['CPT EGLL KJFK', 'EGLL KJFK CPT', 'EGLL KJFK UNRESOLVED'])(
  'requires airport/coordinate ends instead of silently moving an endpoint: %s',
  async (text) => {
    const r = await importRoute(text, { ...context, navaids: dataset }, { format: 'route' });
    expect(r.error?.code).toBe('no_path');
  },
);

it('resolves exact small-airport idents before considering airway syntax', async () => {
  const small = { ...LHR, id: 42, ident: 'N24', icao: null, iata: null };
  const ctx = { airports: [small, JFK], byCode: (code: string) => (code === 'N24' ? small : context.byCode(code)) };
  const r = await importRoute('N24 KJFK', ctx);
  expect(r.ok).toBe(true);
  expect(r.flights[0].from.id).toBe(42);
  expect(r.warnings.some((w) => w.code === 'airway_direct')).toBe(false);
});
