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
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconFollow,
  IconPause,
  IconPlay,
} from './Icons.tsx';
interface Props {
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
  const requestedZone =
    clockZone === 'local'
      ? browserZone
      : clockZone === 'utc'
        ? 'UTC'
        : (journey.stops.find((s) => airportCode(s.airport) === clockZone)?.zone ?? browserZone);
  const zone = isSupportedTimeZone(requestedZone) ? requestedZone : browserZone;
  const state = timeline ? journeyStateAt(journey, timeline, snapshot.time) : null;
  const text = state
    ? fmt.describeState(journey, state)
    : { title: t('timebar.dayAndNight'), detail: t('timebar.exploreSunlightAroundTheWorld') };
  if (state?.phase === 'before')
    text.detail = t('timebar.departsIn', fmt.duration((state.nextDeparture - snapshot.time) / 60000));
  const error = journey.issues.find((i) => i.severity === 'error');
  const errorLeg = error?.leg ?? (error?.field === 'arrival' ? Math.max(0, (error.stop ?? 1) - 1) : (error?.stop ?? 0));
  if (error) {
    text.title = t('timebar.fixTimes', errorLeg + 1);
    text.detail = t('timebar.checkTheLocalDatesAndTimes');
  }
  const date = formatLocalDateTime(utcToLocal(zone, snapshot.time)).slice(0, 10);
  const midnight = parseLocalDateTime(`${date}T00:00`)!;
  const resolution = resolveLocal(zone, midnight);
  const dayStart =
    resolution.kind === 'exact'
      ? resolution.time.epochMs
      : resolution.kind === 'ambiguous'
        ? resolution.options[0].epochMs
        : resolution.after.epochMs;
  const start = timeline ? (snapshot.start ?? timeline.start - 30 * 60000) : dayStart;
  const end = timeline ? (snapshot.end ?? timeline.end) : dayStart + 24 * 3600000;
  const readout = `${fmt.clock(snapshot.time, zone, { weekday: true, date: true })} ${zoneAbbreviation(zone, snapshot.time)}`;
  const seek = (time: number) => {
    clock.pause();
    clock.seek(time);
  };
  const step = (direction: number) => {
    const departures = journey.legs.flatMap((l) => (l.departure ? [l.departure.epochMs] : []));
    const target =
      direction > 0
        ? departures.find((t) => t > snapshot.time + 1000)
        : departures.findLast((t) => t < snapshot.time - 1000);
    seek(target ?? (direction > 0 ? departures.at(-1) : departures[0]) ?? snapshot.time);
  };
  const options = fmt.clockZoneOptions(journey, browserZone);
  if (!options.some((o) => o.value === clockZone))
    options.push({ value: clockZone, label: t('timebar.placeTime', clockZone) });
  return (
    <section
      className={`time-bar${docked ? ' time-bar--docked' : ''}`}
      aria-label={t('timebar.timeline')}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (
          e.key.toLowerCase() === 'k' ||
          (e.key === ' ' &&
            !(e.target instanceof HTMLSelectElement) &&
            !(e.target instanceof HTMLInputElement && e.target.type !== 'range'))
        ) {
          e.preventDefault();
          if (timeline) onToggle();
        }
      }}
    >
      <div className="time-bar__head">
        <button
          type="button"
          className="time-bar__play"
          aria-label={snapshot.playing ? t('timebar.pausePlayback') : t('timebar.playJourney')}
          disabled={!timeline}
          onClick={onToggle}
        >
          {snapshot.playing ? <IconPause /> : <IconPlay />}
        </button>
        <div className="time-bar__status">
          <div className="time-bar__title">
            {error ? (
              <button type="button" className="schedule-error" onClick={() => onEditLeg(errorLeg)}>
                {text.title}
              </button>
            ) : (
              text.title
            )}
          </div>
          <div className="time-bar__detail">
            {!journey.dated && timeline && snapshot.time <= timeline.start + 60000 ? (
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
      <div className="time-bar__scrubber">
        <div className="time-bar__track" aria-hidden="true">
          {timeline?.segments.map((segment, index) => (
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
        {timeline ? (
          <>
            {onFollowAircraft && (
              <button
                type="button"
                className="time-bar__follow"
                aria-label={t('timebar.followAircraft')}
                title={t('timebar.followAircraft')}
                aria-pressed={followAircraft}
                onKeyDown={(e) => {
                  if (e.key === ' ') e.stopPropagation();
                }}
                onClick={() => onFollowAircraft(!followAircraft)}
              >
                <IconFollow size={18} />
              </button>
            )}
            <span className="time-bar__steps" role="group" aria-label={t('timebar.jumpBetweenFlights')}>
              <button type="button" aria-label={t('timebar.previousFlight')} onClick={() => step(-1)}>
                <IconChevronLeft size={16} />
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
