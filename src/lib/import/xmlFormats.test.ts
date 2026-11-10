import { describe, expect, it } from 'vitest';
import { importRoute } from './index.ts';
import { context } from './testContext.ts';
import { parseXml } from './xml.ts';
const gpxPoint = (tag: string, lat: number, lon: number, rest = '') =>
  `<${tag} lat="${lat}" lon="${lon}">${rest}</${tag}>`;
const kml = (content: string) =>
  `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Test flight</name>${content}</Document></kml>`;
const coords = '<coordinates>-0.45,51.47,83 -73.78,40.64,25</coordinates>';

describe('DOM-free XML reader', () => {
  it('reads namespaces, comments, CDATA, numeric and standard entities without expanding custom entities', () => {
    const node = parseXml(
      '<?xml version="1.0"?><!--comment--><g:gpx xmlns:g="test"><name a="&quot;&amp;&#x41;">A &amp; B<![CDATA[ <C>]]>&#65;&#99999999;</name></g:gpx>',
    );
    expect(node.tag).toBe('gpx');
    expect(node.children[0]).toMatchObject({ text: 'A & B <C>A\uFFFD', attrs: { a: '"&A' } });
  });
  it.each([
    '<gpx><trkseg>',
    '<gpx><trk></gpx>',
    '<gpx/><gpx/>',
    '<gpx a="bad></gpx>',
    '<!DOCTYPE gpx SYSTEM "https://example.org"><gpx/>',
    '<gpx><!--',
    '<gpx>',
  ])('rejects malformed/DTD XML: %s', (text) => expect(() => parseXml(text)).toThrow());
  it('does not recurse through deep input', () =>
    expect(parseXml('<gpx>' + '<a>'.repeat(10_000) + '</a>'.repeat(10_000) + '</gpx>').tag).toBe('gpx'));
});
describe('GPX', () => {
  it('concatenates segments in each track, retaining all fixes and names', async () => {
    const r = await importRoute(
      `<gpx><metadata><name>Day log</name></metadata><trk><name>LHR → JFK</name><trkseg>${gpxPoint('trkpt', 51.47, -0.45, '<ele>8.4</ele><time>2026-11-10T01:00:00Z</time>')}</trkseg><trkseg>${gpxPoint('trkpt', 40.64, -73.78, '<ele>-2</ele><time>2026-11-10T08:00:00Z</time>')}</trkseg></trk><trk><name>Return</name><trkseg>${gpxPoint('trkpt', 40.64, -73.78)}${gpxPoint('trkpt', 51.47, -0.45)}</trkseg></trk></gpx>`,
      context,
    );
    expect(r.flights).toHaveLength(2);
    expect(r.name).toBe('Day log');
    expect(r.flights[0].track).toMatchObject({ kind: 'recorded', source: { name: 'LHR → JFK' } });
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([8.4, -2]);
    expect(r.flights[1].track.kind).toBe('planned');
  });
  it('imports routes and names but does not mix in standalone waypoints', async () => {
    const r = await importRoute(
      `<gpx><rte><name>Planned</name>${gpxPoint('rtept', 51.47, -0.45, '<name>EGLL</name>')}${gpxPoint('rtept', 40.64, -73.78, '<name>KJFK</name>')}</rte>${gpxPoint('wpt', 0, 0)}</gpx>`,
      context,
    );
    expect(r.flights[0].track.points.map((p) => p.name)).toEqual(['EGLL', 'KJFK']);
    expect(r.flights[0].track.kind).toBe('planned');
    expect(r.stats.points).toBe(2);
  });
  it('falls back to document-order waypoints', async () => {
    const r = await importRoute(
      `<gpx>${gpxPoint('wpt', 51.47, -0.45)}${gpxPoint('wpt', 40.64, -73.78)}</gpx>`,
      context,
    );
    expect(r.flights[0].track.points.map((p) => p.lat)).toEqual([51.47, 40.64]);
  });
  it('records drops and returns no_path if fewer than two remain', async () => {
    const r = await importRoute(
      '<gpx><trk><trkseg><trkpt lat="NaN" lon="0"/><trkpt lat="91" lon="0"/></trkseg></trk></gpx>',
      context,
    );
    expect(r.error?.code).toBe('no_path');
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'dropped_points', params: { count: 2 } }));
  });
});
describe('KML', () => {
  it.each([
    ['', [83, 25]],
    ['<altitudeMode>absolute</altitudeMode>', [83, 25]],
    ['<altitudeMode>relativeToGround</altitudeMode>', [83, 25]],
    ['<altitudeMode>clampToGround</altitudeMode>', [null, null]],
  ])('handles altitude mode %s', async (mode, expected) => {
    const r = await importRoute(
      kml(`<Placemark><name>AAL100 KJFK-EGLL</name><LineString>${mode}${coords}</LineString></Placemark>`),
      context,
    );
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual(expected);
    expect(r.flights[0].track.source.name).toBe('AAL100 KJFK-EGLL');
  });
  it('uses null for default ground/zero altitudes', async () => {
    const r = await importRoute(
      kml('<Placemark><LineString><coordinates>-0.45,51.47,0 -73.78,40.64</coordinates></LineString></Placemark>'),
      context,
    );
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([null, null]);
  });
  it('supports FlightAware gx:Track and gx:MultiTrack in document order', async () => {
    const track =
      '<gx:Track><when>2026-11-10T10:00:00Z</when><when>2026-11-10T15:00:00Z</when><gx:coord>-0.45 51.47 0</gx:coord><gx:coord>-73.78 40.64 11000</gx:coord></gx:Track>';
    const r = await importRoute(
      kml(
        `<Placemark><gx:MultiTrack>${track}${track}</gx:MultiTrack></Placemark><Placemark><LineString>${coords}</LineString></Placemark>`,
      ),
      context,
    );
    expect(r.flights).toHaveLength(2);
    expect(r.flights[0].track.points).toHaveLength(4);
    expect(r.flights[0].track.kind).toBe('recorded');
    expect(r.warnings.some((w) => w.code === 'times_unordered')).toBe(true);
  });
  it('uses FR24 timed point Placemarks instead of their duplicate Trail', async () => {
    const r = await importRoute(
      kml(
        `<Placemark><name>Trail</name><LineString>${coords}</LineString></Placemark><Placemark><TimeStamp><when>2026-11-10T10:00:00Z</when></TimeStamp><Point><coordinates>-0.45,51.47,83</coordinates></Point></Placemark><Placemark><TimeStamp><when>2026-11-10T15:00:00Z</when></TimeStamp><Point><coordinates>-73.78,40.64,25</coordinates></Point></Placemark>`,
      ),
      context,
    );
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0].track.kind).toBe('recorded');
    expect(r.flights[0].track.points).toHaveLength(2);
    expect(r.flights[0].track.points[0]).toMatchObject({
      lat: 51.47,
      lng: -0.45,
      altM: 83,
      time: Date.parse('2026-11-10T10:00:00Z'),
    });
  });
  it('concatenates a Placemark MultiGeometry without changing its vertices', async () => {
    const r = await importRoute(
      kml(
        `<Placemark><MultiGeometry><LineString>${coords}</LineString><LineString>${coords}</LineString></MultiGeometry></Placemark>`,
      ),
      context,
    );
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0].track.points).toHaveLength(4);
  });
});
describe('flight-plan XML', () => {
  it('resolves Garmin waypoint tables by ordered route references, not table order', async () => {
    const r = await importRoute(
      '<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1"><waypoint-table><waypoint><identifier>KJFK</identifier><lat>40.64</lat><lon>-73.78</lon></waypoint><waypoint><identifier>EGLL</identifier><lat>51.47</lat><lon>-0.45</lon></waypoint></waypoint-table><route><route-name>Atlantic</route-name><route-point><waypoint-identifier>EGLL</waypoint-identifier></route-point><route-point><waypoint-identifier>MISSING</waypoint-identifier></route-point><route-point><waypoint-identifier>KJFK</waypoint-identifier></route-point></route></flight-plan>',
      context,
    );
    expect(r.flights[0].track.points.map((p) => p.name)).toEqual(['EGLL', 'KJFK']);
    expect(r.flights[0].track.kind).toBe('planned');
    expect(r.name).toBe('Atlantic');
    expect(r.stats.droppedPoints).toBe(1);
  });
  it('parses MSFS WorldPosition DMS and feet', async () => {
    const r = await importRoute(
      `<SimBase.Document><FlightPlan.FlightPlan><Title>EGLL-KJFK</Title><ATCWaypoint id="EGLL"><WorldPosition>N51° 28' 12.00",W0° 27' 00.00",+000083.00</WorldPosition></ATCWaypoint><ATCWaypoint id="KJFK"><WorldPosition>N40° 38' 24.00",W73° 46' 48.00",+000025.00</WorldPosition></ATCWaypoint></FlightPlan.FlightPlan></SimBase.Document>`,
      context,
    );
    expect(r.flights[0].track.points[0].lat).toBeCloseTo(51.47);
    expect(r.flights[0].track.points[0].lng).toBeCloseTo(-0.45);
    expect(r.flights[0].track.points[0].altM).toBe(83 * 0.3048);
    expect(r.flights[0].track.points[1].name).toBe('KJFK');
  });
  it('parses LittleNavmap attributes case-insensitively and converts feet', async () => {
    const r = await importRoute(
      '<LittleNavmap><Flightplan><Waypoints><Waypoint><Ident>EGLL</Ident><Pos Lon="-0.45" Lat="51.47" Alt="100"/></Waypoint><Waypoint><Ident>KJFK</Ident><Pos Lon="-73.78" Lat="40.64" Alt="-5"/></Waypoint></Waypoints></Flightplan></LittleNavmap>',
      context,
      { fileName: 'test.lnmpln' },
    );
    expect(r.format).toBe('pln');
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([30.48, -1.524]);
  });
});

