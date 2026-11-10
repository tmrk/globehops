import { describe, expect, it } from 'vitest';
import { detectFormat, importRoute, looksLikeRoute } from './index.ts';
import { context } from './testContext.ts';

const line = (coordinates: unknown[], properties: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } });
const endpoints = [
  [-0.45, 51.47, 12],
  [-73.78, 40.64, 25],
];
const pointsOf = async (text: string, format?: 'gpx' | 'csv' | 'geojson') =>
  (await importRoute(text, context, { format })).flights[0]?.track.points;

describe('format detection and public results', () => {
  it.each([
    ['{"type":"LineString","coordinates":[]}', 'wrong.txt', 'geojson'],
    ['<?xml version="1.0"?><!--x--><g:gpx xmlns:g="x"/>', 'wrong.json', 'gpx'],
    ['<kml/>', 'file.xml', 'kml'],
    ['<flight-plan/>', null, 'fpl'],
    ['<SimBase.Document/>', null, 'pln'],
    ['<LittleNavmap/>', null, 'pln'],
    ['lat;lon\n51;0\n40;-73', null, 'csv'],
    ['EGLL-KJFK', 'route.txt', 'route'],
    ['N0485F370 DCT 5320N01500W 54N030W DCT KJFK', null, 'route'],
    ['AFLY\nHFDTE101126\nB123456', null, 'igc'],
    ['bad data', 'x.gpx', 'gpx'],
    ['', 'x.kmz', 'kmz'],
    ['nonsense', 'x.lnmpln', 'pln'],
  ])('detects %s (%s)', (text, fileName, format) => expect(detectFormat(text, fileName)).toBe(format));
  it('does not claim arbitrary JSON or prose', () => {
    expect(detectFormat('{"hello":true}', 'x.json')).toBeNull();
    expect(looksLikeRoute('hello world')).toBe(false);
    expect(looksLikeRoute('LHR JFK')).toBe(true);
    expect(looksLikeRoute('lat,lon\n1,2\n3,4')).toBe(true);
    expect(looksLikeRoute('<gpx><trk/></gpx>')).toBe(true);
  });
  it.each([
    ['', 'empty'],
    ['  \uFEFF  ', 'empty'],
    ['some unrelated prose with punctuation!', 'unrecognised'],
    ['<gpx><trk><trkseg>', 'invalid'],
    ['<gpx/>', 'no_path'],
    ['{"type":"LineString","coordinates":[]}', 'no_path'],
  ])('returns a stable error for %s', async (text, code) => {
    const r = await importRoute(text, context);
    expect(r).toMatchObject({
      ok: false,
      flights: [],
      error: { code, message: expect.any(String), params: expect.any(Object) },
    });
  });
  it('allows forced formats and rejects shared-link/document formats explicitly', async () => {
    expect((await importRoute('junk', context, { format: 'csv' })).error?.code).toBe('invalid');
    expect((await importRoute('anything', context, { format: 'document' })).error?.code).toBe('unsupported');
  });
  it('decodes BOM UTF-8 bytes and separates display/source names', async () => {
    const r = await importRoute(new TextEncoder().encode('\uFEFF' + line(endpoints)), context, {
      fileName: 'My.flight.geojson',
    });
    expect(r).toMatchObject({ ok: true, name: 'My.flight', stats: { points: 2, droppedPoints: 0 } });
    expect(r.flights[0].track.source).toEqual({ format: 'geojson', name: 'My.flight.geojson' });
  });
  it('reports missing airport data without throwing', async () => {
    expect((await importRoute(line(endpoints), { airports: [], byCode: () => undefined })).error?.code).toBe('no_path');
  });
  it('enforces byte and point limits including invalid points', async () => {
    expect((await importRoute(' '.repeat(20 * 1024 * 1024 + 1), context)).error?.code).toBe('too_large');
    expect((await importRoute('é'.repeat(11 * 1024 * 1024), context)).error?.code).toBe('too_large');
    expect((await importRoute(line(Array.from({ length: 250_001 }, () => [999, 999])), context)).error?.code).toBe(
      'too_large',
    );
  });
  it('keeps at most 54 flights and reports the original count', async () => {
    const r = await importRoute(
      JSON.stringify({
        type: 'FeatureCollection',
        features: Array.from({ length: 56 }, () => JSON.parse(line(endpoints))),
      }),
      context,
    );
    expect(r.flights).toHaveLength(54);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'truncated_flights', params: { kept: 54, total: 56 } }),
    );
  });
});

