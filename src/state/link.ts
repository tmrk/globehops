import { isLocale, type Locale } from '../i18n/locales.ts';
import { localizedPath, localeFromPath } from '../i18n/detect.ts';
import type { Airport, DistanceUnit, LocalTimeInput } from '../types.ts';
import type { PlaybackSpeed } from './clock.ts';
import { PLAYBACK_SPEEDS, MAX_URL_LENGTH, MAX_STOPS, LINK_PARAMS as P } from '../agent/contract.ts';
import {
  decodeItineraryParam,
  documentToLinkState,
  parseDocumentTime,
  formatDocumentTime,
} from '../agent/itinerary.ts';
import { parseRouteParam, parseRouteToken, routeTokens } from './url.ts';
import { parseIsoInstant, formatIsoInstant, parseLocalDateTime, parseLocalDate } from '../lib/timezone.ts';
import { isValidLayover } from '../lib/layover.ts';
export interface LinkStop {
  code: string;
  layoverMin: number | null;
  arrival: LocalTimeInput | null;
  departure: LocalTimeInput | null;
}
export interface LinkView {
  time: number | null;
  play: boolean;
  speed: PlaybackSpeed;
  clock: 'local' | 'utc' | string;
  units: DistanceUnit | null;
  dayNight: boolean;
  follow: boolean;
  lang?: Locale;
  names?: boolean;
  borders?: boolean;
  /** One-based flight number. */
  leg?: number;
}
export interface LinkState {
  stops: LinkStop[] | null;
  view: LinkView;
  issues: string[];
}
export function parseLink(search: string, pathname?: string, base = '/globehops/'): LinkState {
  const pathLocale = pathname ? localeFromPath(pathname, base) : null;
  const state: LinkState = {
    stops: null,
    view: { time: null, play: false, speed: 'auto', clock: 'local', units: null, dayNight: true, follow: false },
    issues: [],
  };
  if (search.length > MAX_URL_LENGTH) {
    state.issues.push('This link is too long.');
    return state;
  }
  const params = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(search))
    if (!params.has(key.toLowerCase())) params.set(key.toLowerCase(), value);
  const itinerary = params.get(P.itinerary);
  if (itinerary !== undefined) {
    const result = decodeItineraryParam(itinerary);
    if (result.ok) {
      const parsed = documentToLinkState(result.doc);
      if (pathLocale) parsed.view.lang = pathLocale;
      return parsed;
    }
    state.issues.push(...result.issues.map((i) => `${i.path || 'Itinerary'}: ${i.message}`));
  }
  const tokens = parseRouteParam(search);
  if (tokens !== null) {
    state.stops = tokens.map((token) => ({ ...parseRouteToken(token), arrival: null, departure: null }));
    const rawTokens = (params.get(P.route) ?? '')
      .toUpperCase()
      .split(/[-,>~.\s]+/)
      .filter(Boolean);
    if (rawTokens.length > MAX_STOPS) state.issues.push(`Only the first ${MAX_STOPS} stops are used.`);
    for (const token of rawTokens.slice(0, MAX_STOPS)) {
      const match = /^([A-Z0-9]{2,8})(?:_(\d{1,5}))?$/.exec(token);
      if (!match || (match[2] !== undefined && !isValidLayover(+match[2])))
        state.issues.push(`Invalid route value: ${token}.`);
    }
  }
  const invalid = (key: string) => state.issues.push(`Invalid ${key} value in this link.`);
  for (const [key, value] of params) {
    const field = /^(dep|arr)(\d+)$/.exec(key);
    if (field) {
      const index = +field[2] - 1;
      if (!state.stops || index < 0 || index >= state.stops.length) {
        state.issues.push(`${key} is beyond the route length.`);
        continue;
      }
      const parsed = parseDocumentTime(value);
      if (!parsed || (!parseLocalDateTime(parsed.local) && !parseLocalDate(parsed.local))) {
        invalid(key);
        continue;
      }
      if ((field[1] === P.arrival && index === 0) || (field[1] === P.departure && index === state.stops.length - 1)) {
        state.issues.push(`${key} isn't used at this end of the journey.`);
        continue;
      }
      state.stops[index][field[1] === P.departure ? 'departure' : 'arrival'] = parsed;
    } else if (key === P.time) {
      const time = parseIsoInstant(value.replace(/ (\d{2}:\d{2})$/, '+$1'));
      if (time === null) invalid(key);
      else state.view.time = time;
    } else if (key === P.play) {
      if (value === '1' || value === '0') state.view.play = value === '1';
      else invalid(key);
    } else if (key === P.speed) {
      const speed = value.toLowerCase() === 'auto' ? 'auto' : Number(value);
      if (PLAYBACK_SPEEDS.some((s) => s.value === speed)) state.view.speed = speed as PlaybackSpeed;
      else invalid(key);
    } else if (key === P.clock) {
      const normalized = value.toLowerCase();
      if (normalized === 'local' || normalized === 'utc') state.view.clock = normalized;
      else if (state.stops?.some((s) => s.code === value.toUpperCase())) state.view.clock = value.toUpperCase();
      else invalid(key);
    } else if (key === P.units) {
      if (value.toLowerCase() === 'km' || value.toLowerCase() === 'mi')
        state.view.units = value.toLowerCase() as DistanceUnit;
      else invalid(key);
    } else if (key === P.lang) {
      if (isLocale(value)) state.view.lang = value;
      else invalid(key);
    } else if (key === P.names || key === P.borders) {
      if (value === '0' || value === '1') state.view[key] = value === '1';
      else invalid(key);
    } else if (key === P.leg) {
      if (/^[1-9]$/.test(value) && (!state.stops || +value < state.stops.length)) state.view.leg = +value;
      else invalid(key);
    } else if (key === P.follow) {
      if (value === '0' || value === '1') state.view.follow = value === '1';
      else invalid(key);
    } else if (key === P.dayNight) {
      if (value === '0' || value === '1') state.view.dayNight = value !== '0';
      else invalid(key);
    }
  }
  if (pathLocale) state.view.lang = pathLocale;
  return state;
}
export interface SerializableLinkStop {
  airport: Airport;
  layoverMin: number | null;
  arrival: LocalTimeInput | null;
  departure: LocalTimeInput | null;
}
export type LinkDefaultKey = 'follow' | 'dayNight' | 'clock';

