import { airportCode, airportShortName, type AirportDataset } from '../data/airports.ts';
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
import { computeComparison, compareMetrics, routedJourney, type LegRouter } from '../lib/compare.ts';
import type { Router } from '../lib/router.ts';
import {
  DEFAULT_DIVERSION_PROFILE,
  diversionProfile,
  diversionRadiusKm,
  type DiversionProfile,
} from '../lib/diversion.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';
import { computeTrip, sectionRole, tripStateAt, type Trip, type TripIssueCode, type TripStay } from '../lib/trip.ts';
import { comparisonDocument } from './comparisonInput.ts';
import { formatDuration } from '../lib/flightTime.ts';
import { KM_PER_MILE } from '../lib/units.ts';
import {
  buildLinkUrl,
  parseLink,
  type LinkExtra,
  type LinkState,
  type LinkView,
  type SerializableJourney,
  type LinkDefaultKey,
} from '../state/link.ts';
import {
  documentToLinkState,
  encodeItineraryParam,
  linkStateToDocument,
  validateItineraryDocument,
  type ItineraryDocument,
} from './itinerary.ts';
import {
  CONTRACT_VERSION,
  DEFAULT_BASE_URL,
  MAX_URL_LENGTH,
  MAX_TIMELINE_SAMPLES,
  LINK_PARAMS,
  isNamedClock,
} from './contract.ts';
import type { Airport, LatLng } from '../types.ts';

export interface AgentIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  path?: string;
}
export type AgentInput = ItineraryDocument | { route: string } | string;
/**
 * Opt-in modelled routing. Without it every result is a great circle, as before routing existed.
 * `diversion: true` keeps flights within 180 minutes (at an assumed 400 kt on one engine) of potential
 * diversion airports; a number of minutes (60–370) chooses another limit.
 */
