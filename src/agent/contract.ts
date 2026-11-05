/** Shared limits and vocabulary for browser links, documents and agent clients. */
export const CONTRACT_VERSION = 1;
export const DEFAULT_BASE_URL = 'https://tmrk.github.io/globehops/';
export const MAX_STOPS = 10;
export const MAX_URL_LENGTH = 8000;
export const MAX_ITINERARY_PARAM_LENGTH = 6000;
export { MAX_LAYOVER_MIN } from '../lib/layover.ts';
export { PLAYBACK_SPEEDS } from '../state/clock.ts';
export type { PlaybackSpeed } from '../state/clock.ts';
export const LINK_PARAMS = {
  route: 'route',
  departure: 'dep',
  arrival: 'arr',
  time: 't',
  play: 'play',
  speed: 'speed',
  clock: 'clock',
  units: 'units',
  dayNight: 'daynight',
  itinerary: 'itinerary',
} as const;
export const ROUTE_PARAM = LINK_PARAMS.route;
export const ITINERARY_PARAM = LINK_PARAMS.itinerary;
