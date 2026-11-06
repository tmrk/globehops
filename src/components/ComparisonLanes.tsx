import type { CSSProperties } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { ComparedJourney } from '../lib/compare.ts';
import { journeyStateAt } from '../lib/timeline.ts';
import { ComparisonStrip } from './ComparisonStrip.tsx';

interface Props {
  list: ComparedJourney[];
  active?: number;
  onActivate?: (index: number) => void;
  time: number;
  zone: string;
  range: { start: number; end: number };
}

export function ComparisonLanes({ list, active, onActivate, time, zone, range }: Props) {
  const { t, fmt } = useI18n();
  const status = (entry: ComparedJourney) => {
    if (!entry.timeline) return t('compare.chooseAirports');
    const state = journeyStateAt(entry.journey, entry.timeline, time);
    switch (state.phase) {
      case 'before':
        return t('timebar.departsIn', fmt.duration((state.nextDeparture - time) / 60000));
      case 'flight':
        return t('compare.flying', fmt.city(entry.journey.legs[state.leg].to), fmt.duration(state.remainingMin));
      case 'transfer':
        return t(
          'compare.layover',
          fmt.city(entry.journey.stops[state.stop].airport),
          fmt.duration(state.untilDepartureMin),
        );
      case 'after': {
        const stop = entry.journey.stops[state.stop];
        const end = entry.journey.end;
        return end ? t('compare.landed', fmt.city(stop.airport), fmt.clock(end.epochMs, zone)) : '';
      }
    }
  };
  return (
    <div className="comparison-lanes" role="group" aria-label={t('compare.journeys')}>
      {list.map((entry, index) => (
        <button
          type="button"
          className="comparison-lane"
          key={entry.id}
          aria-pressed={active === index}
          onClick={() => onActivate?.(index)}
          style={{ '--journey-color': entry.color } as CSSProperties}
        >
          <span className="comparison-lane__status">
            <span className="journey-chip">{entry.id}</span>
            <span>{status(entry)}</span>
          </span>
          <ComparisonStrip entry={entry} list={list} range={range} />
        </button>
      ))}
    </div>
  );
}
