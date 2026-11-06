/** Shared limits and vocabulary for browser links, documents and agent clients. */
export const CONTRACT_VERSION = 1;
export const DEFAULT_BASE_URL = 'https://tmrk.github.io/globehops/';
export const MAX_STOPS = 10;
export { MAX_JOURNEYS } from '../lib/compare.ts';
export const MAX_URL_LENGTH = 8000;
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
} as const;
export const ROUTE_PARAM = LINK_PARAMS.route;
export const ITINERARY_PARAM = LINK_PARAMS.itinerary;

/** Journey A uses unprefixed route/depN/arrN/label; B–D use b., c., d. (case-insensitive). */
export const JOURNEY_LINK_PREFIXES = ['b.', 'c.', 'd.'] as const;
