import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { IconPlus } from './Icons.tsx';

export interface JourneyTabItem {
  /** Stable, unique id: the compared journey's letter or the trip journey's number. */
  id: string;
  /** Key tile text: A–D for alternatives, 1–6 for a trip's journeys. */
  chip: string;
  /** Alternatives carry their colour; a trip's journeys share one traveller and stay neutral. */
  color?: string;
  label: string;
  /** Muted text after the label, e.g. a journey's route. */
  detail?: string;
}

interface Props {
  items: JourneyTabItem[];
  active: number;
  /** Accessible name of the tab list. */
  label: string;
  onActivate: (index: number) => void;
  /** Adds a journey; absent at the limit. */
  onAdd?: () => void;
  addLabel: string;
}

/** Journey tabs: compared alternatives (A–D) or a trip's sequential journeys. */
export function JourneyTabs({ items, active, label, onActivate, onAdd, addLabel }: Props) {
  const tabsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const selected = tabs?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!tabs || !selected) return;
    const visible = tabs.getBoundingClientRect();
    const bounds = selected.getBoundingClientRect();
    if (bounds.left < visible.left) tabs.scrollLeft += bounds.left - visible.left;
    else if (bounds.right > visible.right) tabs.scrollLeft += bounds.right - visible.right;
  }, [active, items]);
  return (
    <div className="journey-tabs-wrap">
      <div ref={tabsRef} className="journey-tabs" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`journey-tab-${item.id}`}
            aria-controls="journey-panel"
            aria-selected={active === index}
            tabIndex={active === index ? 0 : -1}
            className={`journey-tab${item.color ? '' : ' journey-tab--section'}`}
            style={item.color ? ({ '--journey-color': item.color } as CSSProperties) : undefined}
            onClick={() => onActivate(index)}
            onKeyDown={(event) => {
              let target: number;
              switch (event.key) {
                case 'Home':
                  target = 0;
                  break;
                case 'End':
                  target = items.length - 1;
                  break;
                case 'ArrowLeft':
                  target = (index + items.length - 1) % items.length;
                  break;
                case 'ArrowRight':
                  target = (index + 1) % items.length;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              onActivate(target);
              tabsRef.current?.querySelector<HTMLElement>(`#journey-tab-${items[target].id}`)?.focus();
            }}
          >
            <span className={`journey-chip${item.color ? '' : ' journey-chip--section'}`}>{item.chip}</span>
            <span className="journey-tab__route">
              {item.label}
              {item.detail && <span className="journey-tab__detail"> {item.detail}</span>}
            </span>
          </button>
        ))}
      </div>
      {onAdd && (
        <button
          type="button"
          className="icon-btn icon-btn--quiet"
          aria-label={addLabel}
          title={addLabel}
          onClick={onAdd}
        >
          <IconPlus size={17} />
        </button>
      )}
    </div>
  );
}
