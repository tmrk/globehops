import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { useClock } from '../hooks/useClock.ts';
import {
  browserTimeZone,
  epochAtLocal,
  formatLocalDateTime,
  MAX_YEAR,
  MIN_YEAR,
  offsetMinutesAt,
  parseLocalDateTime,
  utcToLocal,
  zoneAbbreviation,
} from '../lib/timezone.ts';
import { TRACKING_TICK_MS, type SimulationClock } from '../state/clock.ts';
import { DateTimeField } from './DateTimeField.tsx';
import { IconChevronDown } from './Icons.tsx';
import { LiveButton } from './LiveButton.tsx';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** An hour per 24 px: a phone-wide tape spans about half a day either side. */
const MS_PER_PX = HOUR / 24;
/** Enough ticks for the widest tape, about ten hours either side. */
const TICK_HOURS = 12;
/** Momentum after a flick decays like native scrolling. */
const FLING_DECAY_MS = 325;
const FIRST = Date.UTC(MIN_YEAR, 0, 1);
const LAST = Date.UTC(MAX_YEAR + 1, 0, 1) - MINUTE;
const clampTime = (time: number) => Math.min(LAST, Math.max(FIRST, time));

interface TimeDialProps {
  clock: SimulationClock;
  clockZone: string;
  reducedMotion: boolean;
  /** Phones: part of the journey sheet instead of a floating card. */
  docked?: boolean;
  onClockZone: (value: 'local' | 'utc') => void;
  /** Shows the globe at a chosen moment. */
  onSeek: (time: number) => void;
  onLive: (live: boolean) => void;
}

/**
 * The globe's clock while there is no route: a tape of hours that scrolls under a fixed needle. Drag,
 * flick, scroll or use the arrow keys to move through the day; pick a date for distant moments; Live
 * returns to now. While Live, the clock shows seconds turning over with the device's own clock; they
 * fold away as soon as the time is moved.
 */
