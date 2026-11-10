import { describe, expect, it } from 'vitest';
import { importRoute } from './index.ts';
import { context } from './testContext.ts';
import { readDelimited } from './csv.ts';

describe('CSV and TSV', () => {
  it('reads RFC 4180 quoting, multiline values, doubled quotes and CRLF', () => {
    expect(readDelimited('lat;lon;name\r\n51;-0.45;"a; b\r\n""c"""\r\n', ';')).toEqual([
      ['lat', 'lon', 'name'],
      ['51', '-0.45', 'a; b\r\n"c"'],
    ]);
  });
  it('reads Flightradar24 Position, feet, and prefers ISO UTC', async () => {
    const r = await importRoute(
      'Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction\n1794304800,2026-11-10T10:00:00Z,AAL100,"51.47,-0.45",100,200,270\n1794322800,2026-11-10T15:00:00Z,AAL100,"40.64,-73.78",35000,400,260',
      context,
    );
    expect(r.flights[0].track.kind).toBe('recorded');
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([30.48, 10668]);
    expect(r.flights[0].track.points[0].time).toBe(Date.parse('2026-11-10T10:00:00Z'));
    expect(r.warnings.some((w) => w.code === 'altitude_feet_assumed')).toBe(false);
  });
  it.each([
    ['alt_ft', '1000', 304.8],
    ['Altitude (ft)', '1000', 304.8],
    ['alt_m', '30000', 30000],
    ['geoaltitude', '30000', 30000],
    ['baroaltitude', '30000', 30000],
    ['Elevation', '1000', 1000],
    ['Altitude', '35000', 10668],
  ])('uses units for %s', async (header, value, expected) => {
    const r = await importRoute(
      `latitude_deg;longitude_deg;${header}\n51.47;-0.45;${value}\n40.64;-73.78;${value}`,
      context,
    );
    expect(r.flights[0].track.points[0].altM).toBe(expected);
    expect(r.warnings.some((w) => w.code === 'altitude_feet_assumed')).toBe(header === 'Altitude');
  });
  it('combines separate date/time fields as UTC, handles tabs', async () => {
    const r = await importRoute(
      'lat\tlng\tdate\ttime\n51.47\t-0.45\t2026-11-10\t10:00:00\n40.64\t-73.78\t2026-11-10\t15:00:00',
      context,
    );
    expect(r.flights[0].track.points.map((p) => p.time)).toEqual([
      Date.parse('2026-11-10T10:00:00Z'),
      Date.parse('2026-11-10T15:00:00Z'),
    ]);
  });
  it.each([
    ['51.47,-0.45,100,1700000000\n40.64,-73.78,200,1700000010000', [51.47, -0.45]],
    ['37.62,-122.38\n21.32,-157.92', [37.62, -122.38]],
    ['-122.38,37.62\n-157.92,21.32', [37.62, -122.38]],
  ])('infers headerless column order: %s', async (text, first) => {
    const r = await importRoute(text, context, { fileName: 'test.csv' });
    expect(r.flights[0].track.points[0]).toMatchObject({ lat: first[0], lng: first[1] });
  });
  it('reports bad/mixed altitude columns without guessing values', async () => {
    const r = await importRoute('lat,lon,alt\n51.47,-0.45,100\n40.64,-73.78,no-data', context);
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([null, null]);
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'altitude_dropped' }));
  });
  it('preserves partial times and clears backwards times without dropping geometry', async () => {
    const r = await importRoute(
      'lat,lon,time\n51.47,-0.45,1700000000\n50,-20,1700000100\n45,-30,1700000050\n40,-50,\n40.64,-73.78,1700000200',
      context,
    );
    expect(r.flights[0].track.points.map((p) => p.time)).toEqual([
      1700000000000,
      1700000100000,
      null,
      null,
      1700000200000,
    ]);
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'times_unordered', params: { count: 1 } }),
        expect.objectContaining({ code: 'times_partial', params: {} }),
      ]),
    );
    expect(r.stats.points).toBe(5);
  });
  it.each(['lat,lon\n"unclosed', 'lat,lon\n51', 'lat,lon\n"51"bad,0'])('reports malformed CSV: %s', async (text) =>
    expect((await importRoute(text, context)).error?.code).toBe('invalid'),
  );
});
describe('IGC', () => {
  it.each(['HFDTE101126', 'HFDTEDATE:101126,01'])(
    'reads %s, GNSS/pressure altitudes and midnight rollover',
    async (date) => {
      const r = await importRoute(
        `AXXXTEST\n${date}\nHFGTYGLIDERTYPE:Test glider\nB2359505128200N00027000WA0010000200\nB0000104040000N07347000WA0012300000\nB0000204040000N07347000WV0012300200`,
        context,
      );
      expect(r.flights[0].track.kind).toBe('recorded');
      expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([200, 123]);
      expect(r.flights[0].track.points[1].time! - r.flights[0].track.points[0].time!).toBe(20000);
      expect(r.flights[0].track.points[0].lat).toBeCloseTo(51 + 28.2 / 60);
      expect(r.stats.droppedPoints).toBe(1);
    },
  );
  it('supports southern/eastern fixes and signed pressure altitude', async () => {
    const r = await importRoute(
      'ATEST\nHFDTE010199\nB1200003350000S15112000EA-012300000\nB1200103350100S15112100EA0000000100',
      context,
    );
    expect(r.flights[0].track.points[0]).toMatchObject({ altM: -123 });
    expect(r.flights[0].track.points[0].lat).toBeLessThan(0);
    expect(r.flights[0].track.points[0].lng).toBeGreaterThan(0);
    expect(new Date(r.flights[0].track.points[0].time!).getUTCFullYear()).toBe(1999);
  });
  it('requires a valid date', async () => {
    const r = await importRoute('ATEST\nHFDTE321126\nB1200005128200N00027000WA0010000200', context);
    expect(r.error?.code).toBe('invalid');
  });
});
