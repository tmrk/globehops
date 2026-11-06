import { useRef, useState } from 'react';
import { airportCode, displayCity, displayCode } from '../data/airports.ts';
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
import { IconChevronDown, IconClock, IconClose, IconGrip, IconPlane, IconPlus, IconSwap, IconTrash } from './Icons.tsx';

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
  /** Edit mode: reorder, remove and insert controls, plus reverse and clear. */
  arranging: boolean;
  /** Renders the inline picker for the stop being edited (desktop). */
  renderPicker: (index: number) => React.ReactNode;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onInsert: (index: number) => void;
  onAdd: () => void;
  onMove: (from: number, to: number) => void;
  onSelectLeg: (leg: number | null) => void;
  onLayoverChange: (stopIndex: number, minutes: number | null) => void;
  onReverse: () => void;
  onClear: () => void;
}

interface DragState {
  index: number;
  pointerId: number;
  startY: number;
  dy: number;
  target: number;
  mids: number[];
}

/** How the route line looks in one half of a row: a flight (leg colour), ground time, or not yet a flight. */
type Segment = 'leg' | 'ground' | 'pending' | null;

/**
 * The route line beside each row. Every row draws its own top and bottom half, so the line stays
 * continuous whatever the rows' heights are, and a node marks each airport.
 */
function Rail({
  top,
  bottom,
  topColor,
  bottomColor,
  node,
}: {
  top: Segment;
  bottom: Segment;
  topColor?: string;
  bottomColor?: string;
  node?: boolean;
}) {
  return (
    <span
      className={`rail${top ? ` rail--top-${top}` : ''}${bottom ? ` rail--bottom-${bottom}` : ''}`}
      style={{ '--rail-top': topColor, '--rail-bottom': bottomColor } as React.CSSProperties}
      aria-hidden="true"
    >
      {node && <span className="rail__node" />}
    </span>
  );
}

