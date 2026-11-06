import { airportCode, airportShortName, displayCity } from '../data/airports.ts';
import { sumDurations } from '../lib/flightTime.ts';
import type { Journey, ScheduleIssue } from '../lib/schedule.ts';
import type { JourneyState } from '../lib/timeline.ts';
import { zoneAbbreviation } from '../lib/timezone.ts';
import type { Airport, DistanceUnit, Layover, Leg } from '../types.ts';
import type { Translate } from './catalogue.ts';
import { formatters } from './format.ts';
import type { Locale } from './locales.ts';

// The optional city callback is the exonym integration seam, shared by all UI-derived text.
export function uiFormatters(locale: Locale, t: Translate, city = formatters(locale).city) {
  const fmt = { ...formatters(locale), city };
  const airportName = (airport: Airport) => {
    if (locale !== 'en') return fmt.city(airport);
    const name = airportShortName(airport);
    const originalCity = displayCity(airport).split(',')[0].trim();
    return name.startsWith(originalCity)
      ? fmt.city(airport).split(',')[0].trim() + name.slice(originalCity.length)
      : name;
  };
  return {
    ...fmt,
    stopCaption: (index: number, count: number) =>
      t(index === 0 ? 'stops.from' : index === count - 1 ? 'stops.to' : 'stops.via'),
    stopPlaceholder: (index: number, count: number) =>
      t(index === 0 ? 'stops.whereFrom' : index === count - 1 ? 'stops.whereTo' : 'stops.add'),
    stopLabel: (index: number, count: number) =>
      index === 0
        ? t('stops.departureAirport')
        : index === count - 1
          ? t('stops.destinationAirport')
          : t('stops.stop', fmt.number(index)),
    describeState: (j: Journey, state: JourneyState): { title: string; detail: string } => {
      switch (state.phase) {
        case 'before':
          return {
            title: t('journey.before', airportName(j.stops[0].airport)),
            detail: t(
              'journey.departs',
              fmt.clock(state.nextDeparture, j.start?.zone ?? 'UTC'),
              zoneAbbreviation(j.start?.zone ?? 'UTC', state.nextDeparture),
            ),
          };
        case 'flight':
          return {
            title: t('journey.flight', state.leg + 1, j.legs.length, airportName(j.legs[state.leg].to)),
            detail: t(
              'journey.progress',
              fmt.number(Math.round(state.timeFraction * 100)),
              fmt.duration(state.remainingMin),
            ),
          };
        case 'transfer':
          return {
            title: t('journey.transfer', airportName(j.stops[state.stop].airport)),
            detail: t('journey.nextFlight', fmt.duration(state.untilDepartureMin)),
          };
        case 'after':
          return { title: t('journey.after', airportName(j.stops[state.stop].airport)), detail: t('journey.complete') };
      }
    },
    clockZoneOptions: (journey: Journey, browserZone: string) => {
      const options = [
        { value: 'local', label: t('timebar.yourTime', zoneAbbreviation(browserZone, journey.start?.epochMs ?? 0)) },
        { value: 'utc', label: 'UTC' },
      ];
      const zones = new Set([browserZone, 'UTC']);
      for (const stop of journey.stops) {
        if (!stop.zone || zones.has(stop.zone)) continue;
        zones.add(stop.zone);
        options.push({ value: airportCode(stop.airport), label: t('timebar.placeTime', fmt.city(stop.airport)) });
      }
      return options;
    },
    describeRoute: (legs: Leg[], layovers: Layover[], unit: DistanceUnit) => {
      if (!legs.length) return t('journey.empty');
      const names = [legs[0].from, ...legs.map((leg) => leg.to)].map(fmt.city);
      const minutes = sumDurations(legs.map((leg) => leg.durationMin));
      const ground = layovers.reduce((sum, layover) => sum + layover.minutes, 0);
      return t(
        legs.length === 1 ? 'journey.routeOne' : 'journey.route',
        names.join(' → '),
        fmt.number(legs.length),
        fmt.distance(
          legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
          unit,
        ),
        minutes
          ? ground
            ? t('journey.estimatedTime', fmt.duration(minutes + ground), fmt.duration(ground))
            : t('journey.flightTime', fmt.duration(minutes))
          : '',
      );
    },
    issue: (issue: ScheduleIssue, journey: Journey): string => {
      if (locale === 'en') return issue.message;
      const leg = issue.leg !== undefined ? journey.legs[issue.leg] : undefined;
      const transfer =
        issue.stop !== undefined ? journey.transfers.find((item) => item.stop === issue.stop) : undefined;
      const detail = t(
        `issues.${issue.code}`,
        fmt.duration(leg?.durationMin ?? transfer?.minutes ?? 0),
        fmt.duration(leg?.estimatedMin ?? 0),
      );
      if (issue.leg !== undefined) return t('issues.flight', fmt.number(issue.leg + 1), detail);
      if (issue.stop !== undefined)
        return t('issues.stop', fmt.number(issue.stop + 1), fmt.city(journey.stops[issue.stop].airport), detail);
      return detail;
    },
    build: (commit: string, date: string) => {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? fmt.shortDate(date) : '';
      return [commit ? t('common.build', commit) : '', day].filter(Boolean).join(', ');
    },
  };
}
