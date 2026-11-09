/** Run with `node scripts/bench-routing.ts`; all numbers are wall-clock milliseconds on this machine. */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { decodeAirspace } from '../src/data/airspace.ts';
import { decodeDiversionAirports } from '../src/data/diversion.ts';
import { createRouter } from '../src/lib/router.ts';
import { DEFAULT_DIVERSION_PROFILE, diversionProfile, rasteriseCoverage } from '../src/lib/diversion.ts';
const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../src/data/generated/${name}.json`, import.meta.url), 'utf8'));
const airspace = decodeAirspace(read('airspace'));
const diversion = decodeDiversionAirports(read('diversion-airports'));
const airports = (
  read('airports') as { airports: [number, string, string, string, string, string, string, string, number, number][] }
).airports;
const endpoint = (code: string) => {
  const a = airports.find((a) => a[2] === code);
  if (!a) throw new Error(`Missing ${code}`);
  return { lat: a[8], lng: a[9], countryCode: a[6] };
};
for (let i = 0; i < 3; i++) {
  const start = performance.now();
  rasteriseCoverage(diversion.airports, 2222.4);
  console.log(`grid ${i + 1}: ${(performance.now() - start).toFixed(2)} ms`);
}
console.log('route\tavoid\tprofile\tstatus\tGC km\tshown km\tmaxMin\toutside km\textra km\tms');
for (const [from, to, minutes] of [
  ['CPH', 'JFK', 180],
  ['LHR', 'LAX', 180],
  ['SFO', 'HND', 180],
  ['SYD', 'SCL', 180],
  ['SYD', 'SCL', 330],
  ['JNB', 'PER', 180],
  ['GRU', 'JNB', 180],
  ['CPT', 'EZE', 180],
  ['HNL', 'AKL', 180],
  ['HNL', 'SYD', 180],
  ['AKL', 'SCL', 180],
  ['HEL', 'NRT', 180],
  ['FRA', 'ICN', 180],
  ['IPC', 'PPT', 180],
  ['CCK', 'PER', 180],
] as const) {
  for (const avoidAirspace of [false, true]) {
    const router = createRouter({ airspace, diversion });
    const start = performance.now();
    const r = router.route(endpoint(from), endpoint(to), {
      epochMs: Date.UTC(2026, 10, 15),
      avoidAirspace,
      diversion: minutes === 180 ? DEFAULT_DIVERSION_PROFILE : diversionProfile(minutes),
    });
    console.log(
      `${from}-${to}\t${avoidAirspace}\t${minutes}\t${r.diversion?.status}/${r.status}\t${r.greatCircleKm.toFixed(1)}\t${r.distanceKm.toFixed(1)}\t${r.diversion?.maxMin}\t${r.diversion?.outsideKm.toFixed(1)}\t${r.diversion?.extraKm.toFixed(1)}\t${(performance.now() - start).toFixed(2)}`,
    );
  }
}
