import { describe, expect, it } from 'vitest';
import {
  Body,
  Equator,
  EquatorFromVector,
  GeoVector,
  Horizon,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  SiderealTime,
} from 'astronomy-engine';
import { normalizeLng } from './geo.ts';
import {
  DAYLIGHT_STOPS,
  SOLAR_ELEVATION_DEG,
  dayLightLevel,
  daylightAt,
  solarDeclinationDeg,
  solarElevationDeg,
  subsolarPoint,
} from './sun.ts';

describe('NOAA/Meeus apparent solar position', () => {
  it('agrees with apparent equator-of-date coordinates across 1900–2100, seasons and UTC times', () => {
    const instants = new Set<number>();
    for (let year = 1900; year <= 2100; year++) {
      // Perihelion/aphelion, equinoxes/solstices, leap boundaries and November's large EOT.
      const days = [
        [0, 3],
        [1, 28],
        [2, 20],
        [5, 21],
        [6, 4],
        [8, 22],
        [10, 3],
        [11, 21],
      ];
      if (new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1) days.push([1, 29]);
      for (const [month, day] of days) {
        for (const offset of [0, 26_597_123, 43_200_000, 86_399_999]) {
          instants.add(Date.UTC(year, month, day) + offset);
        }
      }
    }
    const start = Date.UTC(1900, 0, 1);
    const end = Date.UTC(2100, 11, 31, 23, 59, 59, 999);
    for (let i = 0; i <= 1000; i++) instants.add(start + Math.round(((end - start) * i) / 1000));
    let maxLatitudeError = 0;
    let maxLongitudeError = 0;
    for (const epochMs of instants) {
      const date = new Date(epochMs);
      // Aberrated geocentric vector, rotated from J2000 into the true equator of date;
      // apparent RA minus Greenwich apparent sidereal time gives Earth-fixed longitude.
      const eq = EquatorFromVector(RotateVector(Rotation_EQJ_EQD(date), GeoVector(Body.Sun, date, true)));
      const expectedLongitude = normalizeLng((eq.ra - SiderealTime(date)) * 15);
      const actual = subsolarPoint(epochMs);
      const latitudeError = Math.abs(actual.lat - eq.dec);
      const longitudeError = Math.abs(normalizeLng(actual.lng - expectedLongitude));
      maxLatitudeError = Math.max(maxLatitudeError, latitudeError);
      maxLongitudeError = Math.max(maxLongitudeError, longitudeError);
      expect(latitudeError, date.toISOString()).toBeLessThan(0.005);
      expect(longitudeError, date.toISOString()).toBeLessThan(0.02);
      expect(solarDeclinationDeg(epochMs)).toBe(actual.lat);
      expect(actual.lng).toBeGreaterThanOrEqual(-180);
      expect(actual.lng).toBeLessThan(180);
    }
    console.info('Solar accuracy, 1900–2100 (degrees):', {
      samples: instants.size,
      maxLatitudeError,
      maxLongitudeError,
    });
  });

  it.each([
    ['2024-03-20T03:06Z', 0],
    ['2024-06-20T20:51Z', 23.44],
    ['2024-09-22T12:44Z', 0],
    ['2024-12-21T09:21Z', -23.44],
  ])('matches the fixed equinox/solstice reference %s', (iso, declination) => {
    expect(Math.abs(solarDeclinationDeg(Date.parse(iso)) - declination)).toBeLessThan(0.05);
  });

  it.each([
    ['2024-03-20T12:00Z', 1.82],
    ['2024-06-20T12:00Z', 0.43],
    ['2024-09-22T12:00Z', -1.86],
    ['2024-12-21T12:00Z', -0.42],
  ])('accounts for the equation of time at UTC noon on %s', (iso, expectedLongitude) => {
    // ±1° from Greenwich is impossible in March/September: the equation of time is ~7.4 minutes.
    expect(Math.abs(subsolarPoint(Date.parse(iso)).lng - expectedLongitude)).toBeLessThan(0.05);
  });

  it('is continuous across UTC midnight and returns the solar zenith and nadir', () => {
    const midnight = Date.parse('2026-06-21T00:00Z');
    const before = subsolarPoint(midnight - 1);
    const after = subsolarPoint(midnight);
    expect(Math.abs(normalizeLng(after.lng - before.lng))).toBeLessThan(0.00001);
    for (const epochMs of [Date.parse('1900-01-01T00:00Z'), midnight, Date.parse('2100-12-31T23:59Z')]) {
      const point = subsolarPoint(epochMs);
      expect(solarElevationDeg(epochMs, point)).toBeCloseTo(90, 5);
      expect(solarElevationDeg(epochMs, { lat: -point.lat, lng: normalizeLng(point.lng + 180) })).toBeCloseTo(-90, 5);
    }
  });
});

