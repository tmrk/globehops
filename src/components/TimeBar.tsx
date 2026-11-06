import { useMemo } from 'react';
import { compareMetrics, comparisonRange, type ComparedJourney } from '../lib/compare.ts';
import { ComparisonLanes } from './ComparisonLanes.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { airportCode } from '../data/airports.ts';
import { useClock } from '../hooks/useClock.ts';

import type { Journey } from '../lib/schedule.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';
import {
  isSupportedTimeZone,
  browserTimeZone,
  formatLocalDateTime,
  parseLocalDateTime,
  resolveLocal,
  utcToLocal,
  zoneAbbreviation,
} from '../lib/timezone.ts';
import { legColor } from '../lib/legColors.ts';
import { PLAYBACK_SPEEDS, type PlaybackSpeed, type SimulationClock } from '../state/clock.ts';
import { DateTimeField } from './DateTimeField.tsx';
import { IconChevronDown, IconBack, IconChevronRight, IconClose, IconFollow, IconPause, IconPlay } from './Icons.tsx';
interface Props {
  comparison?: ComparedJourney[];
  active?: number;
  onActivate?: (index: number) => void;
  onEditJourneyLeg?: (index: number, leg: number) => void;
  clock: SimulationClock;
  journey: Journey;
  timeline: Timeline | null;
  clockZone: string;
  onClockZone: (value: string) => void;
  onClose: () => void;
  onToggle: () => void;
  onEditLeg: (leg: number) => void;
  /** Phones: part of the journey sheet instead of a floating card. */
  docked?: boolean;
  followAircraft: boolean;
  onFollowAircraft?: (enabled: boolean) => void;
}
export function TimeBar({
  clock,
  comparison,
  active,
  onActivate,
  onEditJourneyLeg,
  journey,
  timeline,
  clockZone,
  onClockZone,
  onClose,
  onToggle,
  onEditLeg,
  docked = false,
  followAircraft,
  onFollowAircraft,
}: Props) {
  const { t, fmt } = useI18n();

  const snapshot = useClock(clock);
  const browserZone = browserTimeZone();
  const allJourneys = useMemo(() => comparison?.map((entry) => entry.journey) ?? [journey], [comparison, journey]);
  const sharedRange = useMemo(() => (comparison ? comparisonRange(comparison) : timeline), [comparison, timeline]);
  const metrics = useMemo(() => (comparison ? compareMetrics(comparison) : null), [comparison]);
  const requestedZone =
    clockZone === 'local'
      ? browserZone
      : clockZone === 'utc'
        ? 'UTC'
        : (allJourneys.flatMap((entry) => entry.stops).find((s) => airportCode(s.airport) === clockZone)?.zone ??
          browserZone);
  const zone = isSupportedTimeZone(requestedZone) ? requestedZone : browserZone;
  const state = timeline ? journeyStateAt(journey, timeline, snapshot.time) : null;
  const text = state
    ? fmt.describeState(journey, state)
    : { title: t('timebar.dayAndNight'), detail: t('timebar.exploreSunlightAroundTheWorld') };
  if (state?.phase === 'before')
    text.detail = t('timebar.departsIn', fmt.duration((state.nextDeparture - snapshot.time) / 60000));
  if (comparison && metrics) {
    const arrival = metrics.firstArrival ? comparison.find((entry) => entry.id === metrics.firstArrival) : null;
    const fastest = metrics.fastest;
    text.title = arrival
      ? t('compare.firstTitle', arrival.id)
      : fastest
        ? t('compare.fastestTitle', fastest)
        : t('compare.comparing', comparison.length);
    const arrivalTime = arrival?.journey.end?.epochMs;
    text.detail =
      arrivalTime !== undefined
        ? comparison
            .flatMap((entry) =>
              entry.id !== arrival?.id && entry.journey.end
                ? [t('compare.before', fmt.duration((entry.journey.end.epochMs - arrivalTime) / 60000), entry.id)]
                : [],
            )
            .join(' · ')
        : t('compare.sharedClock');
  }
  const errorJourney = allJourneys.findIndex((entry) => entry.issues.some((issue) => issue.severity === 'error'));
  const error = allJourneys[errorJourney]?.issues.find((i) => i.severity === 'error');
  const editError = () => (comparison ? onEditJourneyLeg?.(errorJourney, errorLeg) : onEditLeg(errorLeg));
  const errorLeg = error?.leg ?? (error?.field === 'arrival' ? Math.max(0, (error.stop ?? 1) - 1) : (error?.stop ?? 0));
  if (error) {
    text.title = t('timebar.fixTimes', errorLeg + 1);
    text.detail = `${comparison ? `${comparison[errorJourney].id} · ` : ''}${t('timebar.checkTheLocalDatesAndTimes')}`;
  }
  const local = utcToLocal(zone, snapshot.time);
  const date = formatLocalDateTime(local).slice(0, 10);
  const dayStart = useMemo(() => {
    const midnight = parseLocalDateTime(`${date}T00:00`);
    if (!midnight) throw new RangeError('Invalid local date');
    const resolution = resolveLocal(zone, midnight);
    if (resolution.kind === 'exact') return resolution.time.epochMs;
    if (resolution.kind === 'ambiguous') return resolution.options[0].epochMs;
    return resolution.after.epochMs;
  }, [zone, date]);
  const start = sharedRange ? (snapshot.start ?? sharedRange.start - 30 * 60000) : dayStart;
  const end = sharedRange ? (snapshot.end ?? sharedRange.end) : dayStart + 24 * 3600000;
  const readout = `${fmt.clock(snapshot.time, zone, { weekday: true, date: true })} ${zoneAbbreviation(zone, snapshot.time)}`;
  const seek = (time: number) => {
    clock.pause();
    clock.seek(time);
  };
  const step = (direction: number) => {
    const departures = [
      ...new Set(
        allJourneys.flatMap((entry) => entry.legs.flatMap((leg) => (leg.departure ? [leg.departure.epochMs] : []))),
      ),
    ].sort((a, b) => a - b);
    const target =
      direction > 0
        ? departures.find((t) => t > snapshot.time + 1000)
        : departures.findLast((t) => t < snapshot.time - 1000);
    seek(target ?? (direction > 0 ? departures.at(-1) : departures[0]) ?? snapshot.time);
  };
  const options = useMemo(() => {
    const choices = [
      ...new Map(
        allJourneys
          .flatMap((entry) => fmt.clockZoneOptions(entry, browserZone))
          .map((option) => [option.value, option]),
      ).values(),
    ];
    if (!choices.some((option) => option.value === clockZone))
      choices.push({ value: clockZone, label: t('timebar.placeTime', clockZone) });
    return choices;
  }, [allJourneys, fmt, browserZone, clockZone, t]);
  const laneRange = useMemo(() => ({ start, end }), [start, end]);
  return (
    <section
      className={`time-bar${docked ? ' time-bar--docked' : ''}`}
      aria-label={t('timebar.timeline')}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest('select, textarea, [contenteditable="true"]')) return;
        if (target instanceof HTMLInputElement && target.type !== 'range') return;
        // Space belongs to focused buttons; only the scrubber uses it as a playback shortcut.
        if (e.key === ' ' && target.closest('button')) return;
        if (e.key.toLowerCase() !== 'k' && e.key !== ' ') return;
        e.preventDefault();
        if (sharedRange && !error) onToggle();
      }}
    >
      <div className="time-bar__head">
        <button
          type="button"
          className="time-bar__play"
          aria-label={
            snapshot.playing ? t('timebar.pausePlayback') : comparison ? t('compare.playAll') : t('timebar.playJourney')
          }
          disabled={!sharedRange || !!error}
          onClick={onToggle}
        >
          {snapshot.playing ? <IconPause /> : <IconPlay />}
        </button>
        <div className="time-bar__status">
          <div className="time-bar__title">
            {error ? (
              <button type="button" className="schedule-error" onClick={editError}>
                {text.title}
              </button>
            ) : (
              text.title
            )}
          </div>
          <div className="time-bar__detail">
            {!comparison && !journey.dated && timeline && snapshot.time <= timeline.start + 60000 ? (
              <>
                {t('timebar.exampleDeparture')} ·{' '}
                <button type="button" className="text-btn" onClick={() => onEditLeg(0)}>
                  {t('timebar.setYourTimes')}
                </button>
              </>
            ) : (
              text.detail
            )}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn--quiet"
          aria-label={t('timebar.closeTimeline')}
          onClick={onClose}
        >
          <IconClose size={18} />
        </button>
      </div>
      {comparison && (
        <ComparisonLanes
          list={comparison}
          active={active}
          onActivate={onActivate}
          time={snapshot.time}
          zone={zone}
          range={laneRange}
        />
      )}
      <div className="time-bar__scrubber">
        <div className="time-bar__track" aria-hidden="true">
          {!comparison &&
            timeline?.segments.map((segment, index) => (
              <span
                key={index}
                className={`time-bar__segment time-bar__segment--${segment.kind}`}
                style={{
                  left: `${(100 * (segment.start - start)) / (end - start)}%`,
                  width: `${(100 * (segment.end - segment.start)) / (end - start)}%`,
                  backgroundColor: segment.kind === 'flight' ? legColor(segment.leg ?? 0) : undefined,
                }}
              />
            ))}
        </div>
        <input
          aria-label={t('timebar.journeyTime')}
          aria-valuetext={`${readout}. ${text.title}. ${text.detail}`}
          type="range"
          min={start}
          max={end}
          step={60000}
          value={snapshot.time}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </div>
      <div className="time-bar__foot">
        <label className="time-bar__menu time-bar__clock">
          <span className="time-bar__readout">{readout}</span>
          <IconChevronDown size={13} className="time-bar__chev" />
          <select
            aria-label={t('timebar.clockTimeZone')}
            value={clockZone}
            onChange={(e) => onClockZone(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {sharedRange ? (
          <>
            {onFollowAircraft && (
              <button
                type="button"
                className="time-bar__follow"
                aria-label={t('timebar.followAircraft')}
                title={t('timebar.followAircraft')}
                aria-pressed={followAircraft}
                onClick={() => onFollowAircraft(!followAircraft)}
              >
                <IconFollow size={18} />
              </button>
            )}
            <span className="time-bar__steps" role="group" aria-label={t('timebar.jumpBetweenFlights')}>
              <button type="button" aria-label={t('timebar.previousFlight')} onClick={() => step(-1)}>
                <IconBack size={16} />
              </button>
              <button type="button" aria-label={t('timebar.nextFlight')} onClick={() => step(1)}>
                <IconChevronRight size={16} />
              </button>
            </span>
            <label className="time-bar__menu time-bar__speed">
              {snapshot.speed === 'auto' ? t('timebar.auto') : t('timebar.speed', fmt.number(snapshot.speed / 3600))}
              <IconChevronDown size={13} className="time-bar__chev" />
              <select
                aria-label={t('timebar.playbackSpeed')}
                value={snapshot.speed}
                onChange={(e) =>
                  clock.setSpeed(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as PlaybackSpeed))
                }
              >
                {PLAYBACK_SPEEDS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.value === 'auto' ? t('timebar.auto') : t('timebar.speed', fmt.number(s.value / 3600))}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <DateTimeField
              kind="date"
              label={t('timebar.globeDate')}
              value={date}
              display={fmt.date(date)}
              placeholder={t('timebar.date')}
              onChange={(value) => {
                const local = parseLocalDateTime(
                  `${value}T${formatLocalDateTime(utcToLocal(zone, snapshot.time)).slice(11)}`,
                );
                if (!local) return;
                const resolved = resolveLocal(zone, local);
                seek(
                  resolved.kind === 'exact'
                    ? resolved.time.epochMs
                    : resolved.kind === 'ambiguous'
                      ? resolved.options[0].epochMs
                      : resolved.after.epochMs,
                );
              }}
            />
            <button
              type="button"
              className="time-bar__menu time-bar__now"
              onClick={() => {
                clock.setRange(null, null);
                clock.seek(Date.now());
              }}
            >
              {t('timebar.now')}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
