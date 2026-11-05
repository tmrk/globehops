import { useRef, useState } from 'react';
import { airportCode, displayCity } from '../data/airports.ts';
import { formatDuration } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN, formatLayover, layoverChoices } from '../lib/layover.ts';
import { formatDistance } from '../lib/units.ts';
import { legColor } from '../lib/legColors.ts';
import { MAX_STOPS } from '../state/route.ts';
import { stopCaption, stopLabel, stopPlaceholder } from '../lib/stopText.ts';
import type { Airport, DistanceUnit, Layover, Leg, Stop } from '../types.ts';
import type { Journey } from '../lib/schedule.ts';
import { formatLegTimes } from '../lib/journeyText.ts';
import { LegSchedule } from './LegSchedule.tsx';
import type { LocalTimeInput } from '../types.ts';
import { CodeBadge } from './CodeBadge.tsx';
import { IconChevronDown, IconClock, IconClose, IconGrip, IconPlus } from './Icons.tsx';

export interface StopListProps {
  journey: Journey;
  activeLeg: number | null;
  activeStop: number | null;
  onTimeChange: (stop: number, field: 'arrival' | 'departure', value: LocalTimeInput | null) => void;
  stops: Stop[];
  legs: Leg[];
  /** Layovers at transfer stops, keyed by their stop index. */
  layovers: Layover[];
  lookup: (id: number) => Airport | undefined;
  unit: DistanceUnit;
  selectedLeg: number | null;
  editing: number | null;
  /** Renders the inline picker for the stop being edited (desktop). */
  renderPicker: (index: number) => React.ReactNode;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onInsert: (index: number) => void;
  onAdd: () => void;
  onMove: (from: number, to: number) => void;
  onSelectLeg: (leg: number | null) => void;
  onLayoverChange: (stopIndex: number, minutes: number | null) => void;
}

interface DragState {
  index: number;
  pointerId: number;
  startY: number;
  dy: number;
  target: number;
  mids: number[];
}

