import { useI18n } from '../i18n/I18nProvider.tsx';
import { useEffect, useRef, useState } from 'react';
import { airportCode } from '../data/airports.ts';

import type { Journey, JourneyLeg } from '../lib/schedule.ts';
import { formatLocalDateTime, isSupportedTimeZone, utcToLocal } from '../lib/timezone.ts';
import type { LocalTimeInput } from '../types.ts';
import { DateTimeField } from './DateTimeField.tsx';
import { IconAlert, IconClose, IconDetour } from './Icons.tsx';
import { airspaceWarning, legAirspaceNote } from './airspaceText.ts';
import type { DistanceUnit } from '../types.ts';

interface Props {
  journey: Journey;
  leg: JourneyLeg;
  onChange: (stop: number, field: 'departure' | 'arrival', value: LocalTimeInput | null) => void;
  onClose: () => void;
  unit: DistanceUnit;
}

/**
 * Departure and arrival of one flight, each in its airport's local time. Empty fields show the
 * estimate derived from the rest of the journey, so the whole schedule is visible and any value can
 * be overridden by tapping it. Instants and durations are computed in UTC by the schedule model.
 */
export function LegSchedule({ journey, leg, onChange, onClose, unit }: Props) {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const airspaceNote = legAirspaceNote(leg.route, unit, i18n);
  const sectionRef = useRef<HTMLElement>(null);
  // Reveal the whole editor when a flight opens; on phones it would otherwise start below the fold.
  useEffect(() => {
    const smooth = document.documentElement.dataset.motion !== 'reduce';
    sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }, [leg.index]);

  const [now] = useState(Date.now);
  const rows = [
    {
      field: 'departure' as const,
      stop: leg.fromStop,
      point: leg.departure,
      verb: t('schedule.depart'),
      noun: t('schedule.departure'),
    },
    {
      field: 'arrival' as const,
      stop: leg.toStop,
      point: leg.arrival,
      verb: t('schedule.arrive'),
      noun: t('schedule.arrival'),
    },
  ];
  // The time fields themselves show a missing time; the text warning would only repeat it.
  const issues = journey.issues.filter(
    (i) =>
      i.code !== 'time_missing' &&
      (i.leg === leg.index || (i.leg === undefined && (i.stop === undefined || rows.some((r) => r.stop === i.stop)))),
  );
  const entered = leg.departure?.provenance === 'entered' && leg.arrival?.provenance === 'entered';
  return (
    <section
      ref={sectionRef}
      id={`leg-schedule-${leg.index}`}
      className="leg-schedule"
      aria-label={t('schedule.flightTimes', leg.index + 1)}
    >
      {rows.map(({ field, stop, point, verb, noun }) => {
        const input = journey.stops[stop][field];
        const { airport, zone: assignedZone } = journey.stops[stop];
        const zone = assignedZone && isSupportedTimeZone(assignedZone) ? assignedZone : null;
        const date = input?.local.slice(0, 10) ?? '';
        const time = input?.local.slice(11, 16) ?? '';
        // Derived values (from the other times, or an assumed example start) fill empty fields as suggestions.
        const suggestion = !input && point ? point : null;
        const suggestedDate = suggestion?.local.slice(0, 10) ?? '';
        const suggestedTime = suggestion?.local.slice(11, 16) ?? '';
        const commit = (nextDate: string, nextTime: string) =>
          onChange(
            stop,
            field,
            nextDate ? { local: nextTime ? `${nextDate}T${nextTime}` : nextDate, offsetMin: null } : null,
          );
        const today = () => (zone ? formatLocalDateTime(utcToLocal(zone, Date.now())).slice(0, 10) : '');
        const state = input ? 'entered' : suggestion ? 'estimated' : 'empty';
        return (
          <div key={field} className={`when when--${state}`} role="group" aria-label={t('schedule.localTime', noun)}>
            <div className="when__head">
              <span className="when__verb">{verb}</span>
              <span className="when__place">
                <span className="when__code">{airportCode(airport)}</span> {fmt.city(airport)}
              </span>
              {zone && (
                <span className="when__zone" title={zone}>
                  {fmt.zone(zone, point?.epochMs ?? now)}
                </span>
              )}
              {input && (
                <button
                  type="button"
                  className="when__clear"
                  aria-label={field === 'departure' ? t('schedule.clearDeparture') : t('schedule.clearArrival')}
                  onClick={() => onChange(stop, field, null)}
                >
                  <IconClose size={14} />
                </button>
              )}
            </div>
            <div className="when__fields">
              <DateTimeField
                kind="date"
                label={field === 'departure' ? t('schedule.departureDate') : t('schedule.arrivalDate')}
                value={date || suggestedDate}
                display={fmt.date(date || suggestedDate)}
                placeholder={t('schedule.addDate')}
                estimated={!date && !!suggestedDate}
                disabled={!zone}
                onChange={(value) => {
                  if (value) commit(value, time || suggestedTime);
                  else if (input) commit('', '');
                }}
              />
              <DateTimeField
                kind="time"
                label={field === 'departure' ? t('schedule.departureTime') : t('schedule.arrivalTime')}
                value={time || suggestedTime}
                display={time || suggestedTime}
                placeholder={date ? t('schedule.addATime') : t('schedule.addTime')}
                estimated={!time && !!suggestedTime}
                attention={!!date && !time}
                disabled={!zone}
                onChange={(value) => {
                  if (value) commit(date || suggestedDate || today(), value);
                  else if (date) commit(date, '');
                }}
              />
            </div>
            {!zone ? (
              <p className="when__note">
                {assignedZone
                  ? t('schedule.timeZoneUnavailableInThisBrowser')
                  : t('schedule.timeZoneUnknownForThisAirport')}
              </p>
            ) : (
              suggestion && (
                <p className="when__note">
                  {suggestion.provenance === 'assumed' ? t('schedule.exampleDeparture') : t('schedule.estimated')}
                </p>
              )
            )}
          </div>
        );
      })}
      {airspaceNote && (
        <p className={`leg-schedule__airspace${airspaceWarning(leg.route) ? ' is-warning' : ''}`}>
          {airspaceWarning(leg.route) ? <IconAlert size={14} /> : <IconDetour size={14} />}
          <span>{airspaceNote}</span>
        </p>
      )}
      <div className="leg-schedule__foot">
        <p className="leg-schedule__duration">
          {entered
            ? t('schedule.durationComparison', fmt.duration(leg.durationMin ?? 0), fmt.duration(leg.estimatedMin ?? 0))
            : t('schedule.estimatedFlight', fmt.duration(leg.estimatedMin ?? 0))}
        </p>
        <button type="button" className="text-btn leg-schedule__done" onClick={onClose}>
          {t('schedule.done')}
        </button>
      </div>
      {issues.map((issue, index) => {
        const { stop, field } = issue;
        const input = stop !== undefined && field ? journey.stops[stop][field] : null;
        return (
          <div key={index} className={`schedule-issue schedule-issue--${issue.severity}`}>
            <p>{fmt.issue(issue, journey)}</p>
            {issue.code === 'ambiguous_local_time' &&
              input &&
              stop !== undefined &&
              field &&
              issue.options?.map((option) => (
                <button
                  type="button"
                  className="suggestion"
                  key={option.offsetMin}
                  aria-pressed={input.offsetMin === option.offsetMin}
                  onClick={() => onChange(stop, field, { ...input, offsetMin: option.offsetMin })}
                >
                  {option.label}
                </button>
              ))}
          </div>
        );
      })}
    </section>
  );
}
