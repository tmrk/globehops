import { expect, it, vi } from 'vitest';
import { computeJourney } from '../lib/schedule.ts';
import { SimulationClock } from '../state/clock.ts';
import { createSimulationFeed } from '../state/simulation.ts';
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';
import { subsolarPoint } from '../lib/sun.ts';
import { latLngToVector3, sunDirectionScene } from './math3d.ts';

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

it('aligns Earth-fixed SCENE illumination with astronomical altitude for 30 airports × 201 instants, 1900–2100', () => {
  let maxSinError = 0;
  let maxElevationError = 0;
  let signComparisons = 0;
  for (let i = 0; i <= 200; i++) {
    const epochMs = Date.UTC(1900 + i, i % 12, 1 + (i % 28), (i * 7) % 24, (i * 17) % 60);
    const date = new Date(epochMs);
    const subsolar = subsolarPoint(epochMs);
    const sceneSun = sunDirectionScene(subsolar);
    for (const [code, lat, lng] of airports) {
      const observer = new Observer(lat, lng, 0);
      const equatorial = Equator(Body.Sun, date, observer, true, true);
      const altitude = Horizon(date, observer, equatorial.ra, equatorial.dec).altitude;
      const dot = latLngToVector3(lat, lng).dot(sceneSun);
      const sinError = Math.abs(dot - Math.sin((altitude * Math.PI) / 180));
      maxSinError = Math.max(maxSinError, sinError);
      const elevationError = Math.abs((Math.asin(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI - altitude);
      maxElevationError = Math.max(maxElevationError, elevationError);
      expect(elevationError, `${code} at ${date.toISOString()}`).toBeLessThan(0.02);
      expect(sinError, `${code} at ${date.toISOString()}`).toBeLessThan(0.00035);
      if (Math.abs(altitude) >= 1) {
        expect(Math.sign(dot), `${code} at ${date.toISOString()}`).toBe(Math.sign(altitude));
        signComparisons++;
      }
    }
  }
  expect(signComparisons).toBeGreaterThan(5900);
  console.info('Scene alignment accuracy, 6030 airport/time pairs:', {
    maxElevationError,
    maxSinError,
    signComparisons,
  });
});

it('feeds the selected clock UTC instant to sunlight, then resumes live UTC when the timeline closes', () => {
  vi.useFakeTimers();
  const now = Date.parse('2026-12-21T15:00:00Z');
  vi.setSystemTime(now);
  const clock = new SimulationClock();
  const context = {
    journey: computeJourney({ id: 'solar-clock', stops: [] }),
    timeline: null,
    open: false,
    dayNight: true,
    follow: false,
  };
  const feed = createSimulationFeed(clock, () => context);
  const off = feed.subscribe(() => {});
  try {
    clock.goLive();
    expect(feed.getFrame().subsolar).toEqual(subsolarPoint(now));
    context.open = true;
    const selected = Date.parse('1968-02-29T07:23:17Z');
    clock.seek(selected);
    expect(feed.getFrame().subsolar).toEqual(subsolarPoint(selected));
    // App.closeTime clears the range and calls goLive; a dated journey never supplies the Sun's time.
    context.open = false;
    clock.setRange(null, null);
    clock.goLive();
    expect(feed.getFrame().subsolar).toEqual(subsolarPoint(now));
    vi.advanceTimersByTime(30_000);
    expect(feed.getFrame().subsolar).toEqual(subsolarPoint(now + 30_000));
    expect(feed.getFrame().aircraft).toBeNull();
  } finally {
    off();
    clock.dispose();
    vi.useRealTimers();
  }
});
