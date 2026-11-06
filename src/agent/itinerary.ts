import { isLocale, type Locale } from '../i18n/locales.ts';
import type { LinkState, LinkStop, LinkView } from '../state/link.ts';
import type { LocalTimeInput } from '../types.ts';
import {
  MAX_STOPS,
  MAX_JOURNEYS,
  MAX_LAYOVER_MIN,
  MAX_ITINERARY_PARAM_LENGTH,
  PLAYBACK_SPEEDS,
  isNamedClock,
} from './contract.ts';
import { normalizeJourneyLabel, MAX_LABEL_LENGTH } from '../lib/journeyLabel.ts';
import { formatIsoInstant, formatIsoOffset, parseIsoInstant } from '../lib/timezone.ts';

const ITINERARY_VERSION = 1;
export interface StopDoc {
  airport: string;
  arrival?: string;
  departure?: string;
  layoverMinutes?: number;
}
export interface JourneyDoc {
  label?: string;
  stops: StopDoc[];
}
interface DocumentBase {
  $schema?: string;
  version: 1;
  view?: {
    time?: string;
    play?: boolean;
    speed?: 'auto' | 1800 | 3600 | 7200;
    clock?: string;
    units?: 'km' | 'mi';
    dayNight?: boolean;
    follow?: boolean;
    lang?: Locale;
    names?: boolean;
    borders?: boolean;
    leg?: number;
  };
}
export type ItineraryDocument = DocumentBase &
  ({ stops: StopDoc[]; journeys?: never } | { stops?: never; journeys: JourneyDoc[] });
export type View = NonNullable<ItineraryDocument['view']>;
export const LABEL_PATTERN =
  '^[^\\u0000-\\u001f\\u007f-\\u009f]*[^\\s\\u0000-\\u001f\\u007f-\\u009f][^\\u0000-\\u001f\\u007f-\\u009f]*$';
