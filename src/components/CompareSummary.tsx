import { useId, useState, type CSSProperties } from 'react';
import { airportCode } from '../data/airports.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { ComparedJourney, ComparisonMetrics } from '../lib/compare.ts';
import { DEFAULT_FLIGHT_TIME_MODEL } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';
import { ComparisonStrip } from './ComparisonStrip.tsx';
import { IconInfo } from './Icons.tsx';

interface Props {
  list: ComparedJourney[];
  metrics: ComparisonMetrics;
  active: number;
  onActivate: (index: number) => void;
}

export function CompareSummary({ list, metrics, active, onActivate }: Props) {
  const { t, fmt } = useI18n();
  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();
  const model = DEFAULT_FLIGHT_TIME_MODEL;
  return (
    <section className="summary compare-summary" aria-label={t('compare.summary')}>
      <div className="compare-summary__rows">
        {list.map((entry, i) => {
          const metric = metrics.journeys[i];
          const ready = entry.journey.stops.length >= 2;
          return (
            <button
              type="button"
              key={entry.id}
              className="compare-summary__row"
              aria-pressed={active === i}
              onClick={() => onActivate(i)}
              style={{ '--journey-color': entry.color } as CSSProperties}
            >
              <span className="journey-chip">{entry.id}</span>
              <span className="compare-summary__route">
                {entry.label && <span className="compare-summary__label">{entry.label} · </span>}
                {entry.journey.stops.length ? (
                  entry.journey.stops.map((stop) => airportCode(stop.airport)).join(' → ')
                ) : (
                  <span className="compare-summary__empty">{t('compare.chooseAirports')}</span>
                )}
              </span>
              <span className="compare-summary__duration">
                {ready && `${metric.estimated ? '≈ ' : ''}${fmt.duration(metric.journeyMin)}`}
              </span>
              <ComparisonStrip entry={entry} list={list} />
              <span className="compare-summary__awards">
                {ready &&
                  metrics.fastest !== null &&
                  (metrics.fastest === entry.id ? (
                    <span className="compare-badge">{t('compare.fastest')}</span>
                  ) : (
                    <span className="compare-delta">+{fmt.duration(metrics.deltaMin[entry.id])}</span>
                  ))}
                {metrics.firstArrival === entry.id && metrics.firstArrival !== metrics.fastest && (
                  <span className="compare-badge compare-badge--arrival">{t('compare.arrivesFirst')}</span>
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
          {list.some((entry) => entry.anchor === 'assumed') && t('compare.assumed')}
        </span>
      </div>
      <div id={infoId} className="summary__info" hidden={!showInfo}>
        <p>{t('summary.method', `${fmt.number(model.cruiseSpeedKmh)} km/h`, model.overheadMinutes)}</p>
        <p>{t('summary.connectionMethod', fmt.layover(DEFAULT_LAYOVER_MIN))}</p>
      </div>
    </section>
  );
}
