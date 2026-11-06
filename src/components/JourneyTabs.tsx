import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { airportCode } from '../data/airports.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { MAX_JOURNEYS, type ComparedJourney } from '../lib/compare.ts';
import { IconPlus } from './Icons.tsx';

interface Props {
  list: ComparedJourney[];
  active: number;
  onActivate: (index: number) => void;
  onAdd: () => void;
}

export function JourneyTabs({ list, active, onActivate, onAdd }: Props) {
  const { t } = useI18n();
  const tabsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const selected = tabs?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!tabs || !selected) return;
    const visible = tabs.getBoundingClientRect();
    const bounds = selected.getBoundingClientRect();
    if (bounds.left < visible.left) tabs.scrollLeft += bounds.left - visible.left;
    else if (bounds.right > visible.right) tabs.scrollLeft += bounds.right - visible.right;
  }, [active, list]);
  return (
    <div className="journey-tabs-wrap">
      <div ref={tabsRef} className="journey-tabs" role="tablist" aria-label={t('compare.journeys')}>
        {list.map((entry, index) => {
          const airports = entry.journey.stops.map((stop) => airportCode(stop.airport));
          const label =
            entry.label ??
            (airports.length
              ? (airports.length <= 3 ? airports : [airports[0], '…', airports.at(-1)]).join(' → ')
              : t('compare.chooseAirports'));
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`journey-tab-${entry.id}`}
              aria-controls="journey-panel"
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              className="journey-tab"
              style={{ '--journey-color': entry.color } as CSSProperties}
              onClick={() => onActivate(index)}
              onKeyDown={(event) => {
                const target =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? list.length - 1
                      : event.key === 'ArrowLeft'
                        ? (index + list.length - 1) % list.length
                        : event.key === 'ArrowRight'
                          ? (index + 1) % list.length
                          : null;
                if (target === null) return;
                event.preventDefault();
                onActivate(target);
                document.getElementById(`journey-tab-${list[target].id}`)?.focus();
              }}
            >
              <span className="journey-chip">{entry.id}</span>
              <span className="journey-tab__route">{label}</span>
            </button>
          );
        })}
      </div>
      {list.length < MAX_JOURNEYS && (
        <button
          type="button"
          className="icon-btn icon-btn--quiet"
          aria-label={t('compare.add')}
          title={t('compare.add')}
          onClick={onAdd}
        >
          <IconPlus size={17} />
        </button>
      )}
    </div>
  );
}
