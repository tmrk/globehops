import { useState } from 'react';
import { airportCode, displayCity } from '../data/airports.ts';
import { formatDuration } from '../lib/flightTime.ts';
import { formatDateLabel, formatZoneLabel } from '../lib/journeyText.ts';
import type { Journey, JourneyLeg } from '../lib/schedule.ts';
import { formatLocalDateTime, isSupportedTimeZone, utcToLocal } from '../lib/timezone.ts';
import type { LocalTimeInput } from '../types.ts';
import { DateTimeField } from './DateTimeField.tsx';
import { IconClose } from './Icons.tsx';

interface Props {
  journey: Journey;
  leg: JourneyLeg;
  onChange: (stop: number, field: 'departure' | 'arrival', value: LocalTimeInput | null) => void;
  onClose: () => void;
}

/**
 * Departure and arrival of one flight, each in its airport's local time. Empty fields show the
 * estimate derived from the rest of the journey, so the whole schedule is visible and any value can
 * be overridden by tapping it. Instants and durations are computed in UTC by the schedule model.
 */
export function LegSchedule({ journey, leg, onChange, onClose }: Props) {
  const [now] = useState(Date.now);
  const rows = [
    { field: 'departure' as const, stop: leg.fromStop, point: leg.departure, verb: 'Depart', noun: 'Departure' },
    { field: 'arrival' as const, stop: leg.toStop, point: leg.arrival, verb: 'Arrive', noun: 'Arrival' },
  ];
  // The time fields themselves show a missing time; the text warning would only repeat it.
  const issues = journey.issues.filter(
    (i) =>
      i.code !== 'time_missing' &&
      (i.leg === leg.index || (i.leg === undefined && (i.stop === undefined || rows.some((r) => r.stop === i.stop)))),
  );
  const entered = leg.departure?.provenance === 'entered' && leg.arrival?.provenance === 'entered';
  return (
    <section id={`leg-schedule-${leg.index}`} className="leg-schedule" aria-label={`Flight ${leg.index + 1} times`}>
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
          <div key={field} className={`when when--${state}`} role="group" aria-label={`${noun}, local time`}>
            <div className="when__head">
              <span className="when__verb">{verb}</span>
              <span className="when__place">
                <span className="when__code">{airportCode(airport)}</span> {displayCity(airport)}
              </span>
              {zone && (
                <span className="when__zone" title={zone}>
                  {formatZoneLabel(zone, point?.epochMs ?? now)}
                </span>
              )}
            </div>
            <div className="when__fields">
              <DateTimeField
                kind="date"
                label={`${noun} date`}
                value={date || suggestedDate}
                display={formatDateLabel(date || suggestedDate)}
                placeholder="Add date"
                estimated={!date && !!suggestedDate}
                disabled={!zone}
                onChange={(value) => {
                  if (value) commit(value, time || suggestedTime);
                  else if (input) commit('', '');
                }}
              />
              <DateTimeField
                kind="time"
                label={`${noun} time`}
                value={time || suggestedTime}
                display={time || suggestedTime}
                placeholder={date ? 'Add a time' : 'Add time'}
                estimated={!time && !!suggestedTime}
                attention={!!date && !time}
                disabled={!zone}
                onChange={(value) => {
                  if (value) commit(date || suggestedDate || today(), value);
                  else if (date) commit(date, '');
                }}
              />
              {input ? (
                <button
                  type="button"
                  className="icon-btn icon-btn--quiet icon-btn--small when__clear"
                  aria-label={`Clear ${field} time`}
                  onClick={() => onChange(stop, field, null)}
                >
                  <IconClose size={14} />
                </button>
              ) : (
                <span className="when__clear" aria-hidden="true" />
              )}
            </div>
            {!zone ? (
              <p className="when__note">
                {assignedZone ? 'Time zone unavailable in this browser' : 'Time zone unknown for this airport'}
              </p>
            ) : (
              suggestion && (
                <p className="when__note">
                  {suggestion.provenance === 'assumed'
                    ? 'Example departure · set your own'
                    : 'Estimated from your other times'}
                </p>
              )
            )}
          </div>
        );
      })}
      <div className="leg-schedule__foot">
        <p className="leg-schedule__duration">
          {entered
            ? `Scheduled ${formatDuration(leg.durationMin ?? 0)} · estimate ≈ ${formatDuration(leg.estimatedMin ?? 0)}`
            : `Flight ≈ ${formatDuration(leg.estimatedMin ?? 0)}, estimated`}
        </p>
        <button type="button" className="text-btn leg-schedule__done" onClick={onClose}>
          Done
        </button>
      </div>
      {issues.map((issue, index) => (
        <div key={index} className={`schedule-issue schedule-issue--${issue.severity}`}>
          <p>{issue.message}</p>
          {issue.code === 'ambiguous_local_time' &&
            issue.options?.map((option) => (
              <button
                type="button"
                className="suggestion"
                key={option.offsetMin}
                aria-pressed={journey.stops[issue.stop!][issue.field!]?.offsetMin === option.offsetMin}
                onClick={() => {
                  const value = journey.stops[issue.stop!][issue.field!];
                  if (value) onChange(issue.stop!, issue.field!, { ...value, offsetMin: option.offsetMin });
                }}
              >
                {option.label}
              </button>
            ))}
        </div>
      ))}
    </section>
  );
}
