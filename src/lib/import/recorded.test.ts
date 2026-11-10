import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '../track.ts';
import { splitRecorded } from './recorded.ts';
import { importRoute } from './index.ts';
import { context } from './testContext.ts';
const p = (lng: number, min: number, altM: number | null = null): TrackPoint => ({
  lat: 0,
  lng,
  altM,
  time: Date.UTC(2026, 10, 10) + min * 60000,
});

describe('recorded-log splitting', () => {
  it('splits stationary coverage gaps at the boundary, preserving each point once', () => {
    const points = [p(-10, 0), p(0, 10), p(0.01, 30), p(10, 40)];
    const parts = splitRecorded(points);
    expect(parts).toEqual([points.slice(0, 2), points.slice(2)]);
    expect(parts.flat()).toEqual(points);
  });
  it('does not split long-distance coverage gaps', () =>
    expect(splitRecorded([p(0, 0), p(10, 10), p(100, 300), p(110, 320)])).toHaveLength(1));
  it('splits at the middle of a sustained ground phase, keeping every timestamp unchanged', () => {
    const points = [p(-10, 0, 1000), p(0, 10, 10), p(0.01, 15, 20), p(0.01, 20, 15), p(0.01, 25, 30), p(10, 35, 1000)];
    const parts = splitRecorded(points);
    expect(parts.map((x) => x.length)).toEqual([3, 3]);
    expect(parts.flat()).toEqual(points);
    expect(parts[1][0]).toBe(points[3]);
  });
  it('uses the same sustained rule when altitude is unavailable', () => {
    expect(splitRecorded([p(-10, 0), p(0, 10), p(0, 15), p(0, 20), p(0, 25), p(10, 35)])).toHaveLength(2);
  });
  it('does not treat a slow climb, missing times, initial taxi or final taxi as an intervening ground phase', () => {
    expect(
      splitRecorded([p(-10, 0, 1000), p(0, 10, 10), p(0, 15, 300), p(0, 20, 600), p(0, 25, 900), p(10, 35, 1000)]),
    ).toHaveLength(1);
    const missing = [p(-10, 0), p(0, 10), { ...p(0, 20), time: null }, p(0, 30), p(10, 40)];
    expect(splitRecorded(missing)).toHaveLength(1);
    expect(splitRecorded([p(0, 0), p(0, 5), p(0, 10), p(0, 15), p(10, 25)])).toHaveLength(1);
    expect(splitRecorded([p(-10, 0), p(0, 10), p(0, 15), p(0, 20), p(0, 25)])).toHaveLength(1);
  });
  it('keeps singleton pieces out of split results', () => {
    expect(splitRecorded([p(0, 0), p(0, 30), p(10, 40)])).toHaveLength(1);
  });
  it.each(['geojson', 'csv', 'gpx', 'kml', 'igc'] as const)('applies shared splitting to %s', async (format) => {
    const points = [p(-10, 0), p(0, 10), p(0.01, 30), p(10, 40)];
    const texts = {
      geojson: JSON.stringify({
        type: 'Feature',
        properties: { times: points.map((p) => p.time) },
        geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
      }),
      csv: 'lat,lon,time\n' + points.map((p) => `${p.lat},${p.lng},${p.time}`).join('\n'),
      gpx:
        '<gpx><trk><trkseg>' +
        points
          .map((p) => `<trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.time!).toISOString()}</time></trkpt>`)
          .join('') +
        '</trkseg></trk></gpx>',
      kml:
        '<kml xmlns:gx="test"><Placemark><gx:Track>' +
        points.map((p) => `<when>${new Date(p.time!).toISOString()}</when>`).join('') +
        points.map((p) => `<gx:coord>${p.lng} ${p.lat} 0</gx:coord>`).join('') +
        '</gx:Track></Placemark></kml>',
      igc: 'ATEST\nHFDTE101126\nB0000000000000N01000000WA0000000000\nB0010000000000N00000000EA0000000000\nB0030000000000N00000600EA0000000000\nB0040000000000N01000000EA0000000000',
    };
    const r = await importRoute(texts[format], context, { format });
    expect(r.flights).toHaveLength(2);
    expect(r.flights.flatMap((f) => f.track.points)).toHaveLength(4);
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'split_flights', params: { count: 2 } }));
  });
});