export function StopList(props: StopListProps) {
  const { stops, legs, lookup, unit, selectedLeg, editing } = props;
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const count = stops.length;

  const legByFromStop = new Map<number, Leg>();
  for (const leg of legs) if (leg.toStop === leg.fromStop + 1) legByFromStop.set(leg.fromStop, leg);
  const layoverByStop = new Map(props.layovers.map((l) => [l.stopIndex, l]));

  // ---- Drag to reorder (pointer events: mouse, touch, pen) ----
  const onGripPointerDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (e.button !== 0) return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-stop-row]') ?? []);
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ index, pointerId: e.pointerId, startY: e.clientY, dy: 0, target: index, mids });
  };
  const onGripPointerMove = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    const y = drag.mids[drag.index] + dy;
    // Final index = number of other rows whose midpoint lies above the dragged row's centre.
    let target = 0;
    drag.mids.forEach((m, j) => {
      if (j !== drag.index && y > m) target++;
    });
    setDrag({ ...drag, dy, target });
  };
  const onGripPointerUp = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.target !== drag.index && Math.abs(drag.dy) > 8) props.onMove(drag.index, drag.target);
    setDrag(null);
  };
  const onGripKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      props.onMove(index, index - 1);
    } else if (e.key === 'ArrowDown' && index < count - 1) {
      e.preventDefault();
      props.onMove(index, index + 1);
    }
  };

  return (
    <div className="itinerary">
      <ol ref={listRef} className="stops" aria-label="Journey stops">
        {stops.map((stop, i) => {
          const airport = stop.airportId !== null ? lookup(stop.airportId) : undefined;
          const leg = legByFromStop.get(i);
          const isLast = i === count - 1;
          const role = i === 0 ? 'origin' : isLast ? 'destination' : 'transfer';
          const dragging = drag?.index === i;
          const caption = stopCaption(i, count);
          const name = airport ? displayCity(airport) : '';
          const style: React.CSSProperties = {};
          if (dragging) style.transform = `translateY(${drag.dy}px)`;
          const showDropAbove = drag && drag.target === i && drag.target < drag.index;
          const showDropBelow = drag && drag.target === i && drag.target > drag.index;
          const nextColor = leg ? legColor(leg.index) : undefined;
          const layover = layoverByStop.get(i);
          const journeyLeg = leg ? props.journey.legs[leg.index] : null;
          const legTimes = journeyLeg && props.journey.dated ? formatLegTimes(journeyLeg) : null;
          const transfer = props.journey.transfers.find(
            (t) => t.stop === stops.slice(0, i).filter((s) => s.airportId !== null).length,
          );

          return (
            <li
              key={stop.key}
              className={`stop-item${dragging ? ' is-dragging' : ''}${showDropAbove ? ' drop-above' : ''}${showDropBelow ? ' drop-below' : ''}`}
              style={{ '--next-color': nextColor } as React.CSSProperties}
            >
              <div
                className={`stop${props.activeStop === stops.slice(0, i).filter((s) => s.airportId !== null).length ? ' is-active-transfer' : ''} stop--${role}${airport ? '' : ' stop--empty'}${editing === i ? ' is-editing' : ''}`}
                data-stop-row
                style={style}
              >
                <span className="stop__node" aria-hidden="true" />
                {editing === i ? (
                  <div className="stop__picker">{props.renderPicker(i)}</div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="stop__main"
                      onClick={() => props.onEdit(i)}
                      aria-label={
                        airport
                          ? `${caption}: ${airport.name} (${airportCode(airport)}). Change airport`
                          : `${stopLabel(i, count)}: choose an airport`
                      }
                    >
                      {airport ? (
                        <>
                          <CodeBadge airport={airport} />
                          <span className="stop__text">
                            <span className="stop__city">{name}</span>
                            <span className="stop__name">{airport.name}</span>
                          </span>
                        </>
                      ) : (
                        <span className="stop__placeholder">{stopPlaceholder(i, count)}</span>
                      )}
                    </button>
                    {count > 2 && (
                      <button
                        type="button"
                        className="icon-btn icon-btn--quiet stop__grip"
                        aria-label={`Reorder ${name || caption}. Use up and down arrow keys to move`}
                        onPointerDown={(e) => onGripPointerDown(e, i)}
                        onPointerMove={onGripPointerMove}
                        onPointerUp={onGripPointerUp}
                        onPointerCancel={() => setDrag(null)}
                        onKeyDown={(e) => onGripKeyDown(e, i)}
                      >
                        <IconGrip size={18} />
                      </button>
                    )}
                    {(airport || count > 2) && (
                      <button
                        type="button"
                        className="icon-btn icon-btn--quiet stop__remove"
                        aria-label={
                          count > 2 ? `Remove ${name || 'this stop'}` : `Clear ${caption.toLowerCase()} airport`
                        }
                        onClick={() => props.onRemove(i)}
                      >
                        <IconClose size={16} />
                      </button>
                    )}
                  </>
                )}
              </div>
              {layover && (
                <div className="layover" style={style}>
                  <span className="layover__line" aria-hidden="true" />
                  <span
                    className="layover__pick"
                    title={transfer?.source === 'times' ? 'From your flight times' : undefined}
                  >
                    <IconClock size={15} className="layover__icon" />
                    <span className="layover__value" aria-hidden={transfer?.source !== 'times' ? true : undefined}>
                      {transfer?.source === 'times' &&
                      (transfer.arrival?.provenance !== 'entered' || transfer.departure?.provenance !== 'entered')
                        ? '≈ '
                        : ''}
                      {formatLayover(transfer?.source === 'times' ? transfer.minutes : layover.minutes)} layover
                    </span>
                    {transfer?.source !== 'times' && (
                      <>
                        <IconChevronDown size={14} className="layover__chev" />
                        <select
                          className="layover__select"
                          aria-label={`Layover in ${displayCity(layover.airport)}`}
                          value={layover.minutes}
                          onChange={(e) => {
                            const minutes = Number(e.target.value);
                            props.onLayoverChange(i, minutes === DEFAULT_LAYOVER_MIN ? null : minutes);
                          }}
                        >
                          {layoverChoices(layover.minutes).map((m) => (
                            <option key={m} value={m}>
                              {formatLayover(m)}
                              {m === DEFAULT_LAYOVER_MIN ? ' (default)' : ''}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </span>
                </div>
              )}
              {!isLast && (
                <div
                  className={`connector${leg ? ' connector--leg' : ''}${leg && selectedLeg === leg.index ? ' is-selected' : ''}${leg && props.activeLeg === leg.index ? ' is-active' : ''}`}
                >
                  <span className="connector__line" aria-hidden="true" />
                  {leg ? (
                    <button
                      type="button"
                      className="connector__leg"
                      aria-pressed={selectedLeg === leg.index}
                      aria-expanded={selectedLeg === leg.index}
                      aria-controls={selectedLeg === leg.index ? `leg-schedule-${leg.index}` : undefined}
                      aria-label={`Flight ${leg.index + 1}, ${airportCode(leg.from)} to ${airportCode(leg.to)}: ${formatDistance(
                        leg.distanceKm,
                        unit,
                      )}${legTimes ? `, ${legTimes.dep} to ${legTimes.arr} local time` : leg.durationMin !== null ? `, about ${formatDuration(leg.durationMin)}` : ''}. ${
                        selectedLeg === leg.index
                          ? 'Selected. Close flight times'
                          : 'Show on globe and edit flight times'
                      }`}
                      onClick={() => props.onSelectLeg(selectedLeg === leg.index ? null : leg.index)}
                    >
                      <span className="connector__num">{leg.index + 1}</span>
                      <span className="connector__dist">{formatDistance(leg.distanceKm, unit)}</span>
                      {legTimes ? (
                        <span className="connector__times">
                          <span className={journeyLeg?.departure?.provenance !== 'entered' ? 'is-estimated' : ''}>
                            {journeyLeg?.departure?.provenance !== 'entered' ? '≈ ' : ''}
                            {legTimes.dep}
                          </span>{' '}
                          →{' '}
                          <span className={journeyLeg?.arrival?.provenance !== 'entered' ? 'is-estimated' : ''}>
                            {journeyLeg?.arrival?.provenance !== 'entered' ? '≈ ' : ''}
                            {legTimes.arr}
                          </span>
                          {legTimes.dayShift !== 0 && (
                            <sup>
                              {legTimes.dayShift > 0 ? '+' : '−'}
                              {Math.abs(legTimes.dayShift)}
                            </sup>
                          )}
                        </span>
                      ) : leg.durationMin !== null ? (
                        <span className="connector__time">≈ {formatDuration(leg.durationMin)}</span>
                      ) : (
                        <span className="connector__time">same airport</span>
                      )}
                    </button>
                  ) : (
                    <span className="connector__spacer" />
                  )}
                  {count < MAX_STOPS && leg && (
                    <button
                      type="button"
                      className="icon-btn icon-btn--quiet icon-btn--small connector__insert"
                      aria-label={`Add a stop after ${name || caption}`}
                      onClick={() => props.onInsert(i + 1)}
                    >
                      <IconPlus size={16} />
                    </button>
                  )}
                </div>
              )}
              {leg && journeyLeg && selectedLeg === leg.index && (
                <LegSchedule journey={props.journey} leg={journeyLeg} onChange={props.onTimeChange} />
              )}
            </li>
          );
        })}
      </ol>
      {count < MAX_STOPS && (
        <button type="button" className="add-stop" onClick={props.onAdd}>
          <IconPlus size={16} />
          <span>Add stop</span>
        </button>
      )}
    </div>
  );
}
