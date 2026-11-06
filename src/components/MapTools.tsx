import { LanguageSelector } from '../i18n/LanguageSelector.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { SimulationClock } from '../state/clock.ts';
import { browserTimeZone, zoneAbbreviation } from '../lib/timezone.ts';
import type { DistanceUnit } from '../types.ts';
import {
  IconBorders,
  IconChevronRight,
  IconClock,
  IconFrame,
  IconLabels,
  IconLayers,
  IconRuler,
  IconSunMoon,
} from './Icons.tsx';

interface MapToolsProps {
  clock: SimulationClock;
  /** False when WebGL is unavailable: only settings that still matter are offered. */
  globe: boolean;
  showBorders: boolean;
  showCountryNames: boolean;
  dayNight: boolean;
  unit: DistanceUnit;
  timeOpen: boolean;
  /** Label for the re-centre button, or null when there is nothing to frame. */
  frameLabel: string | null;
  onToggleBorders: () => void;
  onToggleCountryNames: () => void;
  onToggleDayNight: () => void;
  onUnitChange: (unit: DistanceUnit) => void;
  onOpenTime: () => void;
  onFit: () => void;
}

/** Minute-level globe clock, the entry to the time controls when no journey is playing. */
function GlobeTime({ clock, onOpen }: { clock: SimulationClock; onOpen: () => void }) {
  const { t, fmt } = useI18n();

  const snapshot = useCallback(() => Math.floor(clock.getSnapshot().time / 60000) * 60000, [clock]);
  const time = useSyncExternalStore(clock.subscribe, snapshot);
  const zone = browserTimeZone();
  const label = fmt.clock(time, zone);
  return (
    <button
      type="button"
      className="map-menu__item"
      onClick={onOpen}
      aria-label={t('maptools.clockAction', label, zoneAbbreviation(zone, time))}
    >
      <IconClock size={18} className="map-menu__icon" />
      <span className="map-menu__label">{t('maptools.globeTime')}</span>
      <span className="map-menu__value">{t('maptools.nowTime', label)}</span>
      <IconChevronRight size={14} className="map-menu__chev" />
    </button>
  );
}

function Toggle({
  label,
  icon,
  on,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="map-menu__item" aria-pressed={on} onClick={onClick}>
      <span className="map-menu__icon">{icon}</span>
      <span className="map-menu__label">{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

/**
 * One grouped control at the globe's top-right corner: display options (map layers, units and the
 * globe clock) in a small menu, and re-centring on the route.
 */
export function MapTools(props: MapToolsProps) {
  const { t } = useI18n();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="map-tools" ref={rootRef}>
      <div className="float-group" role="group" aria-label={t('maptools.globeControls')}>
        <button
          ref={buttonRef}
          type="button"
          className="float-group__btn"
          aria-label={t('maptools.displayOptions')}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          <IconLayers />
        </button>
        {props.frameLabel && props.globe && (
          <button
            type="button"
            className="float-group__btn"
            aria-label={props.frameLabel}
            title={t('maptools.reCentre')}
            onClick={props.onFit}
          >
            <IconFrame />
          </button>
        )}
      </div>
      {open && (
        <div id={menuId} className="map-menu" role="group" aria-label={t('maptools.displayOptions')}>
          {props.globe && (
            <>
              <Toggle
                label={t('maptools.countryBorders')}
                icon={<IconBorders size={18} />}
                on={props.showBorders}
                onClick={props.onToggleBorders}
              />
              <Toggle
                label={t('maptools.countryNames')}
                icon={<IconLabels size={18} />}
                on={props.showCountryNames}
                onClick={props.onToggleCountryNames}
              />
              <Toggle
                label={t('maptools.dayAndNight')}
                icon={<IconSunMoon size={18} />}
                on={props.dayNight}
                onClick={props.onToggleDayNight}
              />
            </>
          )}
          <div className="map-menu__item map-menu__item--static">
            <span className="map-menu__icon">
              <IconRuler size={18} />
            </span>
            <span className="map-menu__label">{t('maptools.distance')}</span>
            <span className="segmented" role="radiogroup" aria-label={t('maptools.distanceUnit')}>
              {(['km', 'mi'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={props.unit === u}
                  onClick={() => props.onUnitChange(u)}
                >
                  {u}
                </button>
              ))}
            </span>
          </div>
          <hr className="map-menu__rule" />
          <LanguageSelector />
          {!props.timeOpen && (
            <>
              <hr className="map-menu__rule" />
              <GlobeTime
                clock={props.clock}
                onOpen={() => {
                  setOpen(false);
                  props.onOpenTime();
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
