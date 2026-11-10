import { useId, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { ComparedTrip, TripComparisonMetrics } from '../lib/compareTrips.ts';
import { DEFAULT_FLIGHT_TIME_MODEL } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';
import { IconInfo } from './Icons.tsx';
import { tripCodes } from './tripCompareText.ts';

interface Props {
  list: ComparedTrip[];
  metrics: TripComparisonMetrics;
  /** What tells each trip apart: its name, “via FRA”, “Nonstop” or its route. */
  captions: string[];
  /** Outbound, Return, …: the journeys every trip has. */
  columns: string[];
  active: number;
  onActivate: (option: number) => void;
}

/**
 * Compared trips as a small table: one row per trip, one column per journey (outbound, return, …) and the
 * total time travelling. A bar under each time shows it against the same journey of the other trips; the
 * quickest of each column stands out, and the quickest trip overall is marked Fastest.
 */
export function TripCompareSummary({ list, metrics, captions, columns, active, onActivate }: Props) {
  const { t, fmt } = useI18n();
  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();
  const model = DEFAULT_FLIGHT_TIME_MODEL;
  const longest = columns.map((_, k) => Math.max(1, ...metrics.trips.map((trip) => trip.sections[k]?.journeyMin ?? 0)));
  const longestTotal = Math.max(1, ...metrics.trips.map((trip) => (trip.complete ? trip.travelMin : 0)));
  const time = (minutes: number, estimated: boolean) => `${estimated ? '≈ ' : ''}${fmt.duration(minutes)}`;
  return (
    <section
      className="summary trip-compare"
      aria-label={t('trips.summary')}
      style={{ '--trip-columns': columns.length } as CSSProperties}
    >
      <div className="trip-compare__grid">
        <div className="trip-compare__head" aria-hidden="true">
          <span />
          <span />
          {columns.map((name, k) => (
            <span key={k} className="trip-compare__column">
              {name}
            </span>
          ))}
          <span className="trip-compare__column">{t('trips.total')}</span>
        </div>
        {list.map((entry, i) => {
          const metric = metrics.trips[i];
          const codes = tripCodes(entry);
          const fastest = metrics.fastest === entry.id;
          return (
            <button
              type="button"
              key={entry.id}
              className="trip-compare__row"
              aria-pressed={active === i}
              aria-label={
                metric.complete
                  ? t(
                      'trips.rowLabel',
                      `${entry.id} ${captions[i]}`,
                      columns
                        .map(
                          (name, k) =>
                            `${name} ${time(metric.sections[k]?.journeyMin ?? 0, metric.sections[k]?.estimated ?? true)}`,
                        )
                        .join(', '),
                      time(metric.travelMin, metric.estimated),
                    ) + (fastest ? `, ${t('compare.fastest')}` : '')
                  : `${entry.id} ${captions[i]}`
              }
              onClick={() => onActivate(i)}
              style={{ '--journey-color': entry.color } as CSSProperties}
            >
              <span className="journey-chip">{entry.id}</span>
              <span className="trip-compare__name">
                <span className={`trip-compare__caption${codes ? '' : ' trip-compare__caption--empty'}`}>
                  {captions[i]}
                </span>
                {codes && codes !== captions[i] && <span className="trip-compare__codes">{codes}</span>}
              </span>
              {columns.map((_, k) => {
                const section = metric.sections[k];
                const minutes = section?.journeyMin ?? null;
                const best = metric.complete && metrics.sections[k]?.fastest === entry.id;
                return (
                  <span key={k} className={`trip-compare__cell${best ? ' is-best' : ''}`}>
                    <span className="trip-compare__time">
                      {minutes === null ? '—' : time(minutes, section.estimated)}
                    </span>
                    <span className="trip-compare__bar">
                      {minutes !== null && <span style={{ width: `${(100 * minutes) / longest[k]}%` }} />}
                    </span>
                  </span>
                );
              })}
              <span className={`trip-compare__cell trip-compare__total${fastest ? ' is-best' : ''}`}>
                <span className="trip-compare__time">
                  {metric.complete ? time(metric.travelMin, metric.estimated) : '—'}
                </span>
                {metric.complete && metrics.fastest !== null ? (
                  fastest ? (
                    <span className="compare-badge">{t('compare.fastest')}</span>
                  ) : (
                    <span className="compare-delta">+{fmt.duration(metrics.deltaMin[entry.id])}</span>
                  )
                ) : (
                  <span className="trip-compare__bar">
                    {metric.complete && <span style={{ width: `${(100 * metric.travelMin) / longestTotal}%` }} />}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="compare-summary__foot">
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
        <span className="compare-summary__note">
          {list.some((entry) => entry.anchor === 'assumed') && t('trips.assumed')}
        </span>
      </div>
      <div id={infoId} className="summary__info" hidden={!showInfo}>
        <p>{t('summary.method', `${fmt.number(model.cruiseSpeedKmh)} km/h`, model.overheadMinutes)}</p>
        <p>{t('summary.connectionMethod', fmt.layover(DEFAULT_LAYOVER_MIN))}</p>
        <p>{t('trip.stayMethod')}</p>
      </div>
    </section>
  );
}
