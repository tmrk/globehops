import type { Airport, LocalTimeInput } from '../types.ts';
import { displayCity } from '../data/airports.ts';
import { estimateFlightMinutes, formatDuration, type FlightTimeModel } from './flightTime.ts';
import { greatCircleDistanceKm } from './geo.ts';
import { DEFAULT_LAYOVER_MIN } from './layover.ts';
import {
  MIN_YEAR,
  MAX_YEAR,
  parseLocalDateTime,
  parseLocalDate,
  isSupportedTimeZone,
  resolveLocal,
  utcToLocal,
  formatLocalDateTime,
  formatOffset,
  zoneAbbreviation,
} from './timezone.ts';

const JOURNEY_MODEL_VERSION = 1;
export type TimeProvenance = 'entered' | 'estimated' | 'assumed';
export interface TimePoint {
  epochMs: number;
  zone: string;
  offsetMin: number;
  local: string;
  provenance: TimeProvenance;
}
export interface JourneyStopInput {
  airport: Airport;
  zone: string | null;
  layoverMin: number | null;
  arrival: LocalTimeInput | null;
  departure: LocalTimeInput | null;
}
export interface JourneyInput {
  id: string;
  stops: JourneyStopInput[];
}
export interface ScheduleOptions {
  assumedStart?: number | null;
  now?: number;
  flightModel?: FlightTimeModel;
}
export interface JourneyLeg {
  id: string;
  index: number;
  fromStop: number;
  toStop: number;
  from: Airport;
  to: Airport;
  distanceKm: number;
  estimatedMin: number | null;
  departure: TimePoint | null;
  arrival: TimePoint | null;
  durationMin: number | null;
  durationSource: 'entered' | 'estimated' | 'mixed' | null;
}
export interface JourneyTransfer {
  id: string;
  stop: number;
  airport: Airport;
  arrival: TimePoint | null;
  departure: TimePoint | null;
  minutes: number;
  source: 'setting' | 'times';
  custom: boolean;
}
export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueCode =
  | 'invalid_time'
  | 'date_out_of_range'
  | 'time_missing'
  | 'timezone_unknown'
  | 'timezone_unsupported'
  | 'ambiguous_local_time'
  | 'nonexistent_local_time'
  | 'offset_mismatch'
  | 'ignored_time'
  | 'negative_flight_time'
  | 'connection_overlap'
  | 'short_connection'
  | 'unusual_flight_time'
  | 'long_layover'
  | 'future_rules';
export interface ScheduleIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  stop?: number;
  leg?: number;
  field?: 'arrival' | 'departure';
  options?: { offsetMin: number; label: string }[];
}
export interface Journey {
  version: 1;
  id: string;
  stops: JourneyStopInput[];
  legs: JourneyLeg[];
  transfers: JourneyTransfer[];
  dated: boolean;
  start: TimePoint | null;
  end: TimePoint | null;
  totals: {
    distanceKm: number;
    flightMin: number;
    layoverMin: number;
    journeyMin: number;
    flights: number;
    transfers: number;
  };
  issues: ScheduleIssue[];
  playable: boolean;
}

function point(epochMs: number, zone: string, provenance: TimeProvenance): TimePoint {
  const local = utcToLocal(zone, epochMs);
  return { epochMs, zone, offsetMin: local.offsetMin, local: formatLocalDateTime(local), provenance };
}
const label = (p: TimePoint): string => `${p.local.replace('T', ' ')} ${zoneAbbreviation(p.zone, p.epochMs)}`;

