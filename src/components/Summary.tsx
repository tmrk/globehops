import { useI18n } from '../i18n/I18nProvider.tsx';
import { useId, useState } from 'react';
import { DEFAULT_FLIGHT_TIME_MODEL, sumDurations } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';

import type { DistanceUnit, Layover, Leg } from '../types.ts';
import type { Journey } from '../lib/schedule.ts';
import { airportCode } from '../data/airports.ts';

import { IconAlert, IconDetour, IconDiversion, IconInfo } from './Icons.tsx';
import { routingNotes, type RoutingStatus } from './airspaceText.ts';
import { DEFAULT_DIVERSION_PROFILE, diversionRadiusKm } from '../lib/diversion.ts';

interface SummaryProps {
  journey: Journey;
  onCheckLeg: (leg: number) => void;
  legs: Leg[];
  layovers: Layover[];
  unit: DistanceUnit;
  /** Route avoidance and diversion-aware routing, while each is on; `reviewed` dates the airspace list. */
  routing?: RoutingStatus & { reviewed: string | null };
  /** The primary action beside the totals (Play), if any. */
  action?: React.ReactNode;
}

/** Journey totals, pinned to the bottom of the panel like the total on a ticket. */
export function Summary({ journey, onCheckLeg, legs, layovers, unit, routing, action }: SummaryProps) {
  const { t, fmt } = useI18n();

  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();
  const totalKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  const flightMin = journey.dated ? journey.totals.flightMin : sumDurations(legs.map((l) => l.durationMin));
  const groundMin = journey.dated ? journey.totals.layoverMin : layovers.reduce((s, l) => s + l.minutes, 0);
  const totalMin = flightMin ? flightMin + groundMin : 0;
  const flights = legs.length;
  const estimated =
    !journey.dated ||
    journey.legs.some((l) => l.departure?.provenance !== 'entered' || l.arrival?.provenance !== 'entered');
  const m = DEFAULT_FLIGHT_TIME_MODEL;
  const speed =
    unit === 'km' ? `${fmt.number(m.cruiseSpeedKmh)} km/h` : `${Math.round(m.cruiseSpeedKmh / 1.609344 / 5) * 5} mph`;

  const timeLabel = journey.dated
    ? t('summary.journeyTime')
    : layovers.length
      ? t('summary.totalTime')
      : t('summary.flightTime');
  // Each part stays whole, so a narrow column breaks only between flying and ground time.
  const breakdown = layovers.length ? (
    <>
      <span className="nowrap">{t('summary.flying', fmt.duration(flightMin))}</span> ·{' '}
      <span className="nowrap">
        {fmt.duration(groundMin)} {layovers.length === 1 ? t('summary.layover') : t('summary.inLayovers')}
      </span>
    </>
  ) : null;
  const destination = journey.stops.at(-1)?.airport;
  const dates =
    journey.dated && journey.start && journey.end && destination
      ? {
          departs: t(
            'summary.departure',
            fmt.clock(journey.start.epochMs, journey.start.zone, { weekday: true, date: true }).replace(',', ''),
            airportCode(journey.stops[0].airport),
          ),
          arrives: t('summary.arrival', fmt.clock(journey.end.epochMs, journey.end.zone), airportCode(destination)),
        }
      : null;
  // A line only when routing changes something: a flight it can't protect, or the extra distance.
  const notes = routing
    ? routingNotes(
        legs.map((leg) => leg.route),
        unit,
        routing,
        { t, fmt },
      )
    : [];
  const issue = journey.issues.find((i) => i.severity === 'error');
  const issueLeg = issue?.leg ?? (issue?.field === 'arrival' ? Math.max(0, (issue.stop ?? 1) - 1) : (issue?.stop ?? 0));

  // Justified like the total on a ticket: distance flush left and time flush right, or, beside Play,
  // two even columns. Each stat stays one group in reading order; CSS places its parts on shared
  // label, value and detail rows, with departure and arrival spread across the full width below.
  return (
    <section className="summary" aria-label={t('summary.journeyTotals')}>
      <div className={`summary__grid${action ? ' has-action' : ''}`}>
        <div className="stat">
          <span className="stat__label">{flights > 1 ? t('summary.totalDistance') : t('summary.distance')}</span>
          <span className="stat__value">
            {flights ? fmt.distanceNumber(totalKm, unit) : '—'}
            <span className="stat__unit">{unit}</span>
          </span>
          {flights !== 1 && (
            <span className="stat__detail">
              {flights ? t('summary.flights', fmt.number(flights)) : t('summary.chooseTwoAirports')}
            </span>
          )}
        </div>
        <div className="stat stat--end">
          <span className="stat__label">
            {timeLabel}
            <button
              type="button"
              className="info-btn"
              aria-expanded={showInfo}
              aria-controls={infoId}
              aria-label={t('summary.howTimesAreEstimated')}
              onClick={() => setShowInfo((v) => !v)}
            >
              <IconInfo size={14} />
            </button>
          </span>
          <span className="stat__value">
            {flights && totalMin ? `${estimated ? '≈ ' : ''}${fmt.duration(totalMin)}` : '—'}
          </span>
          {breakdown && <span className="stat__detail">{breakdown}</span>}
        </div>
        {action ? <div className="summary__action">{action}</div> : null}
        {dates ? (
          <p className="summary__dates">
            <span>{dates.departs}</span> <span>{dates.arrives}</span>
          </p>
        ) : null}
      </div>
      {notes.map((note) => (
        <p key={note.kind} className={`summary__airspace${note.warn ? ' is-warning' : ''}`}>
          {note.warn ? (
            <IconAlert size={14} />
          ) : note.kind === 'diversion' ? (
            <IconDiversion size={14} />
          ) : (
            <IconDetour size={14} />
          )}
          <span>{note.text}</span>
        </p>
      ))}
      {issue ? (
        <button type="button" className="text-btn schedule-error" onClick={() => onCheckLeg(issueLeg)}>
          {t('summary.checkTimes', issueLeg + 1)}
        </button>
      ) : null}
      <div id={infoId} className="summary__info" hidden={!showInfo}>
        <p>{t('summary.method', speed, m.overheadMinutes)}</p>
        <p>{t('summary.connectionMethod', fmt.layover(DEFAULT_LAYOVER_MIN))}</p>
        {routing?.airspace && routing.reviewed ? (
          <p>{t('summary.airspaceMethod', fmt.shortDate(routing.reviewed))}</p>
        ) : null}
        {routing?.diversion ? <DiversionMethod unit={unit} /> : null}
      </div>
    </section>
  );
}

/** The assumed diversion profile, in the reader's units: minutes, one-engine speed and the reach it gives. */
export function DiversionMethod({ unit }: { unit: DistanceUnit }) {
  const { t, fmt } = useI18n();
  const profile = DEFAULT_DIVERSION_PROFILE;
  const speed =
    unit === 'km'
      ? `${fmt.number(Math.round((profile.oeiSpeedKt * 1.852) / 10) * 10)} km/h`
      : `${fmt.number(profile.oeiSpeedKt)} kt`;
  const reach = fmt.distance(Math.round(diversionRadiusKm(profile) / 10) * 10, unit);
  return <p>{t('summary.diversionMethod', fmt.number(profile.maxDiversionMin), speed, reach)}</p>;
}