export function TimeDial({
  clock,
  clockZone,
  reducedMotion,
  docked = false,
  onClockZone,
  onSeek,
  onLive,
}: TimeDialProps) {
  const { t, fmt } = useI18n();
  const { time, live } = useClock(clock);
  const zone = clockZone === 'utc' ? 'UTC' : browserTimeZone();
  const local = formatLocalDateTime(utcToLocal(zone, time));
  const abbreviation = zoneAbbreviation(zone, time);
  // The year shows only away from the current one, which keeps the date short enough to stay centred.
  const [openedAt] = useState(Date.now);
  const thisYear = formatLocalDateTime(utcToLocal(zone, openedAt)).slice(0, 4);
  const seconds = String(((Math.floor(time / 1000) % 60) + 60) % 60).padStart(2, '0');
  // Live seconds need a tick every second; the ambient globe otherwise follows the wall clock twice a minute.
  useEffect(() => {
    if (!live) return;
    if (clock.liveTickMs !== TRACKING_TICK_MS) clock.goLive(TRACKING_TICK_MS);
    return () => {
      if (clock.getSnapshot().live) clock.goLive();
    };
  }, [clock, live]);
  const drag = useRef<{ x: number; from: number; last: number; at: number; velocity: number } | null>(null);
  const fling = useRef(0);
  const stopFling = () => {
    cancelAnimationFrame(fling.current);
    fling.current = 0;
  };
  useEffect(() => stopFling, []);
  const seek = (next: number) => onSeek(clampTime(next));

  const startFling = (from: number, velocity: number) => {
    let previous = performance.now();
    let position = from;
    const step = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      velocity *= Math.exp(-elapsed / FLING_DECAY_MS);
      position = clampTime(position + velocity * elapsed);
      onSeek(position);
      fling.current = Math.abs(velocity) / MS_PER_PX > 0.02 ? requestAnimationFrame(step) : 0;
    };
    fling.current = requestAnimationFrame(step);
  };

  // Hour ticks in the zone's offset at the needle, labelled every three hours and with the day at midnight.
  const offset = offsetMinutesAt(zone, time) * MINUTE;
  const first = Math.ceil((time + offset) / HOUR - TICK_HOURS) * HOUR - offset;
  const ticks = Array.from({ length: 2 * TICK_HOURS + 1 }, (_, i) => {
    const at = first + i * HOUR;
    const hour = Math.round((((at + offset) / HOUR) % 24) + 24) % 24;
    const label =
      hour === 0
        ? fmt.dayMark(new Date(at + offset).toISOString().slice(0, 10))
        : hour % 3 === 0
          ? String(hour).padStart(2, '0')
          : null;
    return { at, hour, label };
  });

  return (
    <section
      className={`time-dial${docked ? ' time-dial--docked' : ''}${live ? ' is-live' : ''}`}
      aria-label={t('dial.globeTime')}
    >
      <div className="time-dial__head">
        <label className="time-dial__clock">
          <span className="time-dial__time">
            {local.slice(11)}
            <span className="time-dial__seconds" aria-hidden="true">
              :{seconds}
            </span>
          </span>
          <span className="time-dial__zone">
            {abbreviation}
            <IconChevronDown size={12} />
          </span>
          <select
            aria-label={t('timebar.clockTimeZone')}
            value={clockZone === 'utc' ? 'utc' : 'local'}
            onChange={(e) => onClockZone(e.target.value === 'utc' ? 'utc' : 'local')}
          >
            <option value="local">{t('timebar.yourTime', zoneAbbreviation(browserTimeZone(), time))}</option>
            <option value="utc">UTC</option>
          </select>
        </label>
        <DateTimeField
          kind="date"
          label={t('timebar.globeDate')}
          value={local.slice(0, 10)}
          display={fmt.date(local.slice(0, 10), { year: local.slice(0, 4) !== thisYear })}
          placeholder={t('timebar.date')}
          onChange={(value) => {
            const next = parseLocalDateTime(`${value}T${local.slice(11)}`);
            if (next) seek(epochAtLocal(zone, next));
          }}
        />
        <LiveButton live={live} onChange={onLive} />
      </div>
      <div
        className="time-dial__tape"
        role="slider"
        tabIndex={0}
        aria-label={t('dial.globeTime')}
        aria-description={t('dial.hint')}
        aria-valuemin={FIRST}
        aria-valuemax={LAST}
        aria-valuenow={time}
        aria-valuetext={`${fmt.clock(time, zone, { weekday: true, date: true })} ${abbreviation}`}
        title={t('dial.hint')}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          stopFling();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, from: time, last: time, at: e.timeStamp, velocity: 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          // The tape moves with the finger, so dragging left reads a later time under the needle.
          const next = clampTime(d.from - (e.clientX - d.x) * MS_PER_PX);
          const elapsed = e.timeStamp - d.at;
          if (elapsed > 0) {
            d.velocity = 0.6 * ((next - d.last) / elapsed) + 0.4 * d.velocity;
            d.last = next;
            d.at = e.timeStamp;
          }
          onSeek(next);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !reducedMotion && e.timeStamp - d.at < 80 && Math.abs(d.velocity) / MS_PER_PX > 0.3)
            startFling(d.last, d.velocity);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onWheel={(e) => {
          stopFling();
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          seek(time + delta * (e.deltaMode === 1 ? 16 : 1) * MS_PER_PX);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? HOUR : 15 * MINUTE;
          const moves: Record<string, number> = {
            ArrowRight: step,
            ArrowUp: step,
            ArrowLeft: -step,
            ArrowDown: -step,
            PageUp: 24 * HOUR,
            PageDown: -24 * HOUR,
          };
          if (e.key === 'Home') onLive(true);
          else if (e.key in moves) seek(time + moves[e.key]);
          else return;
          e.preventDefault();
          stopFling();
        }}
      >
        <div className="time-dial__ticks" aria-hidden="true">
          {ticks.map(({ at, hour, label }) => (
            <span
              key={at}
              className={`time-dial__tick${hour % 3 === 0 ? ' is-major' : ''}${hour === 0 ? ' is-day' : ''}`}
              style={{ transform: `translateX(${(at - time) / MS_PER_PX}px)` }}
            >
              {label && <span className="time-dial__label">{label}</span>}
            </span>
          ))}
        </div>
        <span className="time-dial__needle" aria-hidden="true" />
      </div>
    </section>
  );
}