export interface DocIssue {
  path: string;
  code: string;
  message: string;
}
export type DocumentResult = { ok: true; doc: ItineraryDocument } | { ok: false; issues: DocIssue[] };
/** Structural patterns shared with schema publishers; chronology and zone rules belong to computeJourney. */
export const AIRPORT_PATTERN = '^(?:[A-Za-z]{3}|[A-Za-z0-9]{4,8}|[0-9]+)$';
export const LOCAL_TIME_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::00)?(?:Z|[+-]\\d{2}:\\d{2})?$';
export const INSTANT_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:\\d{2})$';
const object = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);
export function validateItineraryDocument(raw: unknown): DocumentResult {
  const issues: DocIssue[] = [];
  const issue = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const properties = (value: Record<string, unknown>, allowed: string[], path: string) => {
    for (const key of Object.keys(value))
      if (!allowed.includes(key))
        issue(
          `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
          'additionalProperties',
          `Unknown property ${key}.`,
        );
  };
  if (!object(raw))
    return { ok: false, issues: [{ path: '', code: 'type', message: 'An itinerary must be an object.' }] };
  properties(raw, ['$schema', 'version', 'stops', 'journeys', 'view'], '');
  if (raw.$schema !== undefined && typeof raw.$schema !== 'string')
    issue('/$schema', 'type', '$schema must be a string.');
  if (raw.version !== 1) issue('/version', 'const', 'Use itinerary version 1.');
  const validateStops = (stops: unknown, basePath: string) => {
    if (!Array.isArray(stops)) issue(basePath, 'type', 'Stops must be an array.');
    else {
      if (stops.length < 1 || stops.length > MAX_STOPS) issue(basePath, 'items', `Use 1 to ${MAX_STOPS} stops.`);
      // Bound the work even for untrusted documents with enormous arrays.
      stops.slice(0, MAX_STOPS).forEach((stop: unknown, i: number) => {
        const path = `${basePath}/${i}`;
        if (!object(stop)) {
          issue(path, 'type', 'Each stop must be an object.');
          return;
        }
        properties(stop, ['airport', 'arrival', 'departure', 'layoverMinutes'], path);
        if (typeof stop.airport !== 'string' || !new RegExp(AIRPORT_PATTERN).test(stop.airport))
          issue(`${path}/airport`, 'pattern', 'Use an IATA, ICAO/ident code or numeric airport id.');
        for (const field of ['arrival', 'departure'])
          if (
            stop[field] !== undefined &&
            (typeof stop[field] !== 'string' || !new RegExp(LOCAL_TIME_PATTERN).test(stop[field]))
          )
            issue(`${path}/${field}`, 'pattern', 'Use a local time YYYY-MM-DDTHH:MM with an optional UTC offset.');
        if (stop.layoverMinutes !== undefined) {
          if (
            typeof stop.layoverMinutes !== 'number' ||
            !Number.isInteger(stop.layoverMinutes) ||
            stop.layoverMinutes < 0 ||
            stop.layoverMinutes > MAX_LAYOVER_MIN
          )
            issue(
              `${path}/layoverMinutes`,
              'range',
              `Layover minutes must be an integer from 0 to ${MAX_LAYOVER_MIN}.`,
            );
          if (i === 0 || i === stops.length - 1)
            issue(`${path}/layoverMinutes`, 'position', 'Layover minutes apply only to transfer stops.');
        }
      });
    }
  };
  if ((raw.stops !== undefined) === (raw.journeys !== undefined))
    issue('', 'oneOf', 'Supply exactly one of stops or journeys.');
  if (raw.stops !== undefined) validateStops(raw.stops, '/stops');
  if (raw.journeys !== undefined) {
    if (!Array.isArray(raw.journeys)) issue('/journeys', 'type', 'Journeys must be an array.');
    else {
      if (raw.journeys.length < 1 || raw.journeys.length > MAX_JOURNEYS)
        issue('/journeys', 'items', `Use 1 to ${MAX_JOURNEYS} journeys.`);
      raw.journeys.slice(0, MAX_JOURNEYS).forEach((journey: unknown, index: number) => {
        const path = `/journeys/${index}`;
        if (!object(journey)) {
          issue(path, 'type', 'Each journey must be an object.');
          return;
        }
        properties(journey, ['label', 'stops'], path);
        if (
          journey.label !== undefined &&
          (typeof journey.label !== 'string' ||
            normalizeJourneyLabel(journey.label) === null ||
            // JSON Schema counts the untrimmed string; readable links allow padding.
            Array.from(journey.label).length > MAX_LABEL_LENGTH)
        )
          issue(
            `${path}/label`,
            'pattern',
            `Use a label of 1–${MAX_LABEL_LENGTH} characters without control characters.`,
          );
        validateStops(journey.stops, `${path}/stops`);
      });
    }
  }
  if (raw.view !== undefined) {
    if (!object(raw.view)) issue('/view', 'type', 'View must be an object.');
    else {
      const view = raw.view;
      properties(
        view,
        ['time', 'play', 'speed', 'clock', 'units', 'dayNight', 'follow', 'lang', 'names', 'borders', 'leg'],
        '/view',
      );
      if (view.time !== undefined && (typeof view.time !== 'string' || !new RegExp(INSTANT_PATTERN).test(view.time)))
        issue('/view/time', 'pattern', 'Use an ISO instant with Z or an explicit UTC offset.');
      for (const key of ['play', 'dayNight', 'follow', 'names', 'borders'])
        if (view[key] !== undefined && typeof view[key] !== 'boolean')
          issue(`/view/${key}`, 'type', `${key} must be a boolean.`);
      if (view.lang !== undefined && !isLocale(view.lang)) issue('/view/lang', 'enum', 'Use en, hu or sv.');
      if (
        view.leg !== undefined &&
        (typeof view.leg !== 'number' || !Number.isInteger(view.leg) || view.leg < 1 || view.leg >= MAX_STOPS)
      )
        issue('/view/leg', 'range', 'Use a one-based flight number within this route.');
      if (view.speed !== undefined && !PLAYBACK_SPEEDS.some((s) => s.value === view.speed))
        issue('/view/speed', 'enum', 'Use auto, 1800, 3600 or 7200.');
      if (
        view.clock !== undefined &&
        (typeof view.clock !== 'string' || !/^(?:local|utc|[A-Za-z0-9]{2,8}|[0-9]+)$/.test(view.clock))
      )
        issue('/view/clock', 'pattern', 'Use local, utc or an airport code.');
      if (view.units !== undefined && view.units !== 'km' && view.units !== 'mi')
        issue('/view/units', 'enum', 'Use km or mi.');
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, doc: raw as unknown as ItineraryDocument };
}
export function encodeItineraryParam(doc: ItineraryDocument): string {
  const valid = validateItineraryDocument(doc);
  if (!valid.ok) throw new TypeError(valid.issues.map((i) => `${i.path}: ${i.message}`).join(' '));
  const json = JSON.stringify(doc);
  if (json.length > MAX_ITINERARY_PARAM_LENGTH) throw new RangeError('Itinerary is too large to share.');
  const bytes = new TextEncoder().encode(json);
  const encoded = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (encoded.length > MAX_ITINERARY_PARAM_LENGTH) throw new RangeError('Itinerary is too large to share.');
  return encoded;
}
export function decodeItineraryParam(param: string): DocumentResult {
  if (param.length > MAX_ITINERARY_PARAM_LENGTH)
    return { ok: false, issues: [{ path: '', code: 'too_large', message: 'Itinerary is too large to share.' }] };
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(param) || param.length % 4 === 1) throw new Error('Invalid base64url');
    const binary = atob(param.replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    return validateItineraryDocument(JSON.parse(json));
  } catch {
    return {
      ok: false,
      issues: [{ path: '', code: 'invalid_encoding', message: 'The itinerary is not valid base64url UTF-8 JSON.' }],
    };
  }
}
/** Parse syntax only; an airport's valid offsets are checked when computing its schedule. */
export function parseDocumentTime(value: string): LocalTimeInput | null {
  const normalized = value.replace(/ (\d{2}:\d{2})$/, '+$1');
  const match = /^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::00)?)?)(Z|[+-]\d{2}:\d{2})?$/.exec(normalized);
  if (!match || (match[1].length === 10 && match[2])) return null;
  let offsetMin: number | null = null;
  if (match[2]) {
    if (match[2] === 'Z') offsetMin = 0;
    else {
      const hours = +match[2].slice(1, 3),
        minutes = +match[2].slice(4);
      if (hours > 23 || minutes > 59) return null;
      offsetMin = (hours * 60 + minutes) * (match[2][0] === '-' ? -1 : 1);
    }
  }
  return { local: match[1].length === 19 ? match[1].slice(0, 16) : match[1], offsetMin };
}
export function formatDocumentTime(value: LocalTimeInput): string {
  return value.local + (value.offsetMin === null ? '' : formatIsoOffset(value.offsetMin));
}
export function documentToLinkState(doc: ItineraryDocument): LinkState {
  const issues: string[] = [];
  const mapStops = (stops: StopDoc[]): LinkStop[] =>
    stops.map((s, i) => {
      const arrival = s.arrival ? parseDocumentTime(s.arrival) : null;
      const departure = s.departure ? parseDocumentTime(s.departure) : null;
      if (s.arrival && !arrival) issues.push(`Stop ${i + 1}: invalid arrival time.`);
      if (s.departure && !departure) issues.push(`Stop ${i + 1}: invalid departure time.`);
      return { code: s.airport.toUpperCase(), layoverMin: s.layoverMinutes ?? null, arrival, departure };
    });
  const primary = doc.journeys?.[0];
  const stops = mapStops(primary?.stops ?? doc.stops ?? []);
  const compare = doc.journeys
    ?.slice(1)
    .map((journey) => ({ label: journey.label?.trim() ?? null, stops: mapStops(journey.stops) }));
  const source = doc.view;
  const time = source?.time ? parseIsoInstant(source.time) : null;
  if (source?.time && time === null) issues.push('The itinerary view time is invalid.');
  const clock = source?.clock ?? 'local';
  const view: LinkView = {
    time,
    play: source?.play ?? false,
    speed: source?.speed ?? 'auto',
    clock: isNamedClock(clock.toLowerCase()) ? clock.toLowerCase() : clock.toUpperCase(),
    units: source?.units ?? null,
    dayNight: source?.dayNight ?? true,
    follow: source?.follow ?? false,
    ...(source?.lang !== undefined ? { lang: source.lang } : {}),
    ...(source?.names !== undefined ? { names: source.names } : {}),
    ...(source?.borders !== undefined ? { borders: source.borders } : {}),
    ...(source?.leg !== undefined ? { leg: source.leg } : {}),
  };
  return {
    stops,
    view,
    issues,
    ...(primary?.label !== undefined ? { label: primary.label.trim() } : {}),
    ...(compare?.length ? { compare } : {}),
  };
}
export function linkStateToDocument(s: LinkState): ItineraryDocument {
  const mapStops = (stops: LinkStop[]): StopDoc[] =>
    stops.map((stop, i, all) => ({
      airport: stop.code,
      ...(i > 0 && stop.arrival ? { arrival: formatDocumentTime(stop.arrival) } : {}),
      ...(i < all.length - 1 && stop.departure ? { departure: formatDocumentTime(stop.departure) } : {}),
      ...(i > 0 && i < all.length - 1 && stop.layoverMin !== null ? { layoverMinutes: stop.layoverMin } : {}),
    }));
  const stops = mapStops(s.stops ?? []);
  return {
    version: ITINERARY_VERSION,
    ...(s.compare?.length
      ? {
          journeys: [
            { ...(s.label ? { label: s.label } : {}), stops },
            ...s.compare.map((journey) => ({
              ...(journey.label ? { label: journey.label } : {}),
              stops: mapStops(journey.stops),
            })),
          ],
        }
      : { stops }),
    view: {
      ...(s.view.time !== null ? { time: formatIsoInstant(s.view.time) } : {}),
      play: s.view.play,
      speed: s.view.speed,
      clock: s.view.clock,
      ...(s.view.units !== null ? { units: s.view.units } : {}),
      dayNight: s.view.dayNight,
      ...(s.view.follow ? { follow: true } : {}),
      ...(s.view.lang !== undefined ? { lang: s.view.lang } : {}),
      ...(s.view.names !== undefined ? { names: s.view.names } : {}),
      ...(s.view.borders !== undefined ? { borders: s.view.borders } : {}),
      ...(s.view.leg !== undefined ? { leg: s.view.leg } : {}),
    },
  };
}
