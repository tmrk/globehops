import { useRef, useState } from 'react';
import { airportCode, displayCity } from '../data/airports.ts';
import { formatDuration } from '../lib/flightTime.ts';
import { formatDistance } from '../lib/units.ts';
import { legColor } from '../lib/legColors.ts';
import { MAX_STOPS } from '../state/route.ts';
import { stopCaption, stopLabel, stopPlaceholder } from '../lib/stopText.ts';
import type { Airport, DistanceUnit, Leg, Stop } from '../types.ts';
import { CodeBadge } from './CodeBadge.tsx';
import { IconClose, IconGrip, IconPlus } from './Icons.tsx';

export interface StopListProps {
  stops: Stop[];
  legs: Leg[];
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

          return (
            <li
              key={stop.key}
              className={`stop-item${dragging ? ' is-dragging' : ''}${showDropAbove ? ' drop-above' : ''}${showDropBelow ? ' drop-below' : ''}`}
              style={{ '--next-color': nextColor } as React.CSSProperties}
            >
              <div
                className={`stop stop--${role}${airport ? '' : ' stop--empty'}${editing === i ? ' is-editing' : ''}`}
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
              {!isLast && (
                <div
                  className={`connector${leg ? ' connector--leg' : ''}${leg && selectedLeg === leg.index ? ' is-selected' : ''}`}
                >
                  <span className="connector__line" aria-hidden="true" />
                  {leg ? (
                    <button
                      type="button"
                      className="connector__leg"
                      aria-pressed={selectedLeg === leg.index}
                      aria-label={`Flight ${leg.index + 1}, ${airportCode(leg.from)} to ${airportCode(leg.to)}: ${formatDistance(
                        leg.distanceKm,
                        unit,
                      )}${leg.durationMin !== null ? `, about ${formatDuration(leg.durationMin)}` : ''}. ${
                        selectedLeg === leg.index ? 'Selected. Activate to show the full route' : 'Show on globe'
                      }`}
                      onClick={() => props.onSelectLeg(selectedLeg === leg.index ? null : leg.index)}
                    >
                      <span className="connector__num">{leg.index + 1}</span>
                      <span className="connector__dist">{formatDistance(leg.distanceKm, unit)}</span>
                      {leg.durationMin !== null ? (
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
