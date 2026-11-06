import { airportCode, type AirportDataset } from '../data/airports.ts';
import { buildSearchIndex, findAirportByCode, searchAirports as rankedSearch } from '../data/search.ts';
import { zoneForAirport, type TimeZoneTable } from '../data/timezones.ts';
import {
  computeJourney,
  type JourneyInput,
  type Journey,
  type TimePoint,
  type IssueCode,
  type IssueSeverity,
  type JourneyTransfer,
} from '../lib/schedule.ts';
import { buildTimeline, journeyStateAt } from '../lib/timeline.ts';
import { describeState } from '../lib/journeyText.ts';
import { daylightAt, subsolarPoint } from '../lib/sun.ts';
import { formatIsoInstant, formatIsoOffset, parseIsoInstant } from '../lib/timezone.ts';
import { computeComparison, compareMetrics } from '../lib/compare.ts';
import { comparisonDocument } from './comparisonInput.ts';
import { formatDuration } from '../lib/flightTime.ts';
import { KM_PER_MILE } from '../lib/units.ts';
import { buildLinkUrl, parseLink, type LinkState, type LinkView, type SerializableJourney } from '../state/link.ts';
import {
  documentToLinkState,
  encodeItineraryParam,
  linkStateToDocument,
  validateItineraryDocument,
  type ItineraryDocument,
} from './itinerary.ts';
import { CONTRACT_VERSION, DEFAULT_BASE_URL, MAX_URL_LENGTH } from './contract.ts';
import type { Airport } from '../types.ts';

export interface AgentIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  path?: string;
}
export type AgentInput = ItineraryDocument | { route: string } | string;
export interface PlanOptions {
  assumeDeparture?: string;
}
export function createAgentContext(options: {
  airports: AirportDataset;
  timezones: TimeZoneTable | null;
  baseUrl?: string;
  now?: () => number;
}) {
  const base = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
  if (!['http:', 'https:'].includes(base.protocol)) throw new TypeError('baseUrl must use http or https.');
  base.search = '';
  base.hash = '';
  return {
    ...options,
    baseUrl: base.href,
    now: options.now ?? Date.now,
    index: buildSearchIndex(options.airports.airports),
  };
}
export type AgentContext = ReturnType<typeof createAgentContext>;
function airportInfo(ctx: AgentContext, airport: Airport) {
  const { iata, icao, name, city, region, country, countryCode, lat, lng, type, scheduled } = airport;
  return {
    code: airportCode(airport),
    iata,
    icao,
    name,
    city,
    region,
    country,
    countryCode,
    lat,
    lng,
    type,
    scheduled,
    timeZone: zoneForAirport(ctx.timezones, airport),
  };
}
export function searchAirports(ctx: AgentContext, query: string, limit = 8) {
  return rankedSearch(ctx.index, query, Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 8).map(
    (a) => airportInfo(ctx, a),
  );
}
function normalize(raw: unknown): {
  state: LinkState | null;
  document: ItineraryDocument | null;
  issues: AgentIssue[];
} {
  const route = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && 'route' in raw ? raw.route : null;
  if (typeof route === 'string') {
    const state = parseLink(`?route=${encodeURIComponent(route)}`);
    return {
      state,
      document: null,
      issues: state.issues.map((message) => ({ code: 'invalid_link', severity: 'error', message })),
    };
  }
  const checked = validateItineraryDocument(raw);
  if (!checked.ok)
    return { state: null, document: null, issues: checked.issues.map((i) => ({ ...i, severity: 'error' })) };
  const state = documentToLinkState(checked.doc);
  return {
    state,
    document: checked.doc,
    issues: [
      ...state.issues.map((message): AgentIssue => ({ code: 'invalid_time', severity: 'error', message })),
      ...(checked.doc.journeys && checked.doc.journeys.length > 1 ? [comparisonRequired()] : []),
    ],
  };
}
/** Resolve once, retaining diagnostics for unknown airports even though usable stops survive. */
export function resolveItinerary(ctx: AgentContext, raw: unknown) {
  const normalized = normalize(raw);
  const issues = [...normalized.issues];
  const input: JourneyInput = { id: 'A', stops: [] };
  const stopPaths: number[] = [];
  normalized.state?.stops?.forEach((s, i) => {
    const airport = findAirportByCode(ctx.index, s.code);
    if (!airport) {
      issues.push({
        code: 'unknown_airport',
        severity: 'error',
        message: `Unknown airport ${s.code}; skipped.`,
        path: `/stops/${i}/airport`,
      });
      return;
    }
    input.stops.push({
      airport,
      zone: zoneForAirport(ctx.timezones, airport),
      layoverMin: s.layoverMin,
      arrival: s.arrival,
      departure: s.departure,
    });
    stopPaths.push(i);
  });
  if (normalized.state && !input.stops.length)
    issues.push({ code: 'no_airports', severity: 'error', message: 'Supply at least one known airport.' });
  // The link parser only accepts a clock that names an airport of this route; report it rather than emit a dead link.
  const clock = normalized.document?.view?.clock;
  const clockAirport = clock ? findAirportByCode(ctx.index, clock.toUpperCase()) : undefined;
  if (
    clock !== undefined &&
    !['local', 'utc'].includes(clock.toLowerCase()) &&
    (!clockAirport ||
      ![
        ...(normalized.state?.stops ?? []),
        ...(normalized.state?.compare ?? []).flatMap((journey) => journey.stops),
      ].some((s) => findAirportByCode(ctx.index, s.code)?.id === clockAirport.id))
  )
    issues.push({
      code: 'invalid_clock',
      severity: 'error',
      message: `Clock "${clock}" must be "local", "utc" or an airport code from this route.`,
      path: '/view/clock',
    });
  if (normalized.state?.view.leg !== undefined && normalized.state.view.leg >= input.stops.length)
    issues.push({
      code: 'invalid_leg',
      severity: 'error',
      message: 'leg must be a one-based flight number within this route.',
      path: '/view/leg',
    });
  return { input, issues, document: normalized.document, view: normalized.state?.view, stopPaths };
}
const tenth = (n: number) => Math.round(n * 10) / 10;
const minutes = (n: number | null) => (n === null ? null : Math.round(n));
const timeInfo = (p: TimePoint | null) =>
  p
    ? {
        local: p.local,
        utc: formatIsoInstant(p.epochMs),
        offset: formatIsoOffset(p.offsetMin),
        timeZone: p.zone,
        provenance: p.provenance,
      }
    : null;
