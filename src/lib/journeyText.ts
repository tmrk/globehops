import type { DistanceUnit } from '../types.ts';
import { airportCode, airportShortName, displayCity } from '../data/airports.ts';
import type { Journey, JourneyLeg } from './schedule.ts';
import type { JourneyState } from './timeline.ts';
import { formatDuration } from './flightTime.ts';
import {
  formatClock,
  localDayDifference,
  offsetMinutesAt,
  parseLocalDate,
  parseLocalDateTime,
  zoneAbbreviation,
} from './timezone.ts';

export function describeState(
  j: Journey,
  state: JourneyState,
  unitsUnused?: DistanceUnit,
): { title: string; detail: string } {
  void unitsUnused;
  switch (state.phase) {
    case 'before':
      return {
        title: `Ready to depart ${airportShortName(j.stops[0].airport)}`,
        detail: `Departs ${formatClock(state.nextDeparture, j.start?.zone ?? 'UTC')} ${zoneAbbreviation(j.start?.zone ?? 'UTC', state.nextDeparture)}`,
      };
    case 'flight':
      return {
        title: `Flight ${state.leg + 1} of ${j.legs.length} · En route to ${airportShortName(j.legs[state.leg].to)}`,
        detail: `${Math.round(state.timeFraction * 100)}% of flight · ≈ ${formatDuration(state.remainingMin)} to arrival`,
      };
    case 'transfer':
      return {
        title: `Connecting at ${airportShortName(j.stops[state.stop].airport)}`,
        detail: `Next flight in ${formatDuration(state.untilDepartureMin)}`,
      };
    case 'after':
      return { title: `Arrived at ${airportShortName(j.stops[state.stop].airport)}`, detail: 'Journey complete' };
  }
}
export function formatLegTimes(leg: JourneyLeg): { dep: string; arr: string; dayShift: number; estimated: boolean } {
  const dep = leg.departure,
    arr = leg.arrival;
  const a = dep ? parseLocalDateTime(dep.local) : null,
    b = arr ? parseLocalDateTime(arr.local) : null;
  return {
    dep: dep?.local.slice(11, 16) ?? '—',
    arr: arr?.local.slice(11, 16) ?? '—',
    dayShift: a && b ? localDayDifference(a, b) : 0,
    estimated: !dep || !arr || dep.provenance !== 'entered' || arr.provenance !== 'entered',
  };
}
export function clockZoneOptions(journey: Journey, browserZone: string): { value: string; label: string }[] {
  const instant = journey.start?.epochMs ?? 0;
  const options = [
    { value: 'local', label: `Your time (${zoneAbbreviation(browserZone, instant)})` },
    { value: 'utc', label: 'UTC' },
  ];
  const zones = new Set([browserZone, 'UTC']);
  for (const stop of journey.stops) {
    if (!stop.zone || zones.has(stop.zone)) continue;
    zones.add(stop.zone);
    options.push({ value: airportCode(stop.airport), label: `${displayCity(stop.airport)} time` });
  }
  return options;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A calendar date ("2026-11-20") as "Thu 20 Nov 2026"; '' for anything else. Independent of time zones. */
export function formatDateLabel(isoDate: string): string {
  const date = parseLocalDate(isoDate);
  if (!date) return '';
  const utc = new Date(0);
  utc.setUTCFullYear(date.year, date.month - 1, date.day);
  return `${WEEKDAYS[utc.getUTCDay()]} ${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}

/** UTC offset with an explicit sign, including zero: "UTC+1", "UTC−3:30", "UTC+0". */
export function formatUtcOffset(offsetMin: number): string {
  const total = Math.round(Math.abs(offsetMin));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `UTC${offsetMin < 0 ? '−' : '+'}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

/**
 * The zone in effect at an airport at an instant: "CET · UTC+1", "GMT · UTC+0", or only the offset
 * where there is no well-known abbreviation ("UTC+5:30").
 */
export function formatZoneLabel(zone: string, instant: number): string {
  const offset = formatUtcOffset(offsetMinutesAt(zone, instant));
  const abbreviation = zoneAbbreviation(zone, instant);
  return /^(?:UTC|GMT)?[+−-]|^UTC$/.test(abbreviation) ? offset : `${abbreviation} · ${offset}`;
}
