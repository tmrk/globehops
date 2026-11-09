import { Fragment, useId, useState } from 'react';
import { airportCode } from '../data/airports.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { DEFAULT_FLIGHT_TIME_MODEL } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';
import { DEFAULT_STAY_MIN, stayChoices, type Trip, type TripSection } from '../lib/trip.ts';
import type { DistanceUnit } from '../types.ts';
import { IconAlert, IconBed, IconChevronDown, IconDetour, IconDiversion, IconInfo, IconPlay } from './Icons.tsx';
import { routingNotes, type RoutingStatus } from './airspaceText.ts';
import { DiversionMethod } from './Summary.tsx';
import { stayDates, stayLength, stayText } from './tripText.ts';

interface Props {
  trip: Trip;
  names: string[];
  active: number;
  unit: DistanceUnit;
  timeOpen: boolean;
  /** The journey playback is limited to, or null for the whole trip. */
  playScope: number | null;
  /** Route avoidance and diversion-aware routing, while each is on; `reviewed` dates the airspace list. */
  routing: RoutingStatus & { reviewed: string | null };
  onActivate: (index: number) => void;
  onPlayTrip: () => void;
  onPlaySection: (index: number) => void;
  onStayChange: (section: number, minutes: number | null) => void;
  onCheck: (section: number, leg: number | null) => void;
}

/**
 * The whole trip at a glance, pinned like a ticket's total: each journey with its date, route and time,
 * the stays between them, and trip totals beside Play. The journey being edited is pressed; its own
 * Play plays it alone.
 */
