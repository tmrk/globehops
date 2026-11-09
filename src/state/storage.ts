import { parseConsent, type AnalyticsConsent } from '../lib/analytics.ts';
import type { DistanceUnit } from '../types.ts';
import { MAX_STOPS, isNamedClock } from '../agent/contract.ts';
const UNIT_KEY = 'globehops:unit';
const ROUTE_KEY = 'globehops:lastRoute';
const MAX_JOURNEY_QUERY_LENGTH = 4000;

/** Storage can be disabled, full or blocked in private modes; every access is best-effort. */
function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
}

export function loadUnit(): DistanceUnit | null {
  const unit = read(UNIT_KEY);
  return unit === 'km' || unit === 'mi' ? unit : null;
}
export function saveUnit(unit: DistanceUnit): void {
  write(UNIT_KEY, unit);
}
export function loadLastRoute(): string[] | null {
  const raw = read(ROUTE_KEY);
  if (raw === null) return null;
  try {
    const codes: unknown = JSON.parse(raw);
    return Array.isArray(codes) && codes.every((code) => typeof code === 'string') ? codes.slice(0, MAX_STOPS) : null;
  } catch {
    return null;
  }
}

function booleanSetting(key: string) {
  return {
    load(): boolean | null {
      const value = read(key);
      return value === 'on' ? true : value === 'off' ? false : null;
    },
    save(on: boolean): void {
      write(key, on ? 'on' : 'off');
    },
  };
}

export const { load: loadBorders, save: saveBorders } = booleanSetting('globehops:borders');
export const { load: loadCountryNames, save: saveCountryNames } = booleanSetting('globehops:countryNames');
export const { load: loadFollowAircraft, save: saveFollowAircraft } = booleanSetting('globehops:followAircraft');
/** Water-name visibility inherits the saved country-name preference until explicitly chosen. */
export const { load: loadWaterNames, save: saveWaterNames } = booleanSetting('globehops:waterNames');
/** A null motion preference follows the system. */
export const { load: loadReduceMotion, save: saveReduceMotion } = booleanSetting('globehops:reduceMotion');
/** Only permission is stored; coordinates stay in memory. */
export const { load: loadMyLocation, save: saveMyLocation } = booleanSetting('globehops:myLocation');
export const { load: loadDayNight, save: saveDayNight } = booleanSetting('globehops:daynight');
/** Route flights around restricted airspace; unset means on. */
export const { load: loadAvoidAirspace, save: saveAvoidAirspace } = booleanSetting('globehops:avoidAirspace');

const JOURNEY_KEY = 'globehops:lastJourney';
const CLOCK_ZONE_KEY = 'globehops:clockZone';
export function loadLastJourney(): string | null {
  const query = read(JOURNEY_KEY);
  return query !== null && query.length <= MAX_JOURNEY_QUERY_LENGTH ? query : null;
}
export function saveLastJourney(query: string): void {
  if (query.length > MAX_JOURNEY_QUERY_LENGTH) return;
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (['t', 'play', 'units'].includes(key.toLowerCase())) params.delete(key);
  const canonical = params.toString().replace(/%3A/gi, ':');
  const remembered = canonical ? `?${canonical}` : '';
  if (remembered.length <= MAX_JOURNEY_QUERY_LENGTH) write(JOURNEY_KEY, remembered);
}
export function loadClockZone(): 'local' | 'utc' | null {
  const value = read(CLOCK_ZONE_KEY);
  return value !== null && isNamedClock(value) ? value : null;
}
export function saveClockZone(zone: 'local' | 'utc'): void {
  write(CLOCK_ZONE_KEY, zone);
}

const ANALYTICS_KEY = 'globehops:analytics';
/** The visitor's analytics decision; null until they choose. */
export function loadAnalyticsConsent(): AnalyticsConsent | null {
  return parseConsent(read(ANALYTICS_KEY));
}
export function saveAnalyticsConsent(consent: AnalyticsConsent): void {
  write(ANALYTICS_KEY, consent);
}
