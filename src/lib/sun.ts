import type { LatLng } from '../types.ts';
import { normalizeLng } from './geo.ts';

const RAD = Math.PI / 180;
const DAY = 86_400_000;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

/**
 * NOAA Solar Calculator / Meeus, Astronomical Algorithms, chapters 22, 25, 28.
 * https://gml.noaa.gov/grad/solcalc/calcdetails.html
 * https://gml.noaa.gov/grad/solcalc/main.js (calcSunDeclination / calcEquationOfTime)
 * Low-precision apparent Sun of date, with nutation/aberration; geometric elevation,
 * no atmospheric refraction. Julian day comes directly from epoch ms (no 1901–2099 shortcut).
 */
function solarCoordinates(epochMs: number): { declination: number; equationOfTime: number } {
  const t = (epochMs / DAY + 2440587.5 - 2451545) / 36525;
  const meanLongitude = normalizeLng(280.46646 + t * (36000.76983 + 0.0003032 * t));
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t) +
    sin(3 * meanAnomaly) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * sin(omega);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - 0.001813 * t))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cos(omega);
  const y = Math.tan((obliquity * RAD) / 2) ** 2;
  const equationOfTime =
    (4 / RAD) *
    (y * sin(2 * meanLongitude) -
      2 * eccentricity * sin(meanAnomaly) +
      4 * eccentricity * y * sin(meanAnomaly) * cos(2 * meanLongitude) -
      0.5 * y * y * sin(4 * meanLongitude) -
      1.25 * eccentricity * eccentricity * sin(2 * meanAnomaly));
  return { declination: Math.asin(sin(obliquity) * sin(apparentLongitude)) / RAD, equationOfTime };
}

export function subsolarPoint(epochMs: number): LatLng {
  const { declination, equationOfTime } = solarCoordinates(epochMs);
  // Positive modulo also handles pre-1970 instants without Date-local-time APIs.
  const utcHours = (((epochMs % DAY) + DAY) % DAY) / 3_600_000;
  return { lat: declination, lng: normalizeLng(-15 * (utcHours - 12 + equationOfTime / 60)) };
}

export function solarDeclinationDeg(epochMs: number): number {
  return solarCoordinates(epochMs).declination;
}

export function solarElevationDeg(epochMs: number, p: LatLng): number {
  const sun = subsolarPoint(epochMs);
  const dot = sin(p.lat) * sin(sun.lat) + cos(p.lat) * cos(sun.lat) * cos(p.lng - sun.lng);
  return Math.asin(Math.max(-1, Math.min(1, dot))) / RAD;
}

export type Daylight = 'day' | 'twilight' | 'night';

export function daylightAt(epochMs: number, p: LatLng): Daylight {
  const elevation = solarElevationDeg(epochMs, p);
  return elevation > -0.833 ? 'day' : elevation >= -6 ? 'twilight' : 'night';
}