export const ESTIMATE_NOTES = [
  'Flight estimates use 850 km/h plus 30 minutes, rounded to 5 minutes; these are not airline schedules.',
  'Distances and positions follow a great circle on a spherical Earth; real routes differ.',
  'Altitude is illustrative, not aircraft tracking or an operational flight profile.',
  'Entered departure and arrival times are local to each airport; UTC offsets resolve repeated hours.',
  'Time-zone rules may change, especially for future dates; runtime Intl rules are used.',
] as const;
function scheduleIssues(journey: Journey, stopPaths: number[], prefix = ''): AgentIssue[] {
  return journey.issues.map((issue) => {
    const path =
      prefix +
      (issue.stop !== undefined
        ? `/stops/${stopPaths[issue.stop]}${issue.field ? `/${issue.field}` : ''}`
        : issue.leg !== undefined
          ? `/legs/${issue.leg}`
          : '');
    return { code: issue.code, severity: issue.severity, message: issue.message, ...(path ? { path } : {}) };
  });
}
function computed(ctx: AgentContext, raw: unknown, opts: PlanOptions = {}) {
  const resolved = resolveItinerary(ctx, raw);
  const assumedStart = opts.assumeDeparture === undefined ? null : parseIsoInstant(opts.assumeDeparture);
  if (opts.assumeDeparture !== undefined && assumedStart === null)
    resolved.issues.push({
      code: 'invalid_assumption',
      severity: 'error',
      message: 'assumeDeparture must be an ISO instant with Z or an explicit offset.',
    });
  const journey = computeJourney(resolved.input, { now: ctx.now(), assumedStart });
  const issues = [...resolved.issues, ...scheduleIssues(journey, resolved.stopPaths)];
  return { ...resolved, journey, issues };
}
const transferProvenance = (transfer: JourneyTransfer) =>
  transfer.source === 'setting'
    ? 'estimated'
    : transfer.arrival?.provenance === 'entered' && transfer.departure?.provenance === 'entered'
      ? 'entered'
      : 'mixed';