export interface RoutingRequest {
  avoidAirspace?: boolean;
  diversion?: boolean | number;
}
export interface PlanOptions {
  assumeDeparture?: string;
  routing?: RoutingRequest;
}
export function createAgentContext(options: {
  airports: AirportDataset;
  timezones: TimeZoneTable | null;
  baseUrl?: string;
  now?: () => number;
  /** Routes legs when a request asks for routing; absent, routing requests report `routing_unavailable`. */
  router?: Router | null;
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
      ...(checked.doc.sections && checked.doc.sections.length > 1 ? [tripRequired()] : []),
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
  validateClock(
    ctx,
    clock,
    (airport) =>
      input.stops.some((stop) => stop.airport.id === airport.id) ||
      (normalized.state?.compare ?? []).some((journey) =>
        journey.stops.some((stop) => findAirportByCode(ctx.index, stop.code)?.id === airport.id),
      ),
    'this route',
    issues,
  );
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
const ESTIMATE_NOTES = [
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
function parseAssumedDeparture(opts: PlanOptions, issues: AgentIssue[]): number | null {
  const assumedStart = opts.assumeDeparture === undefined ? null : parseIsoInstant(opts.assumeDeparture);
  if (opts.assumeDeparture !== undefined && assumedStart === null)
    issues.push({
      code: 'invalid_assumption',
      severity: 'error',
      message: 'assumeDeparture must be an ISO instant with Z or an explicit offset.',
    });
  return assumedStart;
}

function validateClock(
  ctx: AgentContext,
  clock: string | undefined,
  includesAirport: (airport: Airport) => boolean,
  scope: 'this route' | 'a compared journey',
  issues: AgentIssue[],
): Airport | null {
  if (clock === undefined || isNamedClock(clock.toLowerCase())) return null;
  const airport = findAirportByCode(ctx.index, clock.toUpperCase());
  if (!airport || !includesAirport(airport))
    issues.push({
      code: 'invalid_clock',
      severity: 'error',
      message: `Clock "${clock}" must be "local", "utc" or an airport code from ${scope}.`,
      path: '/view/clock',
    });
  return airport;
}

export interface RoutingSummary {
  avoidAirspace: boolean;
  airspaceReviewed: string | null;
  diversion: { profile: string; maxDiversionMinutes: number; oeiSpeedKt: number; radiusKm: number } | null;
  note: string;
}
const ROUTING_NOTE =
  'Routed distances are modelled approximations: restricted airspace from EASA bulletins valid on the flight date (EU/EEA operator assumed), and still-air reach of potential diversion airports chosen from runway data. They are not an airline route, an ETOPS/EDTO authorisation or flight planning; winds, tracks, airways and ATC are not modelled.';

/** The leg router and its description for a request; nothing (great circles) unless routing is asked for. */
function routingFor(
  ctx: AgentContext,
  request: RoutingRequest | undefined,
  issues: AgentIssue[],
): { route?: LegRouter; summary: RoutingSummary | null } {
  if (!request || (!request.avoidAirspace && !request.diversion)) return { summary: null };
  let profile: DiversionProfile | null = null;
  if (request.diversion === true) profile = DEFAULT_DIVERSION_PROFILE;
  else if (typeof request.diversion === 'number')
    try {
      profile = diversionProfile(request.diversion);
    } catch {
      issues.push({
        code: 'invalid_routing',
        severity: 'error',
        message: 'routing.diversion must be true, false or a whole number of minutes from 60 to 370.',
        path: '/routing/diversion',
      });
      return { summary: null };
    }
  const router = ctx.router ?? null;
  const missing = [
    request.avoidAirspace && !router?.airspace ? 'restricted-airspace' : '',
    profile && !router?.diversion ? 'diversion-airport' : '',
  ].filter(Boolean);
  if (missing.length)
    issues.push({
      code: 'routing_unavailable',
      severity: 'warning',
      message: `The ${missing.join(' and ')} data is not available here; those flights follow great circles.`,
    });
  const summary: RoutingSummary = {
    avoidAirspace: !!request.avoidAirspace,
    airspaceReviewed: request.avoidAirspace ? (router?.airspace?.reviewed ?? null) : null,
    diversion: profile
      ? {
          profile: profile.id,
          maxDiversionMinutes: profile.maxDiversionMin,
          oeiSpeedKt: profile.oeiSpeedKt,
          radiusKm: tenth(diversionRadiusKm(profile)),
        }
      : null,
    note: ROUTING_NOTE,
  };
  if (!router) return { summary };
  return {
    summary,
    route: (from, to, departureMs) =>
      router.route(from, to, {
        epochMs: departureMs,
        avoidAirspace: !!request.avoidAirspace && !!router.airspace,
        diversion: router.diversion ? profile : null,
      }),
  };
}

function computed(ctx: AgentContext, raw: unknown, opts: PlanOptions = {}) {
  const resolved = resolveItinerary(ctx, raw);
  const assumedStart = parseAssumedDeparture(opts, resolved.issues);
  const routing = routingFor(ctx, opts.routing, resolved.issues);
  const journey = routing.route
    ? routedJourney(resolved.input, { now: ctx.now(), assumedStart }, routing.route)
    : computeJourney(resolved.input, { now: ctx.now(), assumedStart });
  const issues = [...resolved.issues, ...scheduleIssues(journey, resolved.stopPaths)];
  return { ...resolved, journey, issues, routing: routing.summary };
}
const transferProvenance = (transfer: JourneyTransfer) =>
  transfer.source === 'setting'
    ? 'estimated'
    : transfer.arrival?.provenance === 'entered' && transfer.departure?.provenance === 'entered'
      ? 'entered'
      : 'mixed';

/** A document with `sections`: plan it with planTrip (tools dispatch on this). */
export const isTripDocument = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'sections' in raw;

export function planItinerary(ctx: AgentContext, raw: unknown, opts: PlanOptions = {}) {
  const { input, document, view, journey, issues, routing } = computed(ctx, raw, opts);
  const canonicalClock =
    view?.clock && !isNamedClock(view.clock)
      ? input.stops.find(
          (s) =>
            s.airport.ident === view.clock ||
            s.airport.icao === view.clock ||
            s.airport.iata === view.clock ||
            String(s.airport.id) === view.clock,
        )?.airport
      : undefined;
  const url = readableLink(
    ctx,
    document,
    { label: document?.journeys?.[0].label ?? null, stops: input.stops },
    canonicalClock ? { ...view, clock: airportCode(canonicalClock) } : view,
    issues,
  );
  const itineraryParamUrl =
    url && (document || input.stops.length)
      ? documentLink(url, document ?? linkStateToDocument(parseLink(new URL(url).search)), issues)
      : null;
  return {
    contractVersion: CONTRACT_VERSION,
    kind: 'journey' as const,
    input: raw,
    url,
    itineraryParamUrl,
    routing,
    ...journeyDetails(ctx, journey),
    issues,
    valid: !issues.some((issue) => issue.severity === 'error'),
    notes: ESTIMATE_NOTES,
  };
}

const TRIP_NOTES = [
  ...ESTIMATE_NOTES,
  'A trip is sequential: each section is its own journey with its own connections; stays between sections are never counted as layovers.',
  'A section without entered times is placed from its neighbour through its stayMinutes (default 7 days); those times are estimated or assumed.',
] as const;

/** English default names: the traveller's labels win; else Outbound, Return when it comes home, else Journey n. */
function tripSectionName(trip: Trip, index: number): string {
  const section = trip.sections[index];
  if (section.label) return section.label;
  const role = sectionRole(
    index,
    trip.sections.length,
    trip.sections[0].journey.stops[0]?.airport,
    section.journey.stops.at(-1)?.airport,
  );
  return role === 'outbound' ? 'Outbound' : role === 'return' ? 'Return' : `Journey ${index + 1}`;
}

function stayDetails(stay: TripStay) {
  const provenance =
    stay.source === 'times'
      ? stay.arrival?.provenance === 'entered' && stay.departure?.provenance === 'entered'
        ? 'entered'
        : 'mixed'
      : stay.custom
        ? 'estimated'
        : 'assumed';
  return {
    afterSection: stay.after,
    beforeSection: stay.section,
    arrivalAirport: airportCode(stay.arrivalAirport),
    departureAirport: airportCode(stay.departureAirport),
    openJaw: stay.arrivalAirport.id !== stay.departureAirport.id,
    arrival: timeInfo(stay.arrival),
    departure: timeInfo(stay.departure),
    minutes: Math.round(stay.minutes),
    days: stay.days,
    source: stay.source,
    provenance,
  };
}

/** A trip document (`sections`): each section planned as a journey, explicit stays between them, trip totals. */
export function planTrip(ctx: AgentContext, raw: unknown, opts: PlanOptions = {}) {
  const checked = validateItineraryDocument(raw);
  const issues: AgentIssue[] = checked.ok ? [] : checked.issues.map((issue) => ({ ...issue, severity: 'error' }));
  const document = checked.ok && checked.doc.sections ? checked.doc : null;
  const sectionDocs = document?.sections ?? [];
  const resolved = sectionDocs.map((section, index) => {
    const result = resolveItinerary(ctx, { version: 1, stops: section.stops });
    issues.push(
      ...result.issues
        .filter((issue) => issue.code !== 'invalid_clock' && issue.code !== 'invalid_leg')
        .map((issue) => ({ ...issue, path: `/sections/${index}${issue.path ?? ''}` })),
    );
    return result;
  });
  const assumedStart = parseAssumedDeparture(opts, issues);
  const routing = routingFor(ctx, opts.routing, issues);
  const trip = computeTrip(
    resolved.map((result, index) => ({
      label: sectionDocs[index].label?.trim() ?? null,
      stayMin: sectionDocs[index].stayMinutes ?? null,
      input: result.input,
    })),
    { assumedStart, now: ctx.now(), route: routing.route },
  );
  trip.sections.forEach((section) =>
    issues.push(...scheduleIssues(section.journey, resolved[section.index].stopPaths, `/sections/${section.index}`)),
  );
  issues.push(
    ...trip.issues.map((issue): AgentIssue => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      path: `/sections/${issue.section}`,
    })),
  );
  const link = document ? documentToLinkState(document) : null;
  if (link)
    issues.push(...link.issues.map((message): AgentIssue => ({ code: 'invalid_time', severity: 'error', message })));
  const view = link?.view;
  const clockAirport = validateClock(
    ctx,
    view?.clock,
    (airport) => resolved.some((result) => result.input.stops.some((stop) => stop.airport.id === airport.id)),
    'this route',
    issues,
  );
  if (view?.leg !== undefined && view.leg > trip.totals.flights)
    issues.push({
      code: 'invalid_leg',
      severity: 'error',
      message: 'leg must be a one-based flight number within this trip (counted across sections).',
      path: '/view/leg',
    });
  const url = document
    ? readableLink(
        ctx,
        document,
        { label: trip.sections[0]?.label ?? null, stops: resolved[0]?.input.stops ?? [] },
        clockAirport ? { ...view, clock: airportCode(clockAirport) } : view,
        issues,
        {
          sections: trip.sections.slice(1).map((section) => ({
            label: section.label,
            stayMin: sectionDocs[section.index].stayMinutes ?? null,
            stops: resolved[section.index].input.stops,
          })),
        },
      )
    : null;
  const itineraryParamUrl = document ? documentLink(url ?? ctx.baseUrl, document, issues) : null;
  const stays = trip.stays.map(stayDetails);
  const sections = trip.sections.map((section) => ({
    index: section.index,
    name: tripSectionName(trip, section.index),
    label: section.label,
    anchor: section.anchor,
    ...journeyDetails(ctx, section.journey),
    departure: timeInfo(section.journey.start),
    arrival: timeInfo(section.journey.end),
  }));
  const sources = sections.map((section) => section.totals.provenance);
  const humanSummary = sections
    .flatMap((section, index) => {
      const stay = stays.find((s) => s.beforeSection === index);
      return [
        ...(stay ? [`stay ${formatDuration(stay.minutes)} at ${stay.arrivalAirport}`] : []),
        `${section.name}: ${section.stops.map((stop) => stop.code).join(' → ')} ${formatDuration(section.totals.journeyMinutes)}`,
      ];
    })
    .join(' · ');
  return {
    contractVersion: CONTRACT_VERSION,
    kind: 'trip' as const,
    input: raw,
    url,
    itineraryParamUrl,
    routing: routing.summary,
    humanSummary,
    sections,
    stays,
    totals: {
      distanceKm: tenth(trip.totals.distanceKm),
      distanceMi: tenth(trip.totals.distanceKm / KM_PER_MILE),
      flightMinutes: Math.round(trip.totals.flightMin),
      connectionMinutes: Math.round(trip.totals.connectionMin),
      stayMinutes: Math.round(trip.totals.stayMin),
      tripMinutes: Math.round(trip.totals.tripMin),
      flights: trip.totals.flights,
      connections: trip.totals.connections,
      sections: trip.sections.length,
      stays: trip.stays.length,
      departure: timeInfo(trip.start),
      arrival: timeInfo(trip.end),
      provenance:
        sources.length && sources.every((p) => p === 'entered')
          ? 'entered'
          : sources.every((p) => p === 'estimated')
            ? 'estimated'
            : 'mixed',
    },
    issues,
    valid: !issues.some((issue) => issue.severity === 'error'),
    notes: TRIP_NOTES,
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
      greatCircleKm: tenth(l.route?.greatCircleKm ?? greatCircleDistanceKm(l.from, l.to)),
      distanceModel: l.route?.path ? ('routed' as const) : ('great_circle' as const),
      ...(l.route
        ? {
            route: {
              airspace: { status: l.route.status, avoided: l.route.avoided, crossed: l.route.crossed },
              ...(l.route.diversion
                ? {
                    diversion: {
                      profile: l.route.diversion.profile,
                      limitMinutes: l.route.diversion.limitMin,
                      status: l.route.diversion.status,
                      maxDiversionMinutes: l.route.diversion.maxMin,
                      outsideKm: tenth(l.route.diversion.outsideKm),
                      extraKm: tenth(l.route.diversion.extraKm),
                      beyondThresholdKm: tenth(l.route.diversion.beyondThresholdKm),
                    },
                  }
                : {}),
            },
          }
        : {}),
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

function tripRequired(): AgentIssue {
  return {
    code: 'use_trip_sections',
    severity: 'error',
    message: 'This document is a trip with several sections; plan it as a trip (calculate_route accepts it).',
  };
}

function comparisonRequired(): AgentIssue {
  return {
    code: 'use_compare_journeys',
    severity: 'error',
    message: 'This document compares journeys; use compare_journeys.',
  };
}

const EXPLICIT_DEFAULT_KEYS = ['follow', 'dayNight', 'clock'] as const satisfies readonly LinkDefaultKey[];

/** The readable share link, or null (with an error issue) when it exceeds the URL limit. */
function readableLink(
  ctx: AgentContext,
  document: ItineraryDocument | null,
  primary: SerializableJourney,
  view: Partial<LinkView> | undefined,
  issues: AgentIssue[],
  extra?: SerializableJourney[] | Omit<LinkExtra, 'label'>,
): string | null {
  try {
    return buildLinkUrl(
      ctx.baseUrl,
      primary.stops,
      view,
      EXPLICIT_DEFAULT_KEYS.filter((key) => document?.view?.[key] !== undefined),
      { label: primary.label, ...(Array.isArray(extra) ? { compare: extra } : (extra ?? {})) },
    );
  } catch (error) {
    issues.push({
      code: 'link_too_large',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Cannot encode link.',
    });
    return null;
  }
}

/** The same journey as a compact `?itinerary=` link on `base`, or null (with a warning) when too large. */
function documentLink(base: string, document: ItineraryDocument, issues: AgentIssue[]): string | null {
  try {
    const url = new URL(base);
    url.search = `?${LINK_PARAMS.itinerary}=${encodeItineraryParam(document)}`;
    if (url.href.length > MAX_URL_LENGTH) throw new RangeError('The itinerary-document link is too large to share.');
    return url.href;
  } catch (error) {
    issues.push({
      code: 'document_link_too_large',
      severity: 'warning',
      message: `${error instanceof Error ? error.message : 'Cannot encode itinerary document.'} Use the readable url instead.`,
    });
    return null;
  }
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
  const assumedStart = parseAssumedDeparture(opts, issues);
  const routing = routingFor(ctx, opts.routing, issues);
  const compared = computeComparison(
    resolved.map((result, index) => ({
      label: document?.journeys?.[index].label?.trim() ?? null,
      input: result.input,
    })),
    { assumedStart, now: ctx.now(), route: routing.route },
  );
  for (const entry of compared)
    issues.push(...scheduleIssues(entry.journey, resolved[entry.index].stopPaths, `/journeys/${entry.index}`));
  const link = document ? documentToLinkState(document) : null;
  if (link)
    issues.push(...link.issues.map((message): AgentIssue => ({ code: 'invalid_time', severity: 'error', message })));
  const view = link?.view;
  const clock = view?.clock;
  const clockAirport = validateClock(
    ctx,
    clock,
    (airport) => resolved.some((result) => result.input.stops.some((stop) => stop.airport.id === airport.id)),
    'a compared journey',
    issues,
  );
  if (view?.leg !== undefined && view.leg >= (resolved[0]?.input.stops.length ?? 0))
    issues.push({
      code: 'invalid_leg',
      severity: 'error',
      message: 'leg must be a one-based flight number within journey A.',
      path: '/view/leg',
    });
  const url = document
    ? readableLink(
        ctx,
        document,
        { label: compared[0]?.label ?? null, stops: resolved[0]?.input.stops ?? [] },
        clockAirport ? { ...view, clock: airportCode(clockAirport) } : view,
        issues,
        compared.slice(1).map((entry) => ({ label: entry.label, stops: entry.journey.stops })),
      )
    : null;
  // A comparison keeps its document link even when the readable link exceeds the limit.
  const itineraryParamUrl = document ? documentLink(url ?? ctx.baseUrl, document, issues) : null;
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
    routing: routing.summary,
    humanSummary,
    journeys,
    comparison,
  };
}

export function validateItinerary(ctx: AgentContext, raw: unknown) {
  return raw && typeof raw === 'object' && 'journeys' in raw
    ? planComparison(ctx, raw).issues
    : isTripDocument(raw)
      ? planTrip(ctx, raw).issues
      : planItinerary(ctx, raw).issues;
}

/** Samples a trip on its one clock: journeys as usual, and `stay` between them at the arrival airport. */
export function tripTimelineAt(
  ctx: AgentContext,
  raw: unknown,
  instants: string[] | { samples: number; assumeDeparture?: string },
  opts: PlanOptions = {},
) {
  const plan = planTrip(ctx, raw, {
    ...(!Array.isArray(instants) ? { assumeDeparture: instants.assumeDeparture } : {}),
    ...opts,
  });
  const issues = [...plan.issues];
  const checked = validateItineraryDocument(raw);
  const sections = checked.ok ? (checked.doc.sections ?? []) : [];
  const trip = computeTrip(
    sections.map((section) => ({
      label: section.label ?? null,
      stayMin: section.stayMinutes ?? null,
      input: resolveItinerary(ctx, { version: 1, stops: section.stops }).input,
    })),
    {
      assumedStart: parseAssumedDeparture(
        { ...(!Array.isArray(instants) ? { assumeDeparture: instants.assumeDeparture } : {}), ...opts },
        [],
      ),
      now: ctx.now(),
      route: routingFor(ctx, opts.routing, []).route,
    },
  );
  const timeline = trip.timeline;
  if (!trip.dated && !trip.start && !issues.some((i) => i.code === 'invalid_assumption'))
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
  const times = sampleTimes(instants, timeline, issues);
  return {
    contractVersion: CONTRACT_VERSION,
    kind: 'trip' as const,
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
    timeline: timeline
      ? times.map((time) => {
          const state = tripStateAt(trip, timeline, time);
          if (state.phase === 'stay') {
            const stay = trip.stays.find((s) => s.section === state.section)!;
            const airport = stay.arrivalAirport;
            const position = { lat: airport.lat, lng: airport.lng };
            return {
              time: formatIsoInstant(time),
              phase: 'stay' as const,
              section: state.section,
              stopCode: airportCode(airport),
              position: { ...position, provenance: 'estimated', model: 'great_circle' },
              status: {
                title: `Staying in ${airportShortName(airport)}`,
                detail: `${tripSectionName(trip, state.section)} departs in ${formatDuration(state.untilDepartureMin)}`,
              },
              daylight: daylightAt(time, position),
              subsolarPoint: subsolarPoint(time),
              timeProvenance: Array.isArray(instants) ? 'entered' : 'estimated',
              anchorProvenance: trip.dated ? 'entered' : 'assumed',
            };
          }
          const journey = trip.sections[state.section].journey;
          return {
            ...stateSample(journey, state.state, time, Array.isArray(instants)),
            section: state.section,
            globalLeg: state.legOffset + state.state.leg,
          };
        })
      : [],
  };
}

function sampleTimes(
  instants: string[] | { samples: number },
  timeline: { start: number; end: number } | null,
  issues: AgentIssue[],
): number[] {
  const times: number[] = [];
  if (Array.isArray(instants)) {
    if (instants.length > MAX_TIMELINE_SAMPLES)
      issues.push({
        code: 'invalid_samples',
        severity: 'error',
        message: `Use at most ${MAX_TIMELINE_SAMPLES} instants.`,
      });
    else
      for (const instant of instants) {
        const time = parseIsoInstant(instant);
        if (time === null)
          issues.push({ code: 'invalid_instant', severity: 'error', message: `Invalid ISO instant: ${instant}.` });
        else times.push(time);
      }
  } else if (!Number.isInteger(instants.samples) || instants.samples < 2 || instants.samples > MAX_TIMELINE_SAMPLES)
    issues.push({
      code: 'invalid_samples',
      severity: 'error',
      message: `samples must be an integer from 2 to ${MAX_TIMELINE_SAMPLES}.`,
    });
  else if (timeline)
    return Array.from({ length: instants.samples }, (_, i) =>
      Math.round(timeline.start + ((timeline.end - timeline.start) * i) / (instants.samples - 1)),
    );
  return times;
}

function stateSample(journey: Journey, state: ReturnType<typeof journeyStateAt>, time: number, entered: boolean) {
  let airport: Airport | null = null;
  let position: LatLng;
  if (state.phase === 'flight') position = state.position;
  else {
    airport = journey.stops[state.stop].airport;
    position = { lat: airport.lat, lng: airport.lng };
  }
  return {
    time: formatIsoInstant(time),
    phase: state.phase,
    legId: journey.legs[state.leg]?.id,
    ...(airport ? { stopCode: airportCode(airport) } : {}),
    ...(state.phase === 'flight'
      ? { distanceFraction: state.distanceFraction, altitudeKmIllustrative: state.altitudeKm }
      : {}),
    position: {
      ...position,
      provenance: 'estimated',
      model: state.phase === 'flight' && journey.legs[state.leg]?.route?.path ? 'routed' : 'great_circle',
    },
    status: describeState(journey, state),
    daylight: daylightAt(time, position),
    subsolarPoint: subsolarPoint(time),
    timeProvenance: entered ? 'entered' : 'estimated',
    anchorProvenance: journey.dated ? 'entered' : 'assumed',
  };
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
  const times = sampleTimes(instants, timeline, issues);
  return {
    contractVersion: CONTRACT_VERSION,
    kind: 'journey' as const,
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
    timeline: timeline
      ? times.map((time) =>
          stateSample(journey, journeyStateAt(journey, timeline, time), time, Array.isArray(instants)),
        )
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
/** Trip-level issues (sections documents). */
export const TRIP_ISSUES = {
  stay_overlap: ['error', 'A section departs before the previous section arrives.'],
} as const satisfies Record<TripIssueCode, readonly [IssueSeverity, string]>;