it('keeps unrelated KML line flights alongside timed points while removing the duplicate Trail', async () => {
  const r = await importRoute(
    kml(
      `<Placemark><name>Other flight</name><LineString><coordinates>-122.38,37.62 -157.92,21.32</coordinates></LineString></Placemark><Placemark><name>Trail</name><LineString>${coords}</LineString></Placemark><Placemark><TimeStamp><when>2026-11-10T10:00:00Z</when></TimeStamp><Point><coordinates>-0.45,51.47,83</coordinates></Point></Placemark><Placemark><TimeStamp><when>2026-11-10T15:00:00Z</when></TimeStamp><Point><coordinates>-73.78,40.64,25</coordinates></Point></Placemark>`,
    ),
    context,
  );
  expect(r.flights).toHaveLength(2);
  expect(r.flights[0].from.ident).toBe('KSFO');
  expect(r.flights[1].track.kind).toBe('recorded');
  expect(r.flights.map((f) => f.track.points.length)).toEqual([2, 2]);
});

it('does not suppress a KML line whose vertices occur in a different order', async () => {
  const positions = ['-0.45,51.47', '-10,50', '-20,48', '-73.78,40.64'];
  const placemarks = positions
    .map(
      (pos, i) =>
        `<Placemark><TimeStamp><when>2026-11-10T1${i}:00:00Z</when></TimeStamp><Point><coordinates>${pos}</coordinates></Point></Placemark>`,
    )
    .join('');
  const r = await importRoute(
    kml(
      `<Placemark><LineString><coordinates>${[positions[0], positions[2], positions[1], positions[3]].join(' ')}</coordinates></LineString></Placemark>${placemarks}`,
    ),
    context,
  );
  expect(r.flights).toHaveLength(2);
  expect(r.flights[0].track.points[1].lng).toBe(-20);
  expect(r.flights[1].track.points[1].lng).toBe(-10);
});

it('uses the first timed Placemark name when a KML Document has no name', async () => {
  const points = ['-0.45,51.47', '-73.78,40.64']
    .map(
      (pos, i) =>
        `<Placemark><name>AAL100 LHR-JFK</name><TimeStamp><when>2026-11-10T1${i}:00:00Z</when></TimeStamp><Point><coordinates>${pos}</coordinates></Point></Placemark>`,
    )
    .join('');
  const r = await importRoute(`<kml><Document>${points}</Document></kml>`, context);
  expect(r.name).toBe('AAL100 LHR-JFK');
  expect(r.flights[0].track.source.name).toBe('AAL100 LHR-JFK');
});

it('warns about invalid flight-plan altitudes while retaining valid positions', async () => {
  const r = await importRoute(
    '<LittleNavmap><Waypoint><Ident>EGLL</Ident><Pos Lat="51.47" Lon="-0.45" Alt="invalid"/></Waypoint><Waypoint><Ident>KJFK</Ident><Pos Lat="40.64" Lon="-73.78" Alt="100"/></Waypoint></LittleNavmap>',
    context,
  );
  expect(r.ok).toBe(true);
  expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([null, 30.48]);
  expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'altitude_dropped' }));
});
