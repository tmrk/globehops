import { useRef, type CSSProperties } from 'react';

export interface SectionSwitchItem {
  name: string;
  /** Muted text after the name, e.g. the journey's date. */
  detail?: string;
}

interface Props {
  items: SectionSwitchItem[];
  active: number;
  /** The compared trip's colour. */
  color: string;
  /** Accessible name of the tab list. */
  label: string;
  onActivate: (index: number) => void;
}

/**
 * The journeys of one compared trip (Outbound, Return, …) as a segmented control under the trips' tabs:
 * every trip has the same journeys, so switching trips keeps the journey and switching here keeps the trip.
 */
export function SectionSwitch({ items, active, color, label, onActivate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="section-switch"
      role="tablist"
      aria-label={label}
      style={{ '--journey-color': color } as CSSProperties}
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="tab"
          id={`section-tab-${index}`}
          aria-controls="journey-panel"
          aria-selected={active === index}
          tabIndex={active === index ? 0 : -1}
          className="section-switch__tab"
          onClick={() => onActivate(index)}
          onKeyDown={(event) => {
            const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
            const target =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : step !== undefined
                    ? (index + step + items.length) % items.length
                    : null;
            if (target === null) return;
            event.preventDefault();
            onActivate(target);
            ref.current?.querySelector<HTMLElement>(`#section-tab-${target}`)?.focus();
          }}
        >
          <span className="section-switch__label">
            <span className="section-switch__name">{item.name}</span>
            {item.detail && <span className="section-switch__detail">{item.detail}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