export function StopList(props: StopListProps) {
  const { stops, legs, lookup, unit, selectedLeg, editing, arranging } = props;
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const count = stops.length;
  const filled = stops.filter((s) => s.airportId !== null).length;

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

  const canAdd = count < MAX_STOPS && stops.every((s) => s.airportId !== null);

  return (
    <div className={`itinerary${arranging ? ' is-arranging' : ''}`}>
      <ol ref={listRef} className="stops" aria-label="Journey stops">
        {stops.map((stop, i) => {
          const airport = stop.airportId !== null ? lookup(stop.airportId) : undefined;
          const leg = legByFromStop.get(i);
          const prevLeg = legByFromStop.get(i - 1);
          const isLast = i === count - 1;
          const role = i === 0 ? 'origin' : isLast ? 'destination' : 'transfer';
          const dragging = drag?.index === i;
          const caption = stopCaption(i, count);
          const name = airport ? displayCity(airport) : '';
          const style: React.CSSProperties = {};
          if (dragging) style.transform = `translateY(${drag.dy}px)`;
          const showDropAbove = drag && drag.target === i && drag.target < drag.index;
          const showDropBelow = drag && drag.target === i && drag.target > drag.index;
          const color = leg ? legColor(leg.index) : undefined;
          const layover = layoverByStop.get(i);
          const journeyLeg = leg ? props.journey.legs[leg.index] : null;
          const legTimes = journeyLeg && props.journey.dated ? formatLegTimes(journeyLeg) : null;
          const filledBefore = stops.slice(0, i).filter((s) => s.airportId !== null).length;
          const transfer = props.journey.transfers.find((t) => t.stop === filledBefore);
          const selected = !!leg && selectedLeg === leg.index && !arranging;
          const top: Segment = i === 0 ? null : prevLeg ? 'leg' : 'pending';
          const bottom: Segment = isLast ? null : layover ? 'ground' : leg ? 'leg' : 'pending';
          const facts = leg
            ? `${formatDistance(leg.distanceKm, unit)}${
                legTimes ? '' : leg.durationMin !== null ? ` · ≈ ${formatDuration(leg.durationMin)}` : ' · same airport'
              }`
            : '';

          return (
            <li
              key={stop.key}
              className={`stop-item${dragging ? ' is-dragging' : ''}${showDropAbove ? ' drop-above' : ''}${showDropBelow ? ' drop-below' : ''}`}
            >
              <div
                className={`row stop stop--${role}${airport ? '' : ' stop--empty'}${editing === i ? ' is-editing' : ''}${
                  props.activeStop === filledBefore && airport ? ' is-active-transfer' : ''
                }`}
                data-stop-row
                style={style}
              >
                <Rail
                  top={top}
                  bottom={bottom}
                  topColor={prevLeg ? legColor(prevLeg.index) : undefined}
                  bottomColor={color}
                  node
                />
                {editing === i ? (
                  <div className="stop__picker">{props.renderPicker(i)}</div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="stop__main"
                      onClick={() => props.onEdit(i)}
                      title={airport?.name}
                      aria-label={
                        airport
                          ? `${caption}: ${airport.name} (${airportCode(airport)}). Change airport`
                          : `${stopLabel(i, count)}: choose an airport`
                      }
                    >
                      {airport ? (
                        <>
                          <CodeBadge airport={airport} />
                          {/* Code and city identify the airport, as on a boarding pass. Airfields without a
                              code show their name instead; full names stay in search and the label. */}
                          <span className="stop__city">{displayCode(airport) ? name : airport.name}</span>
                        </>
                      ) : (
                        <span className="stop__placeholder">{stopPlaceholder(i, count)}</span>
                      )}
                    </button>
                    {arranging && (
                      <span className="row__tools">
                        {count > 2 ? (
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
                        ) : null}
                        {airport || count > 2 ? (
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
                        ) : (
                          <span className="icon-btn" aria-hidden="true" />
                        )}
                      </span>
                    )}
                  </>
                )}
              </div>
              {layover && (
                <div className="row layover" style={style}>
                  <Rail top="ground" bottom="ground" />
                  <span className="row__icon">
                    <IconClock size={16} />
                  </span>
                  <span
                    className={`layover__pick${transfer?.source === 'times' ? ' is-fixed' : ''}`}
                    title={transfer?.source === 'times' ? 'From your flight times' : undefined}
                  >
                    <span className="layover__value" aria-hidden={transfer?.source !== 'times' ? true : undefined}>
                      {transfer?.source === 'times' &&
                      (transfer.arrival?.provenance !== 'entered' || transfer.departure?.provenance !== 'entered')
                        ? '≈ '
                        : ''}
                      <b>{formatLayover(transfer?.source === 'times' ? transfer.minutes : layover.minutes)}</b> layover
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
              {!isLast &&
                (leg ? (
                  <div
                    className={`row leg${selected ? ' is-selected' : ''}${props.activeLeg === leg.index ? ' is-active' : ''}`}
                    style={{ '--leg': color } as React.CSSProperties}
                  >
                    <Rail top="leg" bottom="leg" topColor={color} bottomColor={color} />
                    {arranging ? (
                      <>
                        <span className="leg__body">
                          <span className="row__icon leg__icon">
                            <IconPlane size={15} />
                          </span>
                          <span className="leg__facts">{facts}</span>
                        </span>
                        {count < MAX_STOPS && (
                          <span className="row__tools">
                            <button
                              type="button"
                              className="icon-btn icon-btn--quiet"
                              aria-label={`Add a stop after ${name || caption}`}
                              onClick={() => props.onInsert(i + 1)}
                            >
                              <IconPlus size={17} />
                            </button>
                          </span>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="leg__body leg__main"
                        data-leg={leg.index}
                        aria-pressed={selected}
                        aria-expanded={selected}
                        aria-controls={selected ? `leg-schedule-${leg.index}` : undefined}
                        aria-label={`Flight ${leg.index + 1}, ${airportCode(leg.from)} to ${airportCode(leg.to)}: ${formatDistance(
                          leg.distanceKm,
                          unit,
                        )}${legTimes ? `, ${legTimes.dep} to ${legTimes.arr} local time` : leg.durationMin !== null ? `, about ${formatDuration(leg.durationMin)}` : ''}. ${
                          selected
                            ? 'Selected. Close flight times'
                            : legTimes
                              ? 'Show on globe and change flight times'
                              : 'Show on globe and add flight times'
                        }`}
                        onClick={() => props.onSelectLeg(selected ? null : leg.index)}
                      >
                        <span className="row__icon leg__icon">
                          <IconPlane size={15} />
                        </span>
                        <span className="leg__facts">{facts}</span>
                        {leg.durationMin !== null && (
                          <span className={`leg__when${legTimes ? ' has-times' : ''}`}>
                            {legTimes ? (
                              <span className="leg__times">
                                <span className={journeyLeg?.departure?.provenance !== 'entered' ? 'is-estimated' : ''}>
                                  {journeyLeg?.departure?.provenance !== 'entered' ? '≈' : ''}
                                  {legTimes.dep}
                                </span>
                                <span className="leg__arrow">→</span>
                                <span className={journeyLeg?.arrival?.provenance !== 'entered' ? 'is-estimated' : ''}>
                                  {journeyLeg?.arrival?.provenance !== 'entered' ? '≈' : ''}
                                  {legTimes.arr}
                                </span>
                                {legTimes.dayShift !== 0 && (
                                  <sup>
                                    {legTimes.dayShift > 0 ? '+' : '−'}
                                    {Math.abs(legTimes.dayShift)}
                                  </sup>
                                )}
                              </span>
                            ) : (
                              <span className="leg__add">Add times</span>
                            )}
                            <IconChevronDown size={14} className="leg__chev" />
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="row gap" aria-hidden="true">
                    <Rail top="pending" bottom="pending" />
                  </div>
                ))}
              {leg && journeyLeg && selected && (
                <div className="row leg-detail" style={{ '--leg': color } as React.CSSProperties}>
                  <Rail top="leg" bottom="leg" topColor={color} bottomColor={color} />
                  <LegSchedule
                    journey={props.journey}
                    leg={journeyLeg}
                    onChange={props.onTimeChange}
                    onClose={() => {
                      const index = leg.index;
                      props.onSelectLeg(null);
                      // The Done button disappears with the editor; return focus to the flight it belonged to.
                      requestAnimationFrame(() =>
                        listRef.current?.querySelector<HTMLElement>(`.leg__main[data-leg="${index}"]`)?.focus(),
                      );
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {(canAdd || arranging) && (
        <div className="itinerary__actions">
          {canAdd && (
            <button type="button" className="row row--action add-stop" onClick={props.onAdd}>
              <Rail top={null} bottom={null} />
              <span className="row__icon">
                <IconPlus size={17} />
              </span>
              <span>Add stop</span>
            </button>
          )}
          {arranging && (
            <>
              <button type="button" className="row row--action" onClick={props.onReverse} disabled={filled < 2}>
                <Rail top={null} bottom={null} />
                <span className="row__icon">
                  <IconSwap size={17} />
                </span>
                <span>Reverse route</span>
              </button>
              <button
                type="button"
                className="row row--action row--danger"
                onClick={props.onClear}
                disabled={filled === 0 && count === 2}
              >
                <Rail top={null} bottom={null} />
                <span className="row__icon">
                  <IconTrash size={17} />
                </span>
                <span>Clear route</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
