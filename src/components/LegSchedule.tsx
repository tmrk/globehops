import { useState } from 'react';
import { airportShortName, displayCity } from '../data/airports.ts';
import { formatDuration } from '../lib/flightTime.ts';
import type { Journey, JourneyLeg, TimePoint } from '../lib/schedule.ts';
import {
  isSupportedTimeZone,
  formatClock,
  formatLocalDateTime,
  formatOffset,
  offsetMinutesAt,
  utcToLocal,
  zoneAbbreviation,
} from '../lib/timezone.ts';
import type { LocalTimeInput } from '../types.ts';
import { IconClose } from './Icons.tsx';

interface Props {
  journey: Journey;
  leg: JourneyLeg;
  onChange: (stop: number, field: 'departure' | 'arrival', value: LocalTimeInput | null) => void;
}
export function LegSchedule({ journey, leg, onChange }: Props) {
  const [now] = useState(Date.now);
  const fields = [
    {
      field: 'departure' as const,
      stop: leg.fromStop,
      point: leg.departure,
      title: 'Departs',
      group: 'Departure from',
    },
    { field: 'arrival' as const, stop: leg.toStop, point: leg.arrival, title: 'Arrives', group: 'Arrival at' },
  ];
  const issues = journey.issues.filter(
    (i) =>
      i.leg === leg.index || (i.leg === undefined && (i.stop === undefined || fields.some((f) => f.stop === i.stop))),
  );
  const hint = (point: TimePoint) =>
    `≈ ${formatClock(point.epochMs, point.zone)} · ${formatClock(point.epochMs, point.zone, { weekday: true, date: true }).split(',')[0]}, estimated`;
  return (
    <section id={`leg-schedule-${leg.index}`} className="leg-schedule" aria-label={`Flight ${leg.index + 1} times`}>
      <div className="leg-schedule__fields">
        {fields.map(({ field, stop, point, title, group }) => {
          const input = journey.stops[stop][field];
          const { airport, zone: assignedZone } = journey.stops[stop];
          const zone = assignedZone && isSupportedTimeZone(assignedZone) ? assignedZone : null;
          const instant = point?.epochMs ?? now;
          const date = input?.local.slice(0, 10) ?? '';
          const time = input?.local.slice(11, 16) ?? '';
          const change = (part: 'date' | 'time', value: string) => {
            const nextDate =
              part === 'date'
                ? value
                : date ||
                  point?.local.slice(0, 10) ||
                  (zone ? formatLocalDateTime(utcToLocal(zone, Date.now())).slice(0, 10) : '');
            const nextTime = part === 'time' ? value : time;
            onChange(
              stop,
              field,
              nextDate ? { local: `${nextDate}${nextTime ? `T${nextTime}` : ''}`, offsetMin: null } : null,
            );
          };
          return (
            <fieldset key={field} disabled={!zone} aria-label={`${group} ${airportShortName(airport)}, local time`}>
              <legend>
                {title} {displayCity(airport)}
              </legend>
              <div className="leg-schedule__inputs">
                <input
                  type="date"
                  aria-label={`${field === 'departure' ? 'Departure' : 'Arrival'} date`}
                  min="1900-01-01"
                  max="2100-12-31"
                  value={date}
                  onChange={(e) => change('date', e.target.value)}
                />
                <input
                  type="time"
                  aria-label={`${field === 'departure' ? 'Departure' : 'Arrival'} time`}
                  value={time}
                  onChange={(e) => change('time', e.target.value)}
                />
                {input && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--small"
                    aria-label={`Clear ${field} time`}
                    onClick={() => onChange(stop, field, null)}
                  >
                    <IconClose size={14} />
                  </button>
                )}
              </div>
              <p className="leg-schedule__zone">
                {zone
                  ? zoneCaption(zone, instant)
                  : assignedZone
                    ? 'Time zone unavailable in this browser'
                    : 'Time zone unknown for this airport'}
              </p>
              {date && !time ? (
                <p className="leg-schedule__hint">Add a time</p>
              ) : !input && journey.dated && point ? (
                <p className="leg-schedule__hint">{hint(point)}</p>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <p className="leg-schedule__duration">
        {leg.departure?.provenance === 'entered' && leg.arrival?.provenance === 'entered'
          ? `Scheduled ${formatDuration(leg.durationMin ?? 0)} · estimate ≈ ${formatDuration(leg.estimatedMin ?? 0)}`
          : `Estimated ≈ ${formatDuration(leg.estimatedMin ?? 0)}`}
      </p>
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
      <p className="leg-schedule__foot">Local time at each airport. Estimates aren't airline schedules.</p>
    </section>
  );
}

/** "Local · CET, UTC+1"; the offset is not repeated when the zone has no abbreviation ("Local · UTC+5:30"). */
function zoneCaption(zone: string, instant: number): string {
  const abbreviation = zoneAbbreviation(zone, instant);
  const offset = formatOffset(offsetMinutesAt(zone, instant));
  return `Local · ${abbreviation === offset ? offset : `${abbreviation}, ${offset}`}`;
}
