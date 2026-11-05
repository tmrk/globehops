import type { DistanceUnit } from '../types.ts';
import { airportCode, airportShortName, displayCity } from '../data/airports.ts';
import type { Journey, JourneyLeg } from './schedule.ts';
import type { JourneyState } from './timeline.ts';
import { formatDuration } from './flightTime.ts';
import { formatClock, localDayDifference, parseLocalDateTime, zoneAbbreviation } from './timezone.ts';

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