export function serializeLink(
  stops: SerializableLinkStop[],
  view: Partial<LinkView> = {},
  explicitDefaults: boolean | readonly LinkDefaultKey[] = false,
): string {
  const includeDefault = (key: LinkDefaultKey) =>
    explicitDefaults === true || (Array.isArray(explicitDefaults) && explicitDefaults.includes(key));
  const list = stops.slice(0, MAX_STOPS);
  const params: [string, string][] = [];
  const route = routeTokens(list).join('-');
  if (route) params.push([P.route, route]);
  list.forEach((s, i) => {
    if (i > 0 && s.arrival) params.push([`${P.arrival}${i + 1}`, formatDocumentTime(s.arrival)]);
    if (i < list.length - 1 && s.departure) params.push([`${P.departure}${i + 1}`, formatDocumentTime(s.departure)]);
  });
  if (view.time != null) params.push([P.time, formatIsoInstant(view.time)]);
  if (view.play) params.push([P.play, '1']);
  if (view.speed !== undefined && view.speed !== 'auto') params.push([P.speed, String(view.speed)]);
  if (view.clock && (view.clock !== 'local' || includeDefault('clock'))) params.push([P.clock, view.clock]);
  if (view.units) params.push([P.units, view.units]);
  if (view.dayNight === false || (includeDefault('dayNight') && view.dayNight !== undefined))
    params.push([P.dayNight, view.dayNight ? '1' : '0']);
  if (view.follow || (includeDefault('follow') && view.follow !== undefined))
    params.push([P.follow, view.follow ? '1' : '0']);
  if (view.lang) params.push([P.lang, view.lang]);
  if (view.names !== undefined) params.push([P.names, view.names ? '1' : '0']);
  if (view.borders !== undefined) params.push([P.borders, view.borders ? '1' : '0']);
  if (view.leg !== undefined) params.push([P.leg, String(view.leg)]);
  const query = params.length
    ? `?${params.map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%3A/gi, ':')}`).join('&')}`
    : '';
  if (query.length > MAX_URL_LENGTH) throw new RangeError('This journey is too large to share.');
  return query;
}
export function buildLinkUrl(
  base: string,
  stops: SerializableLinkStop[],
  view: Partial<LinkView> = {},
  explicitDefaults: boolean | readonly LinkDefaultKey[] = false,
): string {
  const url = new URL(base);
  url.search = serializeLink(stops, { ...view, lang: undefined }, explicitDefaults);
  if (view.lang) {
    const basePath = url.pathname.replace(/\/(?:en|hu|sv)\/?$/, '/');
    url.pathname = localizedPath(basePath, view.lang);
  }
  const result = url.toString();
  if (result.length > MAX_URL_LENGTH) throw new RangeError('This journey is too large to share.');
  return result;
}
