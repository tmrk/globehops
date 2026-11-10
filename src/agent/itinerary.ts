import { isLocale, type Locale } from '../i18n/locales.ts';
import type { LinkSection, LinkState, LinkStop, LinkView } from '../state/link.ts';
import type { LocalTimeInput } from '../types.ts';
import {
  MAX_STOPS,
  MAX_JOURNEYS,
  MAX_SECTIONS,
  MAX_STAY_MIN,
  MAX_TRIP_FLIGHTS,
  MAX_LAYOVER_MIN,
  MAX_ITINERARY_PARAM_LENGTH,
  PLAYBACK_SPEEDS,
  isNamedClock,
} from './contract.ts';
import { normalizeStay } from '../lib/trip.ts';
import { normalizeJourneyLabel, MAX_LABEL_LENGTH } from '../lib/journeyLabel.ts';
import { formatIsoInstant, formatIsoOffset, parseIsoInstant } from '../lib/timezone.ts';

const ITINERARY_VERSION = 1;
export interface StopDoc {
  airport: string;
  arrival?: string;
  departure?: string;
  layoverMinutes?: number;
}
export interface StopsJourneyDoc {
  label?: string;
  stops: StopDoc[];
}
/** A trip journey; `stayMinutes` (after the first) is the stay before it, used until its times fix the stay. */
export interface SectionDoc extends StopsJourneyDoc {
  stayMinutes?: number;
}
export type JourneyDoc =
  (StopsJourneyDoc & { sections?: never }) | { label?: string; sections: SectionDoc[]; stops?: never };
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
    airspace?: boolean;
    diversion?: boolean;
    leg?: number;
  };
}
export type ItineraryDocument = DocumentBase &
  (
    | { stops: StopDoc[]; journeys?: never; sections?: never }
    | { stops?: never; journeys: JourneyDoc[]; sections?: never }
    | { stops?: never; journeys?: never; sections: SectionDoc[] }
  );
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
  properties(raw, ['$schema', 'version', 'stops', 'journeys', 'sections', 'view'], '');
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
  if ([raw.stops, raw.journeys, raw.sections].filter((value) => value !== undefined).length !== 1)
    issue('', 'oneOf', 'Supply exactly one of stops, journeys or sections.');
  if (raw.stops !== undefined) validateStops(raw.stops, '/stops');
  const validateLabel = (label: unknown, path: string) => {
    if (
      label !== undefined &&
      (typeof label !== 'string' ||
        normalizeJourneyLabel(label) === null ||
        // JSON Schema counts the untrimmed string; readable links allow padding.
        Array.from(label).length > MAX_LABEL_LENGTH)
    )
      issue(`${path}/label`, 'pattern', `Use a label of 1–${MAX_LABEL_LENGTH} characters without control characters.`);
  };
  const validateSections = (sections: unknown, basePath: string) => {
    if (!Array.isArray(sections)) issue(basePath, 'type', 'Sections must be an array.');
    else {
      if (sections.length < 1 || sections.length > MAX_SECTIONS)
        issue(basePath, 'items', `Use 1 to ${MAX_SECTIONS} trip sections.`);
      sections.slice(0, MAX_SECTIONS).forEach((section: unknown, index: number) => {
        const path = `${basePath}/${index}`;
        if (!object(section)) {
          issue(path, 'type', 'Each section must be an object.');
          return;
        }
        properties(section, ['label', 'stayMinutes', 'stops'], path);
        validateLabel(section.label, path);
        if (section.stayMinutes !== undefined) {
          if (
            typeof section.stayMinutes !== 'number' ||
            !Number.isInteger(section.stayMinutes) ||
            section.stayMinutes < 0 ||
            section.stayMinutes > MAX_STAY_MIN
          )
            issue(`${path}/stayMinutes`, 'range', `Stay minutes must be an integer from 0 to ${MAX_STAY_MIN}.`);
          if (index === 0)
            issue(`${path}/stayMinutes`, 'position', 'A stay comes before a later section, not the first.');
        }
        validateStops(section.stops, `${path}/stops`);
      });
    }
  };
  if (raw.sections !== undefined) validateSections(raw.sections, '/sections');
  if (raw.journeys !== undefined) {
    if (!Array.isArray(raw.journeys)) issue('/journeys', 'type', 'Journeys must be an array.');
    else {
      if (raw.journeys.length < 1 || raw.journeys.length > MAX_JOURNEYS)
        issue('/journeys', 'items', `Use 1 to ${MAX_JOURNEYS} journeys.`);
      const first: unknown = raw.journeys[0];
      raw.journeys.slice(0, MAX_JOURNEYS).forEach((journey: unknown, index: number) => {
        const path = `/journeys/${index}`;
        if (!object(journey)) {
          issue(path, 'type', 'Each journey must be an object.');
          return;
        }
        properties(journey, ['label', 'stops', 'sections'], path);
        validateLabel(journey.label, path);
        if ((journey.stops !== undefined) === (journey.sections !== undefined))
          issue(path, 'oneOf', 'Supply exactly one of stops or sections.');
        if (journey.stops !== undefined) validateStops(journey.stops, `${path}/stops`);
        if (journey.sections !== undefined) validateSections(journey.sections, `${path}/sections`);
        if (
          object(first) &&
          ((journey.sections !== undefined) !== (first.sections !== undefined) ||
            (Array.isArray(journey.sections) &&
              Array.isArray(first.sections) &&
              journey.sections.length !== first.sections.length))
        )
          issue(
            `${path}/sections`,
            'sections_mismatch',
            'Compared trips need the same number of sections in every journey.',
          );
      });
    }
  }
  if (raw.view !== undefined) {
    if (!object(raw.view)) issue('/view', 'type', 'View must be an object.');
    else {
      const view = raw.view;
      properties(
        view,
        [
          'time',
          'play',
          'speed',
          'clock',
          'units',
          'dayNight',
          'follow',
          'lang',
          'names',
          'borders',
          'airspace',
          'diversion',
          'leg',
        ],
        '/view',
      );
      if (view.time !== undefined && (typeof view.time !== 'string' || !new RegExp(INSTANT_PATTERN).test(view.time)))
        issue('/view/time', 'pattern', 'Use an ISO instant with Z or an explicit UTC offset.');
      for (const key of ['play', 'dayNight', 'follow', 'names', 'borders', 'airspace', 'diversion'])
        if (view[key] !== undefined && typeof view[key] !== 'boolean')
          issue(`/view/${key}`, 'type', `${key} must be a boolean.`);
      if (view.lang !== undefined && !isLocale(view.lang)) issue('/view/lang', 'enum', 'Use en, hu or sv.');
      if (
        view.leg !== undefined &&
        (typeof view.leg !== 'number' || !Number.isInteger(view.leg) || view.leg < 1 || view.leg > MAX_TRIP_FLIGHTS)
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
  const mapSections = (sections: SectionDoc[] | undefined): LinkSection[] | undefined =>
    sections?.slice(1).map((section) => ({
      label: section.label?.trim() ?? null,
      stops: mapStops(section.stops),
      stayMin: normalizeStay(section.stayMinutes),
    }));
  const primaryJourney = doc.journeys?.[0];
  const primary = primaryJourney?.sections?.[0] ?? primaryJourney ?? doc.sections?.[0];
  const label = primaryJourney?.label ?? primary?.label;
  const stops = mapStops(primary?.stops ?? doc.stops ?? []);
  const compare = doc.journeys?.slice(1).map((journey) => ({
    label: (journey.label ?? journey.sections?.[0]?.label)?.trim() ?? null,
    stops: mapStops(journey.sections?.[0]?.stops ?? journey.stops ?? []),
    ...(journey.sections && journey.sections.length > 1 ? { sections: mapSections(journey.sections) } : {}),
  }));
  const sections = mapSections(primaryJourney?.sections ?? doc.sections);
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
    ...(source?.airspace !== undefined ? { airspace: source.airspace } : {}),
    ...(source?.diversion !== undefined ? { diversion: source.diversion } : {}),
    ...(source?.leg !== undefined ? { leg: source.leg } : {}),
  };
  return {
    stops,
    view,
    issues,
    ...(label !== undefined ? { label: label.trim() } : {}),
    ...(compare?.length ? { compare } : {}),
    ...(sections?.length ? { sections } : {}),
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
  const mapSection = (section: LinkSection): SectionDoc => ({
    ...(section.label ? { label: section.label } : {}),
    ...(section.stayMin !== null ? { stayMinutes: section.stayMin } : {}),
    stops: mapStops(section.stops),
  });
  const alternatives = [{ label: s.label, stops: s.stops ?? [], sections: s.sections }, ...(s.compare ?? [])];
  const sectionCount = Math.max(...alternatives.map((journey) => 1 + (journey.sections?.length ?? 0)));
  const body: Pick<ItineraryDocument, 'stops' | 'journeys' | 'sections'> = s.compare?.length
    ? {
        journeys: alternatives.map((journey) => ({
          ...(journey.label ? { label: journey.label } : {}),
          ...(sectionCount > 1
            ? {
                sections: Array.from({ length: sectionCount }, (_, i) =>
                  i === 0
                    ? { stops: mapStops(journey.stops) }
                    : journey.sections?.[i - 1]
                      ? mapSection(journey.sections[i - 1])
                      : { stops: [] },
                ),
              }
            : { stops: mapStops(journey.stops) }),
        })),
      }
    : s.sections?.length
      ? { sections: [{ ...(s.label ? { label: s.label } : {}), stops }, ...s.sections.map(mapSection)] }
      : { stops };
  return {
    version: ITINERARY_VERSION,
    ...(body as { stops: StopDoc[] }),
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
      ...(s.view.airspace !== undefined ? { airspace: s.view.airspace } : {}),
      ...(s.view.diversion !== undefined ? { diversion: s.view.diversion } : {}),
      ...(s.view.leg !== undefined ? { leg: s.view.leg } : {}),
    },
  };
}