export function TripSummary(props: Props) {
  const { trip, names, active, unit, timeOpen, playScope } = props;
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();
  const model = DEFAULT_FLIGHT_TIME_MODEL;
  const staysBefore = new Map(trip.stays.map((stay) => [stay.section, stay]));
  const estimatedDate = (section: TripSection) => section.anchor !== 'entered';
  const date = (section: TripSection) =>
    section.journey.start ? fmt.date(section.journey.start.local.slice(0, 10), { year: false }) : '';
  const duration = (section: TripSection) => {
    const { journey } = section;
    if (!journey.legs.length) return '';
    const minutes =
      journey.start && journey.end ? journey.totals.journeyMin : journey.totals.flightMin + journey.totals.layoverMin;
    const estimated =
      !journey.dated ||
      journey.legs.some((leg) => leg.departure?.provenance !== 'entered' || leg.arrival?.provenance !== 'entered');
    return `${estimated ? '≈ ' : ''}${fmt.duration(minutes)}`;
  };
  const notes = routingNotes(
    trip.sections.flatMap((section) => section.journey.legs.map((leg) => leg.route)),
    unit,
    props.routing,
    i18n,
  );
  // The first problem anywhere in the trip: a journey's times, or journeys that overlap.
  const sectionError = trip.sections.find((s) => s.journey.issues.some((issue) => issue.severity === 'error'));
  const issue = sectionError?.journey.issues.find((i) => i.severity === 'error');
  const errorLeg =
    issue && (issue.leg ?? (issue.field === 'arrival' ? Math.max(0, (issue.stop ?? 1) - 1) : (issue.stop ?? 0)));
  const overlap = trip.issues[0];
  const assumedStay = trip.stays.some((stay) => stay.source === 'setting' && !stay.custom);
  const totalFlying = trip.totals.flightMin;
  // Totals are estimates unless every journey's own entered times fix them.
  const approximate = trip.sections.some((section) =>
    section.journey.legs.some(
      (leg) => leg.departure?.provenance !== 'entered' || leg.arrival?.provenance !== 'entered',
    ),
  );
  const approximateDates = trip.sections.some((s) => s.journey.legs.length > 0 && s.anchor !== 'entered');
  const range =
    trip.start && trip.end ? fmt.dateRange(trip.start.local.slice(0, 10), trip.end.local.slice(0, 10)) : null;
  const canPlay = trip.playable && trip.timeline !== null;
  return (
    <section className="summary trip-summary" aria-label={t('trip.summary')}>
      <div className="trip-summary__rows">
        {trip.sections.map((section, index) => {
          const stay = staysBefore.get(index);
          const codes = section.journey.stops.map((stop) => airportCode(stop.airport));
          const playable = canPlay && section.timeline !== null && (!timeOpen || playScope !== index);
          return (
            <Fragment key={index}>
              {stay && (
                <div className="trip-summary__stay">
                  <span className="trip-summary__icon" aria-hidden="true">
                    <IconBed size={16} />
                  </span>
                  {stay.source === 'setting' ? (
                    <span className="trip-summary__pick">
                      <span className="trip-summary__stay-text" aria-hidden="true">
                        ≈ {stayText(stay, i18n)}
                      </span>
                      <IconChevronDown size={14} className="layover__chev" />
                      <select
                        className="layover__select"
                        aria-label={t('trip.stayAt', fmt.city(stay.arrivalAirport))}
                        value={stay.minutes}
                        onChange={(event) => {
                          const minutes = Number(event.target.value);
                          props.onStayChange(index, minutes === DEFAULT_STAY_MIN ? null : minutes);
                        }}
                      >
                        {stayChoices(Math.round(stay.minutes)).map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {stayLength(minutes, null, i18n)}
                            {minutes === DEFAULT_STAY_MIN ? t('stops.default') : ''}
                          </option>
                        ))}
                      </select>
                    </span>
                  ) : (
                    <span className="trip-summary__stay-text" title={t('stops.fromYourFlightTimes')}>
                      {stayText(stay, i18n)}
                    </span>
                  )}
                  <span className="trip-summary__dates">
                    {stayDates(stay, i18n) && `${stay.source === 'setting' ? '≈ ' : ''}${stayDates(stay, i18n)}`}
                  </span>
                </div>
              )}
              <div className={`trip-summary__item${active === index ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="trip-summary__row"
                  aria-pressed={active === index}
                  onClick={() => props.onActivate(index)}
                >
                  <span className="journey-chip journey-chip--section">{index + 1}</span>
                  <span className="trip-summary__name">{names[index]}</span>
                  <span className="trip-summary__date">
                    {date(section) && `${estimatedDate(section) ? '≈ ' : ''}${date(section)}`}
                  </span>
                  <span className="trip-summary__route">
                    {codes.length ? (
                      codes.join(' → ')
                    ) : (
                      <span className="compare-summary__empty">{t('compare.chooseAirports')}</span>
                    )}
                  </span>
                  <span className="trip-summary__duration">{duration(section)}</span>
                </button>
                {playable && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--quiet trip-summary__play"
                    aria-label={t('trip.playSection', names[index])}
                    title={t('trip.playSection', names[index])}
                    onClick={() => props.onPlaySection(index)}
                  >
                    <IconPlay size={14} />
                  </button>
                )}
              </div>
            </Fragment>
          );
        })}
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
      {issue && sectionError ? (
        <button
          type="button"
          className="text-btn schedule-error"
          onClick={() => props.onCheck(sectionError.index, errorLeg ?? null)}
        >
          {`${names[sectionError.index]} · ${t('summary.checkTimes', (errorLeg ?? 0) + 1)}`}
        </button>
      ) : overlap ? (
        <button type="button" className="text-btn schedule-error" onClick={() => props.onCheck(overlap.section, null)}>
          {t('trip.departsBefore', names[overlap.section])}
        </button>
      ) : null}
      <div className="compare-summary__foot trip-summary__foot">
        <button
          type="button"
          className="info-btn"
          aria-label={t('summary.howTimesAreEstimated')}
          aria-expanded={showInfo}
          aria-controls={infoId}
          onClick={() => setShowInfo((value) => !value)}
        >
          <IconInfo size={16} />
        </button>
        <span className="trip-summary__totals">
          <span className="nowrap">{t('summary.flights', fmt.number(trip.totals.flights))}</span>
          {' · '}
          <span className="nowrap">{fmt.distance(trip.totals.distanceKm, unit)}</span>
          <br />
          {totalFlying > 0 && (
            <span className="nowrap">
              {t('summary.flying', `${approximate ? '≈ ' : ''}${fmt.duration(totalFlying)}`)}
            </span>
          )}
          {range && (
            <>
              {' · '}
              <span className="nowrap">{`${approximateDates ? '≈ ' : ''}${range}`}</span>
            </>
          )}
        </span>
        {(!timeOpen || playScope !== null) && (
          <button
            type="button"
            className="play-btn"
            aria-label={t('trip.play')}
            onClick={props.onPlayTrip}
            disabled={!trip.totals.flights}
          >
            <IconPlay size={18} />
            <span>{t('trip.play')}</span>
          </button>
        )}
      </div>
      <div id={infoId} className="summary__info" hidden={!showInfo}>
        <p>{t('summary.method', `${fmt.number(model.cruiseSpeedKmh)} km/h`, model.overheadMinutes)}</p>
        <p>{t('summary.connectionMethod', fmt.layover(DEFAULT_LAYOVER_MIN))}</p>
        <p>
          {t('trip.stayMethod')}
          {assumedStay ? ` ${t('trip.assumedStay', stayLength(DEFAULT_STAY_MIN, null, i18n))}` : ''}
        </p>
        {props.routing.airspace && props.routing.reviewed ? (
          <p>{t('summary.airspaceMethod', fmt.shortDate(props.routing.reviewed))}</p>
        ) : null}
        {props.routing.diversion ? <DiversionMethod unit={unit} /> : null}
      </div>
    </section>
  );
}