export function planItinerary(ctx: AgentContext, raw: unknown, opts: PlanOptions = {}) {
  const { input, document, view, journey, issues } = computed(ctx, raw, opts);
  let url: string | null = null,
    itineraryParamUrl: string | null = null;
  try {
    const canonicalClock =
      view?.clock && !['local', 'utc'].includes(view.clock)
        ? input.stops.find(
            (s) =>
              s.airport.ident === view.clock ||
              s.airport.icao === view.clock ||
              s.airport.iata === view.clock ||
              String(s.airport.id) === view.clock,
          )?.airport
        : undefined;
    url = buildLinkUrl(
      ctx.baseUrl,
      input.stops,
      canonicalClock ? { ...view, clock: airportCode(canonicalClock) } : view,
      (['follow', 'dayNight', 'clock'] as const).filter((key) => document?.view?.[key] !== undefined),
      { label: document?.journeys?.[0].label },
    );
    if (document || input.stops.length) {
      try {
        const alternative = new URL(url);
        alternative.search = `?itinerary=${encodeItineraryParam(document ?? linkStateToDocument(parseLink(new URL(url).search)))}`;
        if (alternative.href.length > MAX_URL_LENGTH)
          throw new RangeError('The itinerary-document link is too large to share.');
        itineraryParamUrl = alternative.href;
      } catch (error) {
        issues.push({
          code: 'document_link_too_large',
          severity: 'warning',
          message: `${error instanceof Error ? error.message : 'Cannot encode itinerary document.'} Use the readable url instead.`,
        });
      }
    }
  } catch (error) {
    issues.push({
      code: 'link_too_large',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Cannot encode link.',
    });
  }
  return {
    contractVersion: CONTRACT_VERSION,
    input: raw,
    url,
    itineraryParamUrl,
    ...journeyDetails(ctx, journey),
    issues,
    valid: !issues.some((issue) => issue.severity === 'error'),
    notes: ESTIMATE_NOTES,
  };
}

function journeyDetails(ctx: AgentContext, journey: Journey) {
  const sources = [
    ...journey.legs.map((l) => l.durationSource ?? 'estimated'),
    ...journey.transfers.map(transferProvenance),
  ];
  const provenance =
    sources.length && sources.every((s) => s === 'entered')
      ? 'entered'
      : sources.every((s) => s === 'estimated')
        ? 'estimated'
        : 'mixed';
  return {
    stops: journey.stops.map((s) => airportInfo(ctx, s.airport)),
    legs: journey.legs.map((l) => ({
      id: l.id,
      from: airportCode(l.from),
      to: airportCode(l.to),
      distanceKm: tenth(l.distanceKm),
      distanceMi: tenth(l.distanceKm / KM_PER_MILE),
      estimatedFlightMinutes: minutes(l.estimatedMin),
      departure: timeInfo(l.departure),
      arrival: timeInfo(l.arrival),
      durationMinutes: minutes(l.durationMin ?? l.estimatedMin),
      durationSource: l.durationSource ?? 'estimated',
    })),
    transfers: journey.transfers.map((t) => ({
      id: t.id,
      airport: airportCode(t.airport),
      minutes: Math.round(t.minutes),
      source: t.source,
      provenance: transferProvenance(t),
    })),
    totals: {
      distanceKm: tenth(journey.totals.distanceKm),
      distanceMi: tenth(journey.totals.distanceKm / KM_PER_MILE),
      flightMinutes: Math.round(journey.totals.flightMin),
      layoverMinutes: Math.round(journey.totals.layoverMin),
      journeyMinutes: Math.round(journey.totals.journeyMin),
      flights: journey.totals.flights,
      transfers: journey.totals.transfers,
      provenance,
    },
  };
}

function comparisonRequired(): AgentIssue {
  return {
    code: 'use_compare_journeys',
    severity: 'error',
    message: 'This document compares journeys; use compare_journeys.',
  };
}

function comparisonLinks(
  ctx: AgentContext,
  document: ItineraryDocument | null,
  primary: SerializableJourney,
  alternatives: SerializableJourney[],
  view: Partial<LinkView> | undefined,
  issues: AgentIssue[],
) {
  let url: string | null = null;
  let itineraryParamUrl: string | null = null;
  if (document) {
    try {
      url = buildLinkUrl(
        ctx.baseUrl,
        primary.stops,
        view,
        (['follow', 'dayNight', 'clock'] as const).filter((key) => document.view?.[key] !== undefined),
        {
          label: primary.label,
          compare: alternatives,
        },
      );
    } catch (error) {
      issues.push({
        code: 'link_too_large',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Cannot encode link.',
      });
    }
    try {
      const alternative = new URL(url ?? ctx.baseUrl);
      alternative.search = `?itinerary=${encodeItineraryParam(document)}`;
      if (alternative.href.length > MAX_URL_LENGTH)
        throw new RangeError('The itinerary-document link is too large to share.');
      itineraryParamUrl = alternative.href;
    } catch (error) {
      issues.push({
        code: 'document_link_too_large',
        severity: 'warning',
        message: `${error instanceof Error ? error.message : 'Cannot encode itinerary document.'} Use the readable url instead.`,
      });
    }
  }
  return { url, itineraryParamUrl };
}

