import { expect, it } from 'vitest';
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';
import { subsolarPoint } from '../lib/sun.ts';
import { latLngToVector3 } from './math3d.ts';

// Independent airport coordinates spanning both hemispheres, polar regions and the date line.
const airports = [
  ['CPH', 55.618, 12.656],
  ['LHR', 51.47, -0.454],
  ['JFK', 40.641, -73.778],
  ['SYD', -33.946, 151.177],
  ['KTM', 27.697, 85.359],
  ['CHT', -43.81, -176.457],
  ['CXI', 1.986, -157.35],
  ['AKL', -37.008, 174.792],
  ['HNL', 21.319, -157.922],
  ['APW', -13.83, -172.008],
  ['LAX', 33.943, -118.408],
  ['YVR', 49.194, -123.184],
  ['ANC', 61.174, -149.996],
  ['GRU', -23.435, -46.473],
  ['SCL', -33.393, -70.786],
  ['EZE', -34.822, -58.536],
  ['CPT', -33.965, 18.602],
  ['JNB', -26.139, 28.246],
  ['NBO', -1.319, 36.928],
  ['CAI', 30.122, 31.406],
  ['DXB', 25.253, 55.365],
  ['DEL', 28.556, 77.1],
  ['SIN', 1.35, 103.994],
  ['HND', 35.552, 139.78],
  ['PEK', 40.08, 116.585],
  ['PER', -31.94, 115.967],
  ['KEF', 63.985, -22.605],
  ['LYR', 78.246, 15.466],
  ['USH', -54.843, -68.296],
  ['HEL', 60.317, 24.963],
] as const;

it('aligns Earth-fixed SCENE illumination with astronomical altitude for 30 airports × 20 instants', () => {
  let maxSinError = 0;
  let signComparisons = 0;
  for (let i = 0; i < 20; i++) {
    const epochMs = Date.UTC(1950, 0, 1) + i * 2497.17391 * 86_400_000;
    const date = new Date(epochMs);
    const subsolar = subsolarPoint(epochMs);
    const sceneSun = latLngToVector3(subsolar.lat, subsolar.lng);
    for (const [code, lat, lng] of airports) {
      const observer = new Observer(lat, lng, 0);
      const equatorial = Equator(Body.Sun, date, observer, true, true);
      const altitude = Horizon(date, observer, equatorial.ra, equatorial.dec).altitude;
      const dot = latLngToVector3(lat, lng).dot(sceneSun);
      const sinError = Math.abs(dot - Math.sin((altitude * Math.PI) / 180));
      maxSinError = Math.max(maxSinError, sinError);
      expect(sinError, `${code} at ${date.toISOString()}`).toBeLessThan(0.01);
      if (Math.abs(altitude) >= 1) {
        expect(Math.sign(dot), `${code} at ${date.toISOString()}`).toBe(Math.sign(altitude));
        signComparisons++;
      }
    }
  }
  expect(signComparisons).toBeGreaterThan(550);
  console.info('Scene alignment accuracy, 600 airport/time pairs:', { maxSinError, signComparisons });
});