export function computeJourney(input: JourneyInput, opts: ScheduleOptions = {}): Journey {
  const stops = input.stops;
  const n = stops.length;
  const issues: ScheduleIssue[] = [];
  const resolve = (value: LocalTimeInput | null, stop: number, field: 'arrival' | 'departure'): TimePoint | null => {
    if (!value) return null;
    const airport = stops[stop].airport;
    const where = `Stop ${stop + 1} (${displayCity(airport)})`;
    const issue = (code: IssueCode, severity: IssueSeverity, message: string, options?: ScheduleIssue['options']) => {
      issues.push({ code, severity, message, stop, field, ...(options ? { options } : {}) });
    };
    if ((field === 'arrival' && stop === 0) || (field === 'departure' && stop === n - 1)) {
      issue('ignored_time', 'warning', `${where}: ${field} isn't used at this end of the journey.`);
      return null;
    }
    const year = /^(\d{4})-/.exec(value.local);
    if (year && (+year[1] < MIN_YEAR || +year[1] > MAX_YEAR)) {
      issue('date_out_of_range', 'error', `${where}: use a date from ${MIN_YEAR} to ${MAX_YEAR}.`);
      return null;
    }
    if (parseLocalDate(value.local)) {
      issue('time_missing', 'warning', `${where}: add a ${field} time to ${value.local}.`);
      return null;
    }
    const local = parseLocalDateTime(value.local);
    if (!local) {
      issue('invalid_time', 'error', `${where}: enter a valid local date and time for ${field}.`);
      return null;
    }
    const zone = stops[stop].zone;
    if (!zone || !isSupportedTimeZone(zone)) {
      issue(
        zone ? 'timezone_unsupported' : 'timezone_unknown',
        'error',
        `${where}: ${zone ? `time zone ${zone} isn't supported` : 'the time zone is unknown'}.`,
      );
      return null;
    }
    const resolution = resolveLocal(zone, local);
    if (resolution.kind === 'nonexistent') {
      // Express the gap in wall-clock coordinates; gap edges have different offsets.
      const edge = resolution.after.epochMs;
      const before = new Date(edge + resolution.before.offsetMin * 60000).toISOString().slice(11, 16);
      const after = new Date(edge + resolution.after.offsetMin * 60000).toISOString().slice(11, 16);
      issue(
        'nonexistent_local_time',
        'error',
        `${where}: ${value.local.replace('T', ' ')} doesn't exist in ${displayCity(airport)}: clocks jump from ${before} to ${after}.`,
      );
      return null;
    }
    const candidates = resolution.kind === 'exact' ? [resolution.time] : resolution.options;
    const chosen = value.offsetMin === null ? candidates[0] : candidates.find((c) => c.offsetMin === value.offsetMin);
    if (resolution.kind === 'ambiguous' && value.offsetMin === null) {
      issue(
        'ambiguous_local_time',
        'warning',
        `${where}: ${value.local.replace('T', ' ')} occurs twice; using the earlier time. Choose an offset.`,
        candidates.map((c) => ({
          offsetMin: c.offsetMin,
          label: `${value.local.slice(11, 16)} ${zoneAbbreviation(zone, c.epochMs)} (${formatOffset(c.offsetMin)})`,
        })),
      );
    }
    if (!chosen) {
      const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
      const equivalent = Number.isFinite(value.offsetMin)
        ? point(wall - value.offsetMin! * 60000, zone, 'entered')
        : null;
      issue(
        'offset_mismatch',
        'error',
        `${where}: ${formatOffset(value.offsetMin ?? 0)} isn't a valid offset for this local time; use ${candidates.map((c) => formatOffset(c.offsetMin)).join(' or ')}.${equivalent ? ` That instant is ${label(equivalent)} locally.` : ''}`,
      );
      return null;
    }
    return point(chosen.epochMs, zone, 'entered');
  };
  const arr = stops.map((s, i) => resolve(s.arrival, i, 'arrival'));
  const dep = stops.map((s, i) => resolve(s.departure, i, 'departure'));
  const dated = [...arr, ...dep].some((p) => p !== null);
  const legs: JourneyLeg[] = stops.slice(1).map((to, index) => {
    const from = stops[index];
    const distanceKm = greatCircleDistanceKm(from.airport, to.airport);
    return {
      id: `L${index + 1}`,
      index,
      fromStop: index,
      toStop: index + 1,
      from: from.airport,
      to: to.airport,
      distanceKm,
      estimatedMin: estimateFlightMinutes(distanceKm, opts.flightModel),
      departure: null,
      arrival: null,
      durationMin: null,
      durationSource: null,
    };
  });
  // Keep dependency edges separately from public points: equal durations alone don't prove provenance.
  const edges = new Set<string>();
  const derived = (base: TimePoint | null, stop: number, delta: number): TimePoint | null => {
    if (!base) return null;
    const zone = stops[stop].zone;
    // UTC is a display fallback only; entered values still report missing/unsupported zones above.
    return point(
      base.epochMs + delta * 60000,
      zone && isSupportedTimeZone(zone) ? zone : 'UTC',
      base.provenance === 'assumed' ? 'assumed' : 'estimated',
    );
  };
  const forward = () => {
    for (let s = 0; s < n; s++) {
      if (s > 0 && !arr[s] && dep[s - 1]) {
        arr[s] = derived(dep[s - 1], s, legs[s - 1].estimatedMin ?? 0);
        edges.add(`L${s}`);
      }
      if (s < n - 1 && !dep[s] && arr[s]) {
        dep[s] = derived(arr[s], s, stops[s].layoverMin ?? DEFAULT_LAYOVER_MIN);
        edges.add(`T${s}`);
      }
    }
  };
  forward();
  for (let s = n - 2; s >= 0; s--) {
    if (!dep[s] && arr[s + 1]) {
      dep[s] = derived(arr[s + 1], s, -(legs[s].estimatedMin ?? 0));
      edges.add(`L${s + 1}`);
    }
    if (s >= 1 && !arr[s] && dep[s]) {
      arr[s] = derived(dep[s], s, -(stops[s].layoverMin ?? DEFAULT_LAYOVER_MIN));
      edges.add(`T${s}`);
    }
  }
  if (!dated && n > 1 && opts.assumedStart != null && Number.isFinite(opts.assumedStart)) {
    const zone = stops[0].zone;
    dep[0] = point(opts.assumedStart, zone && isSupportedTimeZone(zone) ? zone : 'UTC', 'assumed');
    forward();
  }
  for (const leg of legs) {
    leg.departure = dep[leg.fromStop];
    leg.arrival = arr[leg.toStop];
    if (!leg.departure || !leg.arrival) continue;
    leg.durationMin = (leg.arrival.epochMs - leg.departure.epochMs) / 60000;
    leg.durationSource =
      leg.departure.provenance === 'entered' && leg.arrival.provenance === 'entered'
        ? 'entered'
        : edges.has(leg.id)
          ? 'estimated'
          : 'mixed';
    if (leg.distanceKm >= 1 && leg.durationMin <= 0)
      issues.push({
        code: 'negative_flight_time',
        severity: 'error',
        leg: leg.index,
        message: `Flight ${leg.index + 1}: arrival (${label(leg.arrival)}) must follow departure (${label(leg.departure)}).`,
      });
    const estimate = leg.estimatedMin ?? 0;
    if (
      leg.durationSource !== 'estimated' &&
      (leg.durationMin < 0.6 * estimate - 20 || leg.durationMin > 1.6 * estimate + 60)
    )
      issues.push({
        code: 'unusual_flight_time',
        severity: 'warning',
        leg: leg.index,
        message: `Flight ${leg.index + 1}: ${formatDuration(leg.durationMin)} differs from the estimate of ${formatDuration(estimate)}. Check the local times.`,
      });
  }
  const transfers: JourneyTransfer[] = stops.slice(1, -1).map((s, i) => {
    const stop = i + 1;
    const arrival = arr[stop],
      departure = dep[stop];
    const minutes =
      arrival && departure ? (departure.epochMs - arrival.epochMs) / 60000 : (s.layoverMin ?? DEFAULT_LAYOVER_MIN);
    const transfer: JourneyTransfer = {
      id: `T${stop}`,
      stop,
      airport: s.airport,
      arrival,
      departure,
      minutes,
      source: arrival && departure && !edges.has(`T${stop}`) ? 'times' : 'setting',
      custom: s.layoverMin !== null && s.layoverMin !== DEFAULT_LAYOVER_MIN,
    };
    if (minutes < 0)
      issues.push({
        code: 'connection_overlap',
        severity: 'error',
        stop,
        message: `Stop ${stop + 1} (${displayCity(s.airport)}): departure${departure ? ` (${label(departure)})` : ''} is before arrival${arrival ? ` (${label(arrival)})` : ''}.`,
      });
    else if (minutes < 20)
      issues.push({
        code: 'short_connection',
        severity: 'warning',
        stop,
        message: `Stop ${stop + 1} (${displayCity(s.airport)}): only ${formatDuration(minutes)} to connect.`,
      });
    else if (minutes > 7 * 1440)
      issues.push({
        code: 'long_layover',
        severity: 'warning',
        stop,
        message: `Stop ${stop + 1} (${displayCity(s.airport)}): this connection lasts ${formatDuration(minutes)}.`,
      });
    return transfer;
  });
  if ([...arr, ...dep].some((p) => p?.provenance === 'entered' && p.epochMs > (opts.now ?? Date.now())))
    issues.push({
      code: 'future_rules',
      severity: 'info',
      message: "Future times use today's time-zone rules, which can change",
    });
  const start = dep[0] ?? null,
    end = arr[n - 1] ?? null;
  const flightMin = legs.reduce((sum, l) => sum + (l.durationMin ?? l.estimatedMin ?? 0), 0);
  const layoverMin = transfers.reduce((sum, t) => sum + t.minutes, 0);
  return {
    version: JOURNEY_MODEL_VERSION,
    id: input.id,
    stops,
    legs,
    transfers,
    dated,
    start,
    end,
    totals: {
      distanceKm: legs.reduce((sum, l) => sum + l.distanceKm, 0),
      flightMin,
      layoverMin,
      journeyMin: start && end ? (end.epochMs - start.epochMs) / 60000 : flightMin + layoverMin,
      flights: legs.length,
      transfers: transfers.length,
    },
    issues,
    playable: legs.length > 0 && start !== null && end !== null && !issues.some((i) => i.severity === 'error'),
  };
}