export function planComparison(ctx: AgentContext, raw: unknown, opts: PlanOptions = {}) {
  const checked = comparisonDocument(raw);
  const issues: AgentIssue[] = checked.ok ? [] : checked.issues.map((issue) => ({ ...issue, severity: 'error' }));
  const document = checked.ok ? checked.doc : null;
  const resolved = (document?.journeys ?? []).map((journey, index) => {
    const result = resolveItinerary(ctx, { version: 1, stops: journey.stops });
    issues.push(...result.issues.map((issue) => ({ ...issue, path: `/journeys/${index}${issue.path ?? ''}` })));
    return result;
  });
  const assumedStart = opts.assumeDeparture === undefined ? null : parseIsoInstant(opts.assumeDeparture);
  if (opts.assumeDeparture !== undefined && assumedStart === null)
    issues.push({
      code: 'invalid_assumption',
      severity: 'error',
      message: 'assumeDeparture must be an ISO instant with Z or an explicit offset.',
    });
  const compared = computeComparison(
    resolved.map((result, index) => ({
      label: document?.journeys?.[index].label?.trim() ?? null,
      input: result.input,
    })),
    { assumedStart, now: ctx.now() },
  );
  for (const entry of compared)
    issues.push(...scheduleIssues(entry.journey, resolved[entry.index].stopPaths, `/journeys/${entry.index}`));
  const link = document ? documentToLinkState(document) : null;
  if (link)
    issues.push(...link.issues.map((message): AgentIssue => ({ code: 'invalid_time', severity: 'error', message })));
  const view = link?.view;
  const clock = view?.clock;
  const clockAirport = clock && !['local', 'utc'].includes(clock) ? findAirportByCode(ctx.index, clock) : undefined;
  if (
    clock &&
    !['local', 'utc'].includes(clock) &&
    (!clockAirport ||
      !resolved.some((result) => result.input.stops.some((stop) => stop.airport.id === clockAirport.id)))
  )
    issues.push({
      code: 'invalid_clock',
      severity: 'error',
      message: `Clock "${clock}" must be "local", "utc" or an airport code from a compared journey.`,
      path: '/view/clock',
    });
  if (view?.leg !== undefined && view.leg >= (resolved[0]?.input.stops.length ?? 0))
    issues.push({
      code: 'invalid_leg',
      severity: 'error',
      message: 'leg must be a one-based flight number within journey A.',
      path: '/view/leg',
    });
  const { url, itineraryParamUrl } = comparisonLinks(
    ctx,
    document,
    { label: compared[0]?.label ?? null, stops: resolved[0]?.input.stops ?? [] },
    compared.slice(1).map((entry) => ({ label: entry.label, stops: entry.journey.stops })),
    clockAirport ? { ...view, clock: airportCode(clockAirport) } : view,
    issues,
  );
  const validJourneys = compared.filter(
    (entry) =>
      entry.journey.stops.length >= 2 &&
      !resolved[entry.index].issues.some((issue) => issue.severity === 'error') &&
      !entry.journey.issues.some((issue) => issue.severity === 'error'),
  );
  const metrics = compareMetrics(validJourneys);
  const journeys = compared.map((entry) => ({
    id: entry.id,
    label: entry.label,
    color: entry.color,
    ...journeyDetails(ctx, entry.journey),
    departure: timeInfo(entry.journey.start),
    arrival: timeInfo(entry.journey.end),
    anchor: entry.anchor,
  }));
  const comparison = {
    fastest: metrics.fastest,
    firstArrival: metrics.firstArrival,
    ranking: metrics.journeys
      .map((journey) => ({
        id: journey.id,
        journeyMinutes: journey.journeyMin,
        deltaMinutes: metrics.deltaMin[journey.id],
      }))
      .sort((a, b) => a.journeyMinutes - b.journeyMinutes),
  };
  const humanSummary = journeys
    .map((journey) => {
      const awards = [
        comparison.fastest === journey.id ? 'fastest' : '',
        comparison.firstArrival === journey.id ? 'arrives first' : '',
      ].filter(Boolean);
      return `${journey.id} ${journey.stops.map((stop) => stop.code).join(' → ')} ${formatDuration(journey.totals.journeyMinutes)}${awards.length ? ` (${awards.join(', ')})` : ''}`;
    })
    .join(' · ');
  return {
    contractVersion: CONTRACT_VERSION,
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    notes: ESTIMATE_NOTES,
    url,
    itineraryParamUrl,
    humanSummary,
    journeys,
    comparison,
  };
}

