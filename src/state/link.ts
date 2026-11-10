import { decodeTrack, encodeTrack, fitTracks, type TrackReduction } from '../lib/trackCodec.ts';
import type { CustomTrack } from '../lib/track.ts';
import { isLocale, type Locale } from '../i18n/locales.ts';
import { localizedPath, localeFromPath } from '../i18n/detect.ts';
import type { Airport, DistanceUnit, LocalTimeInput } from '../types.ts';
import type { PlaybackSpeed } from './clock.ts';
import {
  PLAYBACK_SPEEDS,
  MAX_URL_LENGTH,
  MAX_STOPS,
  MAX_JOURNEYS,
  MAX_SECTIONS,
  MAX_TRIP_FLIGHTS,
  JOURNEY_LINK_PREFIXES,
  SECTION_LINK_PREFIXES,
  isNamedClock,
  LINK_PARAMS as P,
} from '../agent/contract.ts';
import { isValidStay, normalizeStay } from '../lib/trip.ts';
import {
  decodeItineraryParam,
  documentToLinkState,
  parseDocumentTime,
  formatDocumentTime,
} from '../agent/itinerary.ts';
import { parseRouteParam, parseRouteToken, routeTokens, splitRouteTokens, ROUTE_TOKEN_PATTERN } from './url.ts';
import { parseIsoInstant, formatIsoInstant, parseLocalDateTime, parseLocalDate } from '../lib/timezone.ts';
import { normalizeJourneyLabel, MAX_LABEL_LENGTH } from '../lib/journeyLabel.ts';
import { isValidLayover } from '../lib/layover.ts';
export interface LinkStop {
  track?: CustomTrack | null;
  code: string;
  layoverMin: number | null;
  arrival: LocalTimeInput | null;
  departure: LocalTimeInput | null;
}
export interface LinkView {
  time: number | null;
  play: boolean;
  /** Follow the wall clock (in real time) instead of a fixed or playing time. */
  live?: boolean;
  speed: PlaybackSpeed;
  clock: 'local' | 'utc' | string;
  units: DistanceUnit | null;
  dayNight: boolean;
  follow: boolean;
  lang?: Locale;
  names?: boolean;
  borders?: boolean;
  /** Visit-only routing overrides: restricted-airspace avoidance and diversion-aware routing. */
  airspace?: boolean;
  diversion?: boolean;
  /** One-based flight number; in a trip, counted across all its journeys. */
  leg?: number;
}
/** A trip journey after the first, with the stay before it (null for the default). */
export interface LinkSection {
  label: string | null;
  stops: LinkStop[];
  stayMin: number | null;
}
export interface LinkJourney {
  label: string | null;
  stops: LinkStop[];
  /** Compared trips: this alternative's journeys after its first (`b.2.*`…`d.6.*`). */
  sections?: LinkSection[];
}
export interface LinkState {
  stops: LinkStop[] | null;
  view: LinkView;
  issues: string[];
  label?: string | null;
  compare?: LinkJourney[];
  /**
   * A trip's journeys after the first (which uses `stops`/`label`). With `compare`, these are alternative
   * A's further journeys, and each compared alternative may have its own `sections`: compared trips.
   */
  sections?: LinkSection[];
}
const BOOLEAN_VIEW_PARAMS = {
  [P.play]: 'play',
  [P.live]: 'live',
  [P.names]: 'names',
  [P.borders]: 'borders',
  [P.follow]: 'follow',
  [P.dayNight]: 'dayNight',
  [P.airspace]: 'airspace',
  [P.diversion]: 'diversion',
} as const satisfies Record<string, keyof LinkView>;
const comparisonLimitMessage = `Only ${MAX_JOURNEYS} journeys can be compared.`;
const tripLimitMessage = `A trip has at most ${MAX_SECTIONS} journeys.`;
// Any later letter is grouped too, so unsupported prefixes (e.–z.) report the journey limit.
const JOURNEY_PARAM_PATTERN = /^([b-z])\.(.+)$/;
// Trip journeys: 2.–6.; any later digit reports the trip limit.
const SECTION_PARAM_PATTERN = /^(\d+)\.(.+)$/;

