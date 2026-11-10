import { useEffect, useMemo, useRef, useState } from 'react';
import { compareMetrics, comparisonRange, type ComparedJourney } from '../lib/compare.ts';
import { ComparisonLanes, TripComparisonLanes } from './ComparisonLanes.tsx';
import type { ComparedTrip, TripComparisonMetrics, TripComparisonTimeline } from '../lib/compareTrips.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { airportCode } from '../data/airports.ts';
import { useClock } from '../hooks/useClock.ts';

import type { Journey } from '../lib/schedule.ts';
import { journeyStateAt, type Timeline } from '../lib/timeline.ts';
import { tripStateAt, type Trip } from '../lib/trip.ts';
import { composedAxis } from '../lib/timeAxis.ts';
import { stayLength } from './tripText.ts';
import {
  isSupportedTimeZone,
  browserTimeZone,
  epochAtLocal,
  formatLocalDateTime,
  parseLocalDateTime,
  utcToLocal,
  zoneAbbreviation,
} from '../lib/timezone.ts';
import { legColor } from '../lib/legColors.ts';
import { PLAYBACK_SPEEDS, type PlaybackSpeed, type SimulationClock } from '../state/clock.ts';
import { DateTimeField } from './DateTimeField.tsx';
import { LiveButton } from './LiveButton.tsx';
import {
  IconChevronDown,
  IconChevronUp,
  IconBack,
  IconChevronRight,
  IconClose,
  IconFollow,
  IconPause,
  IconPlay,
} from './Icons.tsx';
interface Props {
  comparison?: ComparedJourney[];
  /** A trip's single traveller: every journey, their names and the journey playback is limited to (or null). */
  trip?: { trip: Trip; names: string[]; scope: number | null };
  /** Compared trips: every trip, their ranking and shared clock, each trip's journey names, journeys per trip. */
  trips?: {
    list: ComparedTrip[];
    metrics: TripComparisonMetrics;
    timeline: TripComparisonTimeline;
    names: string[][];
    sections: number;
  };
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
  /** Follow the wall clock in real time; offered once a journey has real dates. */
  onLive: (live: boolean) => void;
  onEditLeg: (leg: number) => void;
  /** Phones: part of the journey sheet instead of a floating card. */
  docked?: boolean;
  followAircraft: boolean;
  onFollowAircraft?: (enabled: boolean) => void;
  /**
   * Cinematic playback: only play/pause, what is happening and a progress line, so the globe gets the
   * screen. Pausing, or Show controls, brings the full timeline back.
   */
  compact?: boolean;
  onShowControls?: () => void;
  /** While playing with the full timeline: back to the cinematic view. */
  onHideControls?: () => void;
}
export function TimeBar({
  clock,
  comparison,
  trip,
  trips,
  active,
  onActivate,
  onEditJourneyLeg,
  journey,
  timeline,
  clockZone,
  onClockZone,
  onClose,
  onToggle,
  onLive,
  onEditLeg,
  docked = false,
  followAircraft,
  onFollowAircraft,
  compact = false,
  onShowControls,
  onHideControls,
}: Props) {
  const { t, fmt } = useI18n();

  const snapshot = useClock(clock);
  const browserZone = browserTimeZone();
  const allJourneys = useMemo(
    () =>
      trip?.trip.sections.map((section) => section.journey) ??
      trips?.list.flatMap((entry) => entry.trip.sections.map((section) => section.journey)) ??
      comparison?.map((entry) => entry.journey) ?? [journey],
    [trip, trips, comparison, journey],
  );
  const sharedRange = useMemo(
    () =>
      trip
        ? trip.scope !== null
          ? (trip.trip.sections[trip.scope]?.timeline ?? null)
          : trip.trip.timeline
        : trips
          ? trips.timeline
          : comparison
            ? comparisonRange(comparison)
            : timeline,
    [trip, trips, comparison, timeline],
  );
  const metrics = useMemo(() => (comparison ? compareMetrics(comparison) : null), [comparison]);
  const requestedZone =
    clockZone === 'local'
      ? browserZone
      : clockZone === 'utc'
        ? 'UTC'
        : (allJourneys.flatMap((entry) => entry.stops).find((s) => airportCode(s.airport) === clockZone)?.zone ??
          browserZone);
  const zone = isSupportedTimeZone(requestedZone) ? requestedZone : browserZone;
  const state = !trip && !trips && timeline ? journeyStateAt(journey, timeline, snapshot.time) : null;
  const text = state
    ? fmt.describeState(journey, state)
    : { title: t('timebar.dayAndNight'), detail: t('timebar.exploreSunlightAroundTheWorld') };
  if (state?.phase === 'before')
    text.detail = t('timebar.departsIn', fmt.duration((state.nextDeparture - snapshot.time) / 60000));
  if (trip?.trip.timeline) {
    const { names } = trip;
    const tripState = tripStateAt(trip.trip, trip.trip.timeline, snapshot.time);
    if (tripState.phase === 'stay') {
      const stay = trip.trip.stays.find((s) => s.section === tripState.section);
      const next = trip.trip.sections[tripState.section].journey.start;
      text.title = t('trip.stayTitle', stay ? fmt.city(stay.arrivalAirport) : '');
      text.detail =
        snapshot.skipping && stay && next
          ? t(
              'trip.skipping',
              stayLength(stay.minutes, stay.days, { t, fmt }),
              fmt.clock(next.epochMs, next.zone, { weekday: true, date: true }),
            )
          : t('trip.stayDetail', names[tripState.section], fmt.duration(tripState.untilDepartureMin));
    } else {
      const section = trip.trip.sections[tripState.section];
      const local = tripState.state;
      const described = fmt.describeState(section.journey, local);
      const last = tripState.section === trip.trip.timeline.sections.at(-1)?.index;
      text.title = described.title;
      text.detail = `${names[tripState.section]} · ${
        local.phase === 'before'
          ? t('timebar.departsIn', fmt.duration((local.nextDeparture - snapshot.time) / 60000))
          : local.phase === 'after' && last
            ? t('trip.complete')
            : described.detail
      }`;
    }
  }
  if (comparison && metrics) {
    const arrival = metrics.firstArrival ? comparison.find((entry) => entry.id === metrics.firstArrival) : null;
    text.title = arrival
      ? t('compare.firstTitle', arrival.label ?? arrival.id)
      : t('compare.comparing', comparison.length);
    const arrivalTime = arrival?.journey.end?.epochMs;
    text.detail =
      arrivalTime !== undefined
        ? comparison
            .flatMap((entry) =>
              entry.id !== arrival?.id && entry.journey.end
                ? [
                    t(
                      'compare.before',
                      fmt.duration((entry.journey.end.epochMs - arrivalTime) / 60000),
                      entry.label ?? entry.id,
                    ),
                  ]
                : [],
            )
            .join(' · ')
        : '';
  }
  if (trips) {
    text.title = t('trips.comparing', fmt.number(trips.list.length));
    text.detail = '';
  }
  const errorJourney = allJourneys.findIndex((entry) => entry.issues.some((issue) => issue.severity === 'error'));
  const journeyError = allJourneys[errorJourney]?.issues.find((i) => i.severity === 'error');
  /** Compared trips: the first trip whose journeys overlap, as a trip-like issue on its flat journey index. */
  const tripsOverlap = trips?.list.flatMap((entry, option) =>
    entry.trip.issues.map((issue) => ({ ...issue, option, flat: option * trips.sections + issue.section })),
  )[0];
  const overlap = trip?.trip.issues[0] ?? tripsOverlap;
  const error = journeyError ?? overlap;
  const errorLeg = journeyError
    ? (journeyError.leg ??
      (journeyError.field === 'arrival' ? Math.max(0, (journeyError.stop ?? 1) - 1) : (journeyError.stop ?? 0)))
    : 0;
  const editError = () =>
    comparison || trip || trips
      ? onEditJourneyLeg?.(journeyError ? errorJourney : (tripsOverlap?.flat ?? overlap?.section ?? 0), errorLeg)
      : onEditLeg(errorLeg);
  /** Who a problem belongs to: the compared journey's letter, the trip journey's name, or both. */
  const owner = (flat: number) =>
    comparison
      ? `${comparison[flat].id} · `
      : trip
        ? `${trip.names[flat]} · `
        : trips
          ? `${trips.list[Math.floor(flat / trips.sections)].id} ${trips.names[Math.floor(flat / trips.sections)]?.[flat % trips.sections] ?? ''} · `
          : '';
  if (journeyError) {
    text.title = t('timebar.fixTimes', errorLeg + 1);
    text.detail = `${owner(errorJourney)}${t('timebar.checkTheLocalDatesAndTimes')}`;
  } else if (overlap && trip) {
    text.title = t('trip.departsBefore', trip.names[overlap.section]);
    text.detail = t('timebar.checkTheLocalDatesAndTimes');
  } else if (tripsOverlap && trips) {
    text.title = t('trip.departsBefore', trips.names[tripsOverlap.option]?.[tripsOverlap.section] ?? '');
    text.detail = `${trips.list[tripsOverlap.option].id} · ${t('timebar.checkTheLocalDatesAndTimes')}`;
  }
  const local = utcToLocal(zone, snapshot.time);
  const date = formatLocalDateTime(local).slice(0, 10);
  const dayStart = useMemo(() => {
    const midnight = parseLocalDateTime(`${date}T00:00`);
    if (!midnight) throw new RangeError('Invalid local date');
    return epochAtLocal(zone, midnight);
  }, [zone, date]);
  const start = sharedRange ? (snapshot.start ?? sharedRange.start - 30 * 60000) : dayStart;
  const end = sharedRange ? (snapshot.end ?? sharedRange.end) : dayStart + 24 * 3600000;
  const abbreviation = zoneAbbreviation(zone, snapshot.time);
  const spoken = `${fmt.clock(snapshot.time, zone, { weekday: true, date: true })} ${abbreviation}`;
  // Docked on a phone, the clock shares its row with the playback controls: the date alone keeps it on one line.
  const readout = docked ? `${fmt.clock(snapshot.time, zone, { date: true })} ${abbreviation}` : spoken;
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
  // A whole trip shows its stays as short breaks, so flights stay readable; other timelines are linear in ms.
  const stays = trip && trip.scope === null ? trip.trip.timeline?.stays : trips?.timeline.gaps;
  const axis = useMemo(() => (stays?.length ? composedAxis(start, end, stays) : null), [stays, start, end]);
  const scale = axis
    ? { min: 0, max: axis.length, step: 1, toPos: axis.toPos, toTime: axis.toTime }
    : { min: start, max: end, step: 60000, toPos: (time: number) => time, toTime: (pos: number) => pos };
  const at = (time: number) => (100 * (scale.toPos(time) - scale.min)) / Math.max(1, scale.max - scale.min);
  // Skipping a stay, time holds at the arrival while the thumb glides across the break, landing where
  // playback continues; reduced motion jumps instead.
  const skipping = axis ? snapshot.skipping : null;
  const glide = skipping && document.documentElement.dataset.motion !== 'reduce' ? easeInOut(skipping.progress) : 0;
  const thumbPos = skipping
    ? scale.toPos(snapshot.time) + glide * (scale.toPos(skipping.to) - scale.toPos(snapshot.time))
    : scale.toPos(snapshot.time);
  const thumbAt = (100 * (thumbPos - scale.min)) / Math.max(1, scale.max - scale.min);
  // The track's own width (between the thumb's centres at either end) decides when the thumb reaches a label.
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(0);
  useEffect(() => {
    const scrubber = scrubberRef.current;
    if (!scrubber || !axis || typeof ResizeObserver === 'undefined') return;
    const measure = () => setTrackPx(Math.max(0, scrubber.clientWidth - 2 * THUMB_RADIUS));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrubber);
    return () => observer.disconnect();
  }, [axis]);
  // Stays are true gaps in the track, so the two journeys read as separate bars.
  const trackGaps = axis?.breaks.length
    ? `linear-gradient(to right, ${[
        ...axis.breaks.flatMap((gap, i) => {
          const from = at(gap.start),
            to = at(gap.end);
          const previous = i ? at(axis.breaks[i - 1].end) : 0;
          return [`#000 ${previous}% ${from}%`, `transparent ${from}% ${to}%`];
        }),
        `#000 ${at(axis.breaks[axis.breaks.length - 1].end)}% 100%`,
      ].join(', ')})`
    : undefined;
  const trackSegments = trip
    ? (trip.scope === null
        ? trip.trip.timeline?.sections
        : trip.trip.timeline?.sections.filter((s) => s.index === trip.scope)
      )?.flatMap((entry) =>
        entry.timeline.segments.map((segment) => ({
          ...segment,
          color: segment.kind === 'flight' ? legColor(entry.legOffset + segment.leg) : undefined,
        })),
      )
    : !comparison && !trips
      ? timeline?.segments.map((segment) => ({
          ...segment,
          color: segment.kind === 'flight' ? legColor(segment.leg ?? 0) : undefined,
        }))
      : undefined;
  const playLabel = snapshot.playing
    ? t('timebar.pausePlayback')
    : comparison || trips
      ? t('compare.playAll')
      : trip
        ? trip.scope === null
          ? t('trip.play')
          : t('trip.playSection', trip.names[trip.scope])
        : t('timebar.playJourney');
  if (compact)
    return (
      <section
        className={`time-bar time-bar--compact${docked ? ' time-bar--docked' : ''}`}
        aria-label={t('timebar.timeline')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="time-bar__head">
          <button type="button" className="time-bar__play" aria-label={playLabel} onClick={onToggle}>
            {snapshot.playing ? <IconPause /> : <IconPlay />}
          </button>
          {/* A pointer can reach the controls from anywhere on the bar; the button beside it is the control. */}
          <div className="time-bar__status" onClick={onShowControls}>
            <div className="time-bar__title">{text.title}</div>
            <div className="time-bar__detail">
              <span className="time-bar__readout time-bar__clock-inline">{readout}</span>
              {text.detail && ` · ${text.detail}`}
            </div>
          </div>
          {snapshot.live && <LiveButton live onChange={onLive} />}
          {onFollowAircraft && sharedRange && (
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
          {onShowControls && (
            <button
              type="button"
              className="icon-btn icon-btn--quiet"
              aria-label={t('timebar.showControls')}
              title={t('timebar.showControls')}
              onClick={onShowControls}
            >
              <IconChevronUp size={20} />
            </button>
          )}
        </div>
        <div className="time-bar__progress" aria-hidden="true">
          {[false, true].map((elapsed) => (
            <span
              key={String(elapsed)}
              className={`time-bar__progress-layer${elapsed ? ' is-elapsed' : ''}`}
              style={elapsed ? { clipPath: `inset(0 ${Math.max(0, 100 - thumbAt)}% 0 0)` } : undefined}
            >
              {trackSegments ? (
                trackSegments.map((segment, index) => (
                  <span
                    key={index}
                    className={`time-bar__segment time-bar__segment--${segment.kind}`}
                    style={{
                      left: `${at(segment.start)}%`,
                      width: `${at(segment.end) - at(segment.start)}%`,
                      backgroundColor: segment.color,
                    }}
                  />
                ))
              ) : (
                <span
                  className="time-bar__segment"
                  style={{ left: 0, width: '100%', backgroundColor: 'var(--accent)' }}
                />
              )}
            </span>
          ))}
        </div>
      </section>
    );
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
          aria-label={playLabel}
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
            {!comparison && !trip && !trips && !journey.dated && timeline && snapshot.time <= timeline.start + 60000 ? (
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
        {allJourneys.some((entry) => entry.dated) && <LiveButton live={snapshot.live} onChange={onLive} />}
        {onHideControls && (snapshot.playing || snapshot.live) && (
          <button
            type="button"
            className="icon-btn icon-btn--quiet"
            aria-label={t('timebar.hideControls')}
            title={t('timebar.hideControls')}
            onClick={onHideControls}
          >
            <IconChevronDown size={20} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn icon-btn--quiet"
          aria-label={t('timebar.closeTimeline')}
          onClick={onClose}
        >
          <IconClose size={18} />
        </button>
      </div>
      {trips && (
        <TripComparisonLanes
          list={trips.list}
          names={trips.names}
          active={active}
          onActivate={onActivate}
          time={snapshot.time}
          zone={zone}
          at={at}
        />
      )}
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
      <div className="time-bar__scrubber" ref={scrubberRef}>
        <div
          className="time-bar__track"
          aria-hidden="true"
          style={trackGaps ? { maskImage: trackGaps, WebkitMaskImage: trackGaps } : undefined}
        >
          {trackSegments?.map((segment, index) => (
            <span
              key={index}
              className={`time-bar__segment time-bar__segment--${segment.kind}`}
              style={{
                left: `${at(segment.start)}%`,
                width: `${at(segment.end) - at(segment.start)}%`,
                backgroundColor: segment.color,
              }}
            />
          ))}
        </div>
        {axis && (
          <div className="time-bar__breaks" aria-hidden="true">
            {axis?.breaks.map((gap) => {
              const stay = trip?.trip.stays.find((s) => s.arrival?.epochMs === gap.start);
              const label = stay
                ? stayLength(stay.minutes, stay.days, { t, fmt })
                : trips
                  ? stayLength((gap.end - gap.start) / 60000, null, { t, fmt })
                  : '';
              const centre = (at(gap.start) + at(gap.end)) / 2;
              // The label steps aside (fades) whenever the thumb comes within reach, never sitting under it.
              const reach = THUMB_RADIUS + LABEL_CHAR_PX * label.length * 0.5 + 6;
              const covered = !trackPx || (Math.abs(thumbAt - centre) / 100) * trackPx < reach;
              const active = skipping && skipping.from >= gap.start && skipping.to <= gap.end;
              return (
                <span
                  key={gap.start}
                  className={`time-bar__break${active ? ' is-skipping' : ''}${covered ? ' is-covered' : ''}`}
                  style={{ left: `${at(gap.start)}%`, width: `${at(gap.end) - at(gap.start)}%` }}
                >
                  {label && <span className="time-bar__break-label">{label}</span>}
                </span>
              );
            })}
          </div>
        )}
        <input
          aria-label={t('timebar.journeyTime')}
          aria-valuetext={`${spoken}. ${text.title}. ${text.detail}`}
          type="range"
          min={scale.min}
          max={scale.max}
          step={scale.step}
          value={thumbPos}
          onChange={(e) => seek(scale.toTime(Number(e.target.value)))}
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
                if (local) seek(epochAtLocal(zone, local));
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

/** Half the scrubber thumb (28px): the track runs between its centres at either end. */
const THUMB_RADIUS = 14;
/** Approximate width of one character of a break label (condensed mono at --text-2xs). */
const LABEL_CHAR_PX = 5.4;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