export function validateItinerary(ctx: AgentContext, raw: unknown) {
  return raw && typeof raw === 'object' && 'journeys' in raw
    ? planComparison(ctx, raw).issues
    : planItinerary(ctx, raw).issues;
}
export function timelineAt(
  ctx: AgentContext,
  raw: unknown,
  instants: string[] | { samples: number; assumeDeparture?: string },
  opts: PlanOptions = {},
) {
  const { journey, issues } = computed(ctx, raw, {
    ...(!Array.isArray(instants) ? { assumeDeparture: instants.assumeDeparture } : {}),
    ...opts,
  });
  const timeline = buildTimeline(journey);
  if (!journey.dated && !journey.start && !issues.some((i) => i.code === 'invalid_assumption'))
    issues.push({
      code: 'assume_departure_required',
      severity: 'error',
      message: 'Undated itineraries require assumeDeparture, an ISO instant with Z or an explicit offset.',
    });
  if (!timeline && !issues.some((i) => i.severity === 'error'))
    issues.push({
      code: 'timeline_unavailable',
      severity: 'error',
      message: 'A timeline requires at least one flight and resolved departure and arrival instants.',
    });
  let times: number[] = [];
  if (Array.isArray(instants)) {
    if (instants.length > 1000)
      issues.push({ code: 'invalid_samples', severity: 'error', message: 'Use at most 1000 instants.' });
    else
      for (const instant of instants) {
        const time = parseIsoInstant(instant);
        if (time === null)
          issues.push({ code: 'invalid_instant', severity: 'error', message: `Invalid ISO instant: ${instant}.` });
        else times.push(time);
      }
  } else if (!Number.isInteger(instants.samples) || instants.samples < 2 || instants.samples > 1000)
    issues.push({ code: 'invalid_samples', severity: 'error', message: 'samples must be an integer from 2 to 1000.' });
  else if (timeline)
    times = Array.from({ length: instants.samples }, (_, i) =>
      Math.round(timeline.start + ((timeline.end - timeline.start) * i) / (instants.samples - 1)),
    );
  return {
    contractVersion: CONTRACT_VERSION,
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
    timeline: timeline
      ? times.map((time) => {
          const state = journeyStateAt(journey, timeline, time);
          const airport = state.phase === 'flight' ? null : journey.stops[state.stop].airport;
          const position = state.phase === 'flight' ? state.position : { lat: airport!.lat, lng: airport!.lng };
          return {
            time: formatIsoInstant(time),
            phase: state.phase,
            legId: journey.legs[state.leg]?.id,
            ...(airport ? { stopCode: airportCode(airport) } : {}),
            ...(state.phase === 'flight'
              ? { distanceFraction: state.distanceFraction, altitudeKmIllustrative: state.altitudeKm }
              : {}),
            position: { ...position, provenance: 'estimated', model: 'great_circle' },
            status: describeState(journey, state),
            daylight: daylightAt(time, position),
            subsolarPoint: subsolarPoint(time),
            timeProvenance: Array.isArray(instants) ? 'entered' : 'estimated',
            anchorProvenance: journey.dated ? 'entered' : 'assumed',
          };
        })
      : [],
  };
}

/** Exhaustive over the schedule's IssueCode union: additions must update discovery semantics. */
export const SCHEDULE_ISSUES = {
  invalid_time: ['error', 'Malformed local calendar time.'],
  date_out_of_range: ['error', 'Supported years are 1900–2100.'],
  time_missing: ['warning', 'A date was supplied without a time.'],
  timezone_unknown: ['error', 'No zone mapped for this airport.'],
  timezone_unsupported: ['error', 'Runtime Intl does not support the mapped zone.'],
  ambiguous_local_time: ['warning', 'Repeated hour; earlier instant used unless an offset selects one.'],
  nonexistent_local_time: ['error', 'Local time falls in a daylight-saving gap.'],
  offset_mismatch: ['error', 'Explicit offset is invalid at this airport wall time.'],
  ignored_time: ['warning', 'Arrival at origin or departure at destination is ignored.'],
  negative_flight_time: ['error', 'Arrival must follow departure for a nonzero flight.'],
  connection_overlap: ['error', 'Connection departs before its arrival.'],
  short_connection: ['warning', 'Connection is shorter than 20 minutes.'],
  unusual_flight_time: ['warning', 'Entered duration differs substantially from the estimate.'],
  long_layover: ['warning', 'Connection exceeds seven days.'],
  future_rules: ['info', 'Future times use current runtime time-zone rules.'],
} as const satisfies Record<IssueCode, readonly [IssueSeverity, string]>;
