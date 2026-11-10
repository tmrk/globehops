/** Shared limits and vocabulary for browser links, documents and agent clients. */
export const CONTRACT_VERSION = 1;
export const DEFAULT_BASE_URL = 'https://tmrk.github.io/globehops/';
export const MAX_STOPS = 10;
export { MAX_JOURNEYS } from '../lib/compare.ts';
export { MAX_SECTIONS, MAX_STAY_MIN } from '../lib/trip.ts';
import { MAX_SECTIONS } from '../lib/trip.ts';
export const MAX_URL_LENGTH = 8000;
export const MAX_TIMELINE_SAMPLES = 1000;
export const MAX_ITINERARY_PARAM_LENGTH = 6000;
export { MAX_LAYOVER_MIN } from '../lib/layover.ts';
export { PLAYBACK_SPEEDS } from '../state/clock.ts';
export type { PlaybackSpeed } from '../state/clock.ts';
export const LINK_PARAMS = {
  route: 'route',
  label: 'label',
  departure: 'dep',
  arrival: 'arr',
  time: 't',
  play: 'play',
  live: 'live',
  speed: 'speed',
  clock: 'clock',
  units: 'units',
  dayNight: 'daynight',
  follow: 'follow',
  lang: 'lang',
  names: 'names',
  borders: 'borders',
  leg: 'leg',
  itinerary: 'itinerary',
  stay: 'stay',
  airspace: 'airspace',
  diversion: 'diversion',
} as const;

/** Journey A uses unprefixed route/depN/arrN/label; B–D use b., c., d. (case-insensitive). */
export const JOURNEY_LINK_PREFIXES = ['b.', 'c.', 'd.'] as const;
/** Composable after b./c./d. for compared trips (b.2.route … d.6.stay). A trip's first journey uses the unprefixed parameters; the following ones 2.–6., each with an optional stay. */
export const SECTION_LINK_PREFIXES = Array.from({ length: MAX_SECTIONS - 1 }, (_, i) => `${i + 2}.`);
/** Flight numbers in a trip count every journey's flights in order. */
export const MAX_TRIP_FLIGHTS = MAX_SECTIONS * (MAX_STOPS - 1);

export function isNamedClock(value: string): value is 'local' | 'utc' {
  return value === 'local' || value === 'utc';
}