/** Stays in links: whole days (`5d`), hours (`36h`) or minutes (`90m` or a bare number). */
export function parseStay(value: string): number | null {
  const match = /^(\d{1,6})([mhd])?$/i.exec(value.trim());
  if (!match) return null;
  const minutes = +match[1] * ({ m: 1, h: 60, d: 1440 } as const)[(match[2]?.toLowerCase() ?? 'm') as 'm' | 'h' | 'd'];
  return isValidStay(minutes) ? minutes : null;
}
export function formatStay(minutes: number): string {
  return minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

/** Whether a parsed link names any airport, in its main journey, a compared one or a trip journey. */
export function linkHasStops(link: LinkState): boolean {
  return (
    !!link.stops?.length ||
    !!link.compare?.some(
      (journey) => journey.stops.length > 0 || journey.sections?.some((section) => section.stops.length > 0),
    ) ||
    !!link.sections?.some((section) => section.stops.length > 0)
  );
}
/** Flights a link's `leg` can name: the main journey's, or every trip journey's. */
export function linkFlightCount(link: Pick<LinkState, 'stops' | 'sections'>): number {
  return [link.stops ?? [], ...(link.sections ?? []).map((section) => section.stops)].reduce(
    (sum, stops) => sum + Math.max(0, stops.length - 1),
    0,
  );
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
  const groups = new Map<string, URLSearchParams>();
  for (const [key, value] of params) {
    const match = JOURNEY_PARAM_PATTERN.exec(key);
    if (!match) continue;

    const group = groups.get(match[1]) ?? new URLSearchParams();
    group.set(match[2], value);
    groups.set(match[1], group);
  }
  for (const [prefix, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (!group.has(P.route)) {
      state.issues.push(`Journey ${prefix.toUpperCase()} has parameters but no route.`);
      continue;
    }
    if (
      !JOURNEY_LINK_PREFIXES.some((allowed) => allowed === `${prefix}.`) ||
      (state.compare?.length ?? 0) >= MAX_JOURNEYS - 1
    ) {
      if (!state.issues.includes(comparisonLimitMessage)) state.issues.push(comparisonLimitMessage);
      continue;
    }
    const journeyParams = new URLSearchParams();
    for (const [key, value] of group) {
      if (key === P.route || key === P.label || /^(dep|arr|trk)\d+$/.test(key) || SECTION_PARAM_PATTERN.test(key))
        journeyParams.set(key, value);
      else state.issues.push(`Invalid ${prefix}.${key} parameter in this link.`);
    }
    const parsed = parseLink(`?${journeyParams}`);
    state.issues.push(...parsed.issues.map((message) => `${prefix}. ${message}`));
    (state.compare ??= []).push({
      label: parsed.label ?? null,
      stops: parsed.stops ?? [],
      ...(parsed.sections ? { sections: parsed.sections } : {}),
    });
  }
  const sectionGroups = new Map<string, URLSearchParams>();
  for (const [key, value] of params) {
    const match = SECTION_PARAM_PATTERN.exec(key);
    if (!match) continue;
    const group = sectionGroups.get(match[1]) ?? new URLSearchParams();
    group.set(match[2], value);
    sectionGroups.set(match[1], group);
  }
  for (const [prefix, group] of [...sectionGroups].sort(([a], [b]) => +a - +b)) {
    if (!group.has(P.route)) {
      state.issues.push(`Journey ${prefix} has parameters but no route.`);
      continue;
    }
    if (!SECTION_LINK_PREFIXES.includes(`${prefix}.`)) {
      if (!state.issues.includes(tripLimitMessage)) state.issues.push(tripLimitMessage);
      continue;
    }
    const journeyParams = new URLSearchParams();
    let stayMin: number | null = null;
    for (const [key, value] of group) {
      if (key === P.stay) {
        stayMin = parseStay(value);
        if (stayMin === null) state.issues.push(`Invalid ${prefix}.${key} value in this link.`);
      } else if (key === P.route || key === P.label || /^(dep|arr|trk)\d+$/.test(key)) journeyParams.set(key, value);
      else state.issues.push(`Invalid ${prefix}.${key} parameter in this link.`);
    }
    const parsed = parseLink(`?${journeyParams}`);
    state.issues.push(...parsed.issues.map((message) => `${prefix}. ${message}`));
    (state.sections ??= []).push({
      label: parsed.label ?? null,
      stops: parsed.stops ?? [],
      stayMin: normalizeStay(stayMin),
    });
  }
  const tokens = parseRouteParam(search);
  if (tokens !== null) {
    state.stops = tokens.map((token) => ({ ...parseRouteToken(token), arrival: null, departure: null }));
    const rawTokens = splitRouteTokens(params.get(P.route) ?? '');
    if (rawTokens.length > MAX_STOPS) state.issues.push(`Only the first ${MAX_STOPS} stops are used.`);
    for (const token of rawTokens.slice(0, MAX_STOPS)) {
      const match = ROUTE_TOKEN_PATTERN.exec(token);
      if (!match || (match[2] !== undefined && !isValidLayover(+match[2])))
        state.issues.push(`Invalid route value: ${token}.`);
    }
  }
  const invalid = (key: string) => state.issues.push(`Invalid ${key} value in this link.`);
  for (const [key, value] of params) {
    if (Object.hasOwn(BOOLEAN_VIEW_PARAMS, key)) {
      const field = BOOLEAN_VIEW_PARAMS[key as keyof typeof BOOLEAN_VIEW_PARAMS];
      if (value === '0' || value === '1') state.view[field] = value === '1';
      else invalid(key);
      continue;
    }
    const trackField = /^trk(\d+)$/.exec(key);
    if (trackField) {
      const index = +trackField[1] - 1;
      const track = decodeTrack(value);
      if (!track || !state.stops || index < 0 || index >= state.stops.length - 1) invalid(key);
      else state.stops[index].track = track;
      continue;
    }
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
    } else if (key === P.label) {
      const label = normalizeJourneyLabel(value);
      if (label === null) invalid(key);
      else state.label = label;
    } else if (key === P.time) {
      const time = parseIsoInstant(value.replace(/ (\d{2}:\d{2})$/, '+$1'));
      if (time === null) invalid(key);
      else state.view.time = time;
    } else if (key === P.speed) {
      const speed = value.toLowerCase() === 'auto' ? 'auto' : Number(value);
      if (PLAYBACK_SPEEDS.some((s) => s.value === speed)) state.view.speed = speed as PlaybackSpeed;
      else invalid(key);
    } else if (key === P.clock) {
      const normalized = value.toLowerCase();
      if (isNamedClock(normalized)) state.view.clock = normalized;
      else if (
        [
          ...(state.stops ?? []),
          ...(state.sections ?? []).flatMap((section) => section.stops),
          ...(state.compare ?? []).flatMap((journey) => [
            ...journey.stops,
            ...(journey.sections ?? []).flatMap((section) => section.stops),
          ]),
        ].some((s) => s.code === value.toUpperCase())
      )
        state.view.clock = value.toUpperCase();
      else invalid(key);
    } else if (key === P.units) {
      if (value.toLowerCase() === 'km' || value.toLowerCase() === 'mi')
        state.view.units = value.toLowerCase() as DistanceUnit;
      else invalid(key);
    } else if (key === P.lang) {
      if (isLocale(value)) state.view.lang = value;
      else invalid(key);
    } else if (key === P.leg) {
      const flights = linkFlightCount(state);
      if (/^[1-9]\d?$/.test(value) && +value <= MAX_TRIP_FLIGHTS && (!state.stops || +value <= flights))
        state.view.leg = +value;
      else invalid(key);
    }
  }
  if (pathLocale) state.view.lang = pathLocale;
  return state;
}
export interface SerializableLinkStop {
  track?: CustomTrack | null;
  airport: Airport;
  layoverMin: number | null;
  arrival: LocalTimeInput | null;
  departure: LocalTimeInput | null;
}
export interface SerializableJourney {
  label: string | null;
  stops: SerializableLinkStop[];
  /** Compared trips: this alternative's journeys after its first. */
  sections?: SerializableSection[];
}
export type LinkDefaultKey = 'follow' | 'dayNight' | 'clock';

export interface SerializableSection {
  label: string | null;
  stops: SerializableLinkStop[];
  stayMin: number | null;
}
export interface LinkExtra {
  label?: string | null;
  compare?: SerializableJourney[];
  /** A trip's journeys after the first; with `compare`, alternative A's (compared trips). */
  sections?: SerializableSection[];
}

function serializeLinkRaw(
  stops: SerializableLinkStop[],
  view: Partial<LinkView> = {},
  explicitDefaults: boolean | readonly LinkDefaultKey[] = false,
  extra?: LinkExtra,
): string {
  const includeDefault = (key: LinkDefaultKey) =>
    explicitDefaults === true || (Array.isArray(explicitDefaults) && explicitDefaults.includes(key));
  const params: [string, string][] = [];
  const appendJourney = (stops: SerializableLinkStop[], label: string | null | undefined, prefix: string) => {
    const list = stops.slice(0, MAX_STOPS);
    const route = routeTokens(list).join('-');
    if (route || prefix || extra?.compare?.length || extra?.sections?.length)
      params.push([`${prefix}${P.route}`, route]);
    list.forEach((s, i) => {
      if (i < list.length - 1 && s.track) params.push([`${prefix}${P.track}${i + 1}`, encodeTrack(s.track)]);
      if (i > 0 && s.arrival) params.push([`${prefix}${P.arrival}${i + 1}`, formatDocumentTime(s.arrival)]);
      if (i < list.length - 1 && s.departure)
        params.push([`${prefix}${P.departure}${i + 1}`, formatDocumentTime(s.departure)]);
    });
    if (label != null) {
      const trimmed = normalizeJourneyLabel(label);
      if (trimmed === null)
        throw new TypeError(`Use a label of 1–${MAX_LABEL_LENGTH} characters without control characters.`);
      params.push([`${prefix}${P.label}`, trimmed]);
    }
  };
  if ((extra?.compare?.length ?? 0) >= MAX_JOURNEYS) throw new RangeError(comparisonLimitMessage);
  if ((extra?.sections?.length ?? 0) >= MAX_SECTIONS) throw new RangeError(tripLimitMessage);
  const appendSections = (sections: SerializableSection[] | undefined, parent: string) => {
    if ((sections?.length ?? 0) >= MAX_SECTIONS) throw new RangeError(tripLimitMessage);
    sections?.forEach((section, index) => {
      const prefix = `${parent}${SECTION_LINK_PREFIXES[index]}`;
      appendJourney(section.stops, section.label, prefix);
      const stay = normalizeStay(section.stayMin);
      if (stay !== null) params.push([`${prefix}${P.stay}`, formatStay(stay)]);
    });
  };
  appendJourney(stops, extra?.label, '');
  appendSections(extra?.sections, '');
  extra?.compare?.forEach((journey, index) => {
    const prefix = JOURNEY_LINK_PREFIXES[index];
    appendJourney(journey.stops, journey.label, prefix);
    appendSections(journey.sections, prefix);
  });
  if (view.time != null) params.push([P.time, formatIsoInstant(view.time)]);
  if (view.play) params.push([P.play, '1']);
  if (view.live) params.push([P.live, '1']);
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
  if (view.airspace !== undefined) params.push([P.airspace, view.airspace ? '1' : '0']);
  if (view.diversion !== undefined) params.push([P.diversion, view.diversion ? '1' : '0']);
  if (view.leg !== undefined) params.push([P.leg, String(view.leg)]);
  const query = params.length
    ? `?${params.map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%3A/gi, ':')}`).join('&')}`
    : '';
  return query;
}
/** Fit only the share copy; session geometry remains exact. Budget counts the query, including `?`. */
export function serializeLinkWithReduction(
  stops: SerializableLinkStop[],
  view: Partial<LinkView> = {},
  explicitDefaults: boolean | readonly LinkDefaultKey[] = false,
  extra?: LinkExtra,
  budgetChars = MAX_URL_LENGTH - 300,
): { query: string; shareReduction: TrackReduction | null } {
  const groups = [
    stops,
    ...(extra?.sections ?? []).map((s) => s.stops),
    ...(extra?.compare ?? []).flatMap((j) => [j.stops, ...(j.sections ?? []).map((s) => s.stops)]),
  ];
  const eligible = groups.flatMap((g) => g.slice(0, MAX_STOPS - 1).slice(0, Math.max(0, g.length - 1)));
  const tracks = eligible.map((s) => s.track ?? null);
  const without = (g: SerializableLinkStop[]) => g.map((s) => ({ ...s, track: null }));
  const mapExtra = (map: (g: SerializableLinkStop[]) => SerializableLinkStop[]): LinkExtra | undefined =>
    extra
      ? {
          ...extra,
          sections: extra.sections?.map((s) => ({ ...s, stops: map(s.stops) })),
          compare: extra.compare?.map((j) => ({
            ...j,
            stops: map(j.stops),
            sections: j.sections?.map((s) => ({ ...s, stops: map(s.stops) })),
          })),
        }
      : undefined;
  const base = serializeLinkRaw(without(stops), view, explicitDefaults, mapExtra(without));
  if (base.length > MAX_URL_LENGTH) throw new RangeError('This journey is too large to share.');
  const overhead = tracks.reduce((sum, t, i) => sum + (t ? 12 + String(i + 1).length : 0), 0);
  const fit = fitTracks(tracks, Math.max(0, Math.min(MAX_URL_LENGTH, budgetChars) - base.length - overhead));
  let cursor = 0;
  const replace = (g: SerializableLinkStop[]) =>
    g.map((s, i) => ({ ...s, track: i < Math.min(g.length - 1, MAX_STOPS - 1) ? fit.tracks[cursor++] : null }));
  return {
    query: serializeLinkRaw(replace(stops), view, explicitDefaults, mapExtra(replace)),
    shareReduction: fit.reduced,
  };
}
export function serializeLink(
  stops: SerializableLinkStop[],
  view: Partial<LinkView> = {},
  explicitDefaults: boolean | readonly LinkDefaultKey[] = false,
  extra?: LinkExtra,
): string {
  return serializeLinkWithReduction(stops, view, explicitDefaults, extra).query;
}

/** Exact local state for document/tool calculations, without a URL size/precision round trip. */
export function serializableLinkState(
  stops: SerializableLinkStop[],
  view: Partial<LinkView> = {},
  extra?: LinkExtra,
): LinkState {
  const map = (list: SerializableLinkStop[]): LinkStop[] =>
    list.map((s) => ({
      code: s.airport.iata ?? s.airport.icao ?? s.airport.ident,
      layoverMin: s.layoverMin,
      arrival: s.arrival,
      departure: s.departure,
      ...(s.track ? { track: s.track } : {}),
    }));
  return {
    stops: map(stops),
    view: {
      time: null,
      play: false,
      speed: 'auto',
      clock: 'local',
      units: null,
      dayNight: true,
      follow: false,
      ...view,
    },
    issues: [],
    label: extra?.label,
    sections: extra?.sections?.map((s) => ({ ...s, stops: map(s.stops) })),
    compare: extra?.compare?.map((j) => ({
      ...j,
      stops: map(j.stops),
      sections: j.sections?.map((s) => ({ ...s, stops: map(s.stops) })),
    })),
  };
}
export function buildLinkUrl(
  base: string,
  stops: SerializableLinkStop[],
  view: Partial<LinkView> = {},
  explicitDefaults: boolean | readonly LinkDefaultKey[] = false,
  extra?: LinkExtra,
): string {
  const url = new URL(base);
  url.search = serializeLinkWithReduction(
    stops,
    { ...view, lang: undefined },
    explicitDefaults,
    extra,
    MAX_URL_LENGTH - base.length - 300,
  ).query;
  if (view.lang) {
    const basePath = url.pathname.replace(/\/(?:en|hu|sv)\/?$/, '/');
    url.pathname = localizedPath(basePath, view.lang);
  }
  const result = url.toString();
  if (result.length > MAX_URL_LENGTH) throw new RangeError('This journey is too large to share.');
  return result;
}

/** Serialize code-only state (e.g. validated WebMCP documents) without resolving an airport dataset. */
export function serializeLinkState(state: LinkState): string {
  const map = (stops: LinkStop[]): SerializableLinkStop[] =>
    stops.map(({ code, ...s }) => ({
      ...s,
      airport: {
        id: /^\d+$/.test(code) ? Number(code) : 0,
        ident: code,
        iata: /^[A-Za-z]{3}$/.test(code) ? code : null,
        icao: null,
        name: '',
        city: '',
        region: '',
        country: '',
        countryCode: '',
        lat: 0,
        lng: 0,
        type: 'large',
        scheduled: false,
        keywords: [],
      },
    }));
  return serializeLink(map(state.stops ?? []), state.view, false, {
    label: state.label,
    sections: state.sections?.map((s) => ({ ...s, stops: map(s.stops) })),
    compare: state.compare?.map((j) => ({
      ...j,
      stops: map(j.stops),
      sections: j.sections?.map((s) => ({ ...s, stops: map(s.stops) })),
    })),
  });
}