describe('GeoJSON', () => {
  it('keeps exact positions, altitude and input order, with track names', async () => {
    const coords = [
      [-0.451234567, 51.471234567, -5],
      [-10, 65, 11300.125],
      [-73.78, 40.64, 12],
    ];
    const r = await importRoute(line(coords, { name: 'AAL100 KJFK-EGLL', title: 'ignored' }), context);
    expect(r.flights[0].track.points.map((p) => [p.lng, p.lat, p.altM])).toEqual(coords);
    expect(r.name).toBe('AAL100 KJFK-EGLL');
    expect(r.flights[0].track.kind).toBe('planned');
  });
  it.each(['coordTimes', 'times', 'coordinateProperties'])('reads %s times', async (key) => {
    const times = ['2026-11-10T10:00:00', '2026-11-10T15:00:00Z'];
    const props = { [key]: key === 'coordinateProperties' ? { times } : times };
    const r = await importRoute(line(endpoints, props), context);
    expect(r.flights[0].track.kind).toBe('recorded');
    expect(r.flights[0].track.points.map((p) => p.time)).toEqual(
      times.map((t) => Date.parse(t.endsWith('Z') ? t : t + 'Z')),
    );
    expect(r.warnings.some((w) => w.code === 'split_flights')).toBe(false); // long-distance coverage gap
  });
  it('recognises credible fourth ordinates as seconds or milliseconds, not measures', async () => {
    const ps = await pointsOf(
      line([
        [-0.45, 51.47, 5, 1_700_000_000],
        [-10, 50, 5, 1_700_000_010_000],
        [-73.78, 40.64, 5, 10],
      ]),
    );
    expect(ps?.map((p) => p.time)).toEqual([1_700_000_000_000, 1_700_000_010_000, null]);
  });
  it('concatenates only joining MultiLineString lines without deleting coincident fixes', async () => {
    const r = await importRoute(
      JSON.stringify({
        type: 'Feature',
        properties: {
          times: [
            [1700000000, 1700000010],
            [1700000010, 1700000020],
            [1700000030, 1700000040],
          ],
        },
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-0.45, 51.47],
              [-10, 50],
            ],
            [
              [-10, 50],
              [-73.78, 40.64],
            ],
            [
              [-122.38, 37.62],
              [-157.92, 21.32],
            ],
          ],
        },
      }),
      context,
    );
    expect(r.flights).toHaveLength(2);
    expect(r.flights[0].track.points).toHaveLength(4);
    expect(r.flights[0].track.points[1]).toEqual(r.flights[0].track.points[2]);
    expect(r.flights[1].track.kind).toBe('recorded');
  });
  it('uses ordered Point features only when there are no lines', async () => {
    const features = endpoints.map((c, i) => ({
      type: 'Feature',
      properties: { name: i ? 'JFK' : 'LHR' },
      geometry: { type: 'Point', coordinates: c },
    }));
    const r = await importRoute(JSON.stringify({ type: 'FeatureCollection', features }), context);
    expect(r.flights[0].track.points.map((p) => p.name)).toEqual(['LHR', 'JFK']);
    const both = await importRoute(
      JSON.stringify({ type: 'FeatureCollection', features: [...features, JSON.parse(line(endpoints))] }),
      context,
    );
    expect(both.flights).toHaveLength(1);
    expect(both.flights[0].track.points).toHaveLength(2);
  });
  it('counts invalid positions and clears unusable altitudes', async () => {
    const r = await importRoute(line([endpoints[0], [181, 0], [0, 91], [null, 20], [-73.78, 40.64, 'bad']]), context);
    expect(r.stats).toEqual({ points: 2, droppedPoints: 3 });
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['dropped_points', 'altitude_dropped']));
    expect(r.flights[0].track.points[1].altM).toBeNull();
  });
  it('handles deeply nested geometry iteratively', async () => {
    const text = '{"type":"GeometryCollection","geometries":['.repeat(5000) + line(endpoints) + ']}'.repeat(5000);
    expect((await importRoute(text, context)).ok).toBe(true);
  });
});

describe('import regression cases', () => {
  it('honours forced formats over a specific extension', async () => {
    const r = await importRoute('51.47,-0.45\n40.64,-73.78', context, { format: 'csv', fileName: 'mislabelled.kmz' });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('csv');
  });
  it('uses flattened MultiLineString times across lines, with missing nested lines remaining untimed', async () => {
    const geometry = {
      type: 'MultiLineString',
      coordinates: [
        [
          [-0.45, 51.47],
          [-10, 50],
        ],
        [
          [-10, 50],
          [-73.78, 40.64],
        ],
      ],
    };
    const flat = await importRoute(
      JSON.stringify({
        type: 'Feature',
        properties: { times: [1700000000, 1700000010, 1700000020, 1700000030] },
        geometry,
      }),
      context,
    );
    expect(flat.flights[0].track.points.map((p) => p.time)).toEqual([
      1700000000000, 1700000010000, 1700000020000, 1700000030000,
    ]);
    const partial = await importRoute(
      JSON.stringify({ type: 'Feature', properties: { times: [[1700000000, 1700000010], null] }, geometry }),
      context,
    );
    expect(partial.flights[0].track.points.map((p) => p.time)).toEqual([1700000000000, 1700000010000, null, null]);
  });
  it('does not double-convert early epoch millisecond values', async () => {
    const ps = await pointsOf(
      'lat,lon,time\n51.47,-0.45,1971-01-01T00:00:00Z\n40.64,-73.78,1971-01-01T01:00:00Z',
      'csv',
    );
    expect(ps?.map((p) => p.time)).toEqual([Date.parse('1971-01-01T00:00:00Z'), Date.parse('1971-01-01T01:00:00Z')]);
  });
  it('drops invalid headerless positions with the same warning as a named column', async () => {
    const r = await importRoute('NaN,0\n51.47,-0.45\n40.64,-73.78', context, { format: 'csv' });
    expect(r.ok).toBe(true);
    expect(r.stats).toEqual({ points: 2, droppedPoints: 1 });
  });
  it('detects a long route string without the paste-sniff budget limiting actual imports', async () => {
    const text = 'EGLL ' + 'DCT '.repeat(5000) + 'KJFK';
    expect((await importRoute(text, context)).ok).toBe(true);
  });
});