describe('geometric elevation and daylight', () => {
  it('agrees with astronomy-engine Horizon without refraction for cities, poles and the date line', () => {
    let maxElevationError = 0;
    const cities = [
      [55.618, 12.656],
      [51.47, -0.454],
      [40.641, -73.778],
      [-33.946, 151.177],
      [27.697, 85.359],
      [-43.49, -172.53],
      [1.986, -157.35],
      [90, 0],
      [-90, 0],
      [0, 180],
    ];
    for (const iso of [
      '1900-01-01T00:00Z',
      '1950-01-01T00:00Z',
      '2000-02-29T23:59Z',
      '1968-02-29T07:23Z',
      '2024-03-20T03:06Z',
      '2024-06-20T20:51Z',
      '2024-09-22T12:44Z',
      '2024-12-21T09:21Z',
      '2100-12-31T23:59Z',
    ]) {
      const date = new Date(iso);
      for (const [lat, lng] of cities) {
        const observer = new Observer(lat, lng, 0);
        const equatorial = Equator(Body.Sun, date, observer, true, true);
        const expected = Horizon(date, observer, equatorial.ra, equatorial.dec).altitude;
        const error = Math.abs(solarElevationDeg(date.getTime(), { lat, lng }) - expected);
        maxElevationError = Math.max(maxElevationError, error);
        expect(error, `${iso} at ${lat}, ${lng}`).toBeLessThan(0.02);
      }
    }
    console.info('Solar elevation accuracy, 90 city/time pairs (degrees):', { maxElevationError });
  });

  it('classifies sunlight, civil twilight and night on both sides of the terminator', () => {
    const epochMs = Date.parse('2026-03-20T12:00Z');
    const sun = subsolarPoint(epochMs);
    // At latitude 0 the hour angle for a target elevation follows cos(H) = sin(elev)/cos(dec).
    for (const [elevation, expected] of [
      [45, 'day'],
      [0, 'day'],
      [-0.832, 'day'],
      [-0.834, 'twilight'],
      [-3, 'twilight'],
      [-5.999, 'twilight'],
      [-6.001, 'night'],
      [-45, 'night'],
    ] as const) {
      const hourAngle =
        (Math.acos(Math.sin((elevation * Math.PI) / 180) / Math.cos((sun.lat * Math.PI) / 180)) * 180) / Math.PI;
      for (const sign of [-1, 1]) {
        const point = { lat: 0, lng: normalizeLng(sun.lng + sign * hourAngle) };
        expect(solarElevationDeg(epochMs, point)).toBeCloseTo(elevation, 8);
        expect(daylightAt(epochMs, point)).toBe(expected);
      }
    }
    expect(daylightAt(Date.parse('2026-06-21T12:00Z'), { lat: 90, lng: 0 })).toBe('day');
    expect(daylightAt(Date.parse('2026-12-21T12:00Z'), { lat: 90, lng: 0 })).toBe('night');
    expect(daylightAt(Date.parse('2026-12-21T15:00Z'), { lat: -90, lng: 0 })).toBe('day');
    expect(daylightAt(Date.parse('2026-06-21T12:00Z'), { lat: -90, lng: 0 })).toBe('night');
  });
});

describe('solar elevation display curve', () => {
  it.each(DAYLIGHT_STOPS)('has blend %s° → %s, including sunset at exactly 0.5', (elevation, level) => {
    expect(dayLightLevel(elevation)).toBeCloseTo(level, 12);
  });

  it('is centred on sunset and narrow: night by −4°, full day by +2.5°', () => {
    expect(DAYLIGHT_STOPS[0][0]).toBeCloseTo(-3.833, 2);
    expect(DAYLIGHT_STOPS[2][0]).toBeCloseTo(2.167, 2);
    for (const elevation of [-1000, -90, -18, -12, -6, -4]) expect(dayLightLevel(elevation)).toBe(0);
    for (const elevation of [2.5, 10, 45, 90, 1000]) expect(dayLightLevel(elevation)).toBe(1);
    // Most of the change happens within about ±1.8° of sunset.
    expect(dayLightLevel(SOLAR_ELEVATION_DEG.sunset - 1.8)).toBeLessThan(0.12);
    expect(dayLightLevel(SOLAR_ELEVATION_DEG.sunset + 1.8)).toBeGreaterThan(0.88);
  });

  it('brightens continuously and monotonically, steepest at sunset', () => {
    let previous = 0;
    let steepest = { slope: 0, elevation: Number.NaN };
    for (let step = -9000; step <= 9000; step++) {
      const level = dayLightLevel(step / 100);
      expect(level).toBeGreaterThanOrEqual(previous);
      expect(level).toBeLessThanOrEqual(1);
      if (level - previous > steepest.slope) steepest = { slope: level - previous, elevation: step / 100 };
      previous = level;
    }
    expect(Math.abs(steepest.elevation - SOLAR_ELEVATION_DEG.sunset)).toBeLessThan(0.02);
    // Symmetric about sunset: what darkens on one side brightens on the other.
    for (const offset of [0.5, 1, 2, 2.9]) {
      const sum =
        dayLightLevel(SOLAR_ELEVATION_DEG.sunset - offset) + dayLightLevel(SOLAR_ELEVATION_DEG.sunset + offset);
      expect(sum).toBeCloseTo(1, 3);
    }
  });
});
