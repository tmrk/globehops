import type { CSSProperties } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { ComparedJourney } from '../lib/compare.ts';
import { journeyStateAt } from '../lib/timeline.ts';
import { tripStateAt } from '../lib/trip.ts';
import type { ComparedTrip } from '../lib/compareTrips.ts';
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

/**
 * Compared trips on the timeline: one lane per trip, each its whole trip (out, stay, back) on the shared
 * axis, where the stays every traveller shares are short breaks.
 */
export function TripComparisonLanes({
  list,
  names,
  active,
  onActivate,
  time,
  zone,
  at,
}: {
  list: ComparedTrip[];
  /** Each trip's journey names (Outbound, Return, …). */
  names: string[][];
  active?: number;
  onActivate?: (index: number) => void;
  time: number;
  zone: string;
  /** An instant's position on the shared axis, in percent. */
  at: (time: number) => number;
}) {
  const { t, fmt } = useI18n();
  const status = ({ trip }: ComparedTrip, index: number) => {
    if (!trip.timeline) return t('compare.chooseAirports');
    const state = tripStateAt(trip, trip.timeline, time);
    if (state.phase === 'stay') {
      const journey = trip.sections[state.after].journey;
      return t('trip.stayTitle', fmt.city(journey.stops[journey.stops.length - 1].airport));
    }
    const journey = trip.sections[state.section].journey;
    const local = state.state;
    const name = names[index]?.[state.section] ?? '';
    switch (local.phase) {
      case 'before':
        return `${name} · ${t('timebar.departsIn', fmt.duration((local.nextDeparture - time) / 60000))}`;
      case 'flight':
        return `${name} · ${t('compare.flying', fmt.city(journey.legs[local.leg].to), fmt.duration(local.remainingMin))}`;
      case 'transfer':
        return `${name} · ${t('compare.layover', fmt.city(journey.stops[local.stop].airport), fmt.duration(local.untilDepartureMin))}`;
      case 'after':
        return journey.end
          ? t('compare.landed', fmt.city(journey.stops[local.stop].airport), fmt.clock(journey.end.epochMs, zone))
          : '';
    }
  };
  return (
    <div className="comparison-lanes" role="group" aria-label={t('trips.list')}>
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
            <span>{status(entry, index)}</span>
          </span>
          <span className="comparison-strip" aria-hidden="true">
            {entry.trip.timeline?.sections.flatMap(({ index: section, timeline }) =>
              timeline.segments.map((segment, i) => (
                <span
                  key={`${section}:${i}`}
                  className={`comparison-strip__${segment.kind}`}
                  style={{ left: `${at(segment.start)}%`, width: `${at(segment.end) - at(segment.start)}%` }}
                />
              )),
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
