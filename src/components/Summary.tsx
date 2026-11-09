import { useI18n } from '../i18n/I18nProvider.tsx';
import { useId, useState } from 'react';
import { DEFAULT_FLIGHT_TIME_MODEL, sumDurations } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';

import type { DistanceUnit, Layover, Leg } from '../types.ts';
import type { Journey } from '../lib/schedule.ts';
import { airportCode } from '../data/airports.ts';

import { IconAlert, IconDetour, IconInfo } from './Icons.tsx';
import { airspaceWarning, detourKm, keepTogether } from './airspaceText.ts';

interface SummaryProps {
  journey: Journey;
  onCheckLeg: (leg: number) => void;
  legs: Leg[];
  layovers: Layover[];
  unit: DistanceUnit;
  /** Present while airspace avoidance is on. */
  airspace?: { reviewed: string | null; failed: boolean } | null;
  /** The primary action beside the totals (Play), if any. */
  action?: React.ReactNode;
}

/** Journey totals, pinned to the bottom of the panel like the total on a ticket. */
export function Summary({ journey, onCheckLeg, legs, layovers, unit, airspace, action }: SummaryProps) {
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
  // One line, only when avoidance changes something: a flight it can't protect, or the extra distance.
  const unprotected = legs.findIndex((leg) => airspaceWarning(leg.route));
  const extraKm = legs.reduce((sum, leg) => sum + detourKm(leg.route), 0);
  const airspaceNote = airspace?.failed
    ? { warn: true, text: t('airspace.unavailable') }
    : unprotected >= 0
      ? {
          warn: true,
          text: flights === 1 ? t('airspace.notAvoided') : t('airspace.notAvoidedOnFlight', unprotected + 1),
        }
      : extraKm >= 1
        ? { warn: false, text: t('airspace.summaryDetour', keepTogether(fmt.distance(extraKm, unit))) }
        : null;
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
      {airspaceNote ? (
        <p className={`summary__airspace${airspaceNote.warn ? ' is-warning' : ''}`}>
          {airspaceNote.warn ? <IconAlert size={14} /> : <IconDetour size={14} />}
          <span>{airspaceNote.text}</span>
        </p>
      ) : null}
      {issue ? (
        <button type="button" className="text-btn schedule-error" onClick={() => onCheckLeg(issueLeg)}>
          {t('summary.checkTimes', issueLeg + 1)}
        </button>
      ) : null}
      <div id={infoId} className="summary__info" hidden={!showInfo}>
        <p>{t('summary.method', speed, m.overheadMinutes)}</p>
        <p>{t('summary.connectionMethod', fmt.layover(DEFAULT_LAYOVER_MIN))}</p>
        {airspace?.reviewed ? <p>{t('summary.airspaceMethod', fmt.shortDate(airspace.reviewed))}</p> : null}
      </div>
    </section>
  );
}
