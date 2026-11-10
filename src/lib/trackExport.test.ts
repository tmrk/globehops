import { describe, expect, it } from 'vitest';
import type { Airport } from '../types.ts';
import type { CustomTrack } from './track.ts';
import { exportFileName, tracksToGeoJson } from './trackExport.ts';

const airport = (iata: string, lat: number, lng: number): Airport => ({
  id: lat * 1000 + lng,
  ident: `K${iata}`,
  iata,
  icao: null,
  name: iata,
  city: iata,
  region: '',
  countryCode: '',
  country: '',
  lat,
  lng,
  type: 'large',
  scheduled: true,
  keywords: [],
});
const LHR = airport('LHR', 51.47, -0.4543);
const JFK = airport('JFK', 40.6413, -73.7781);
const recorded: CustomTrack = {
  kind: 'recorded',
  source: { format: 'gpx', name: 'BA117.gpx' },
  points: [
    { lat: 51.4700001234, lng: -0.4543, altM: 25.04, time: Date.UTC(2026, 2, 1, 10, 15, 30) },
    { lat: 52, lng: -10, altM: 10668, time: Date.UTC(2026, 2, 1, 11, 0) },
    { lat: 40.6413, lng: -73.7781, altM: null, time: null },
  ],
};
const planned: CustomTrack = {
  kind: 'planned',
  source: { format: 'route', name: null },
  points: [
    { lat: 51.47, lng: -0.4543, altM: null, time: null, name: 'EGLL' },
    { lat: 53, lng: -30, altM: 10668, time: null, name: '53N030W' },
    { lat: 40.6413, lng: -73.7781, altM: null, time: null, name: 'KJFK' },
  ],
};

describe('custom path export', () => {
  it('keeps every point, altitude and time of each flight, with its provenance', () => {
    const doc = tracksToGeoJson([{ from: LHR, to: JFK, track: recorded }], 'BA117.gpx');
    expect(doc.name).toBe('BA117.gpx');
    const [feature] = doc.features;
    expect(feature.properties).toMatchObject({ from: 'LHR', to: 'JFK', kind: 'recorded', source: 'gpx' });
    expect(feature.properties.coordTimes).toEqual(['2026-03-01T10:15:30.000Z', '2026-03-01T11:00:00.000Z', null]);
    expect(feature.geometry.coordinates).toEqual([
      [-0.4543, 51.4700001, 25],
      [-10, 52, 10668],
      [-73.7781, 40.6413],
    ]);
  });

  it('keeps a plan’s waypoint names and leaves out times it never had', () => {
    const [feature] = tracksToGeoJson([{ from: LHR, to: JFK, track: planned }]).features;
    expect(feature.properties.waypoints).toEqual(['EGLL', '53N030W', 'KJFK']);
    expect(feature.properties).not.toHaveProperty('coordTimes');
  });

  it('names the file after the path, or its route', () => {
    const flights = [{ from: LHR, to: JFK, track: planned }];
    expect(exportFileName(flights, 'BA117.gpx')).toBe('BA117.geojson');
    expect(exportFileName(flights, null)).toBe('LHR-JFK.geojson');
    expect(exportFileName(flights, 'a/b:c')).toBe('a-b-c.geojson');
  });
});
