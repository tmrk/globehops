import { localeInfo } from '../i18n/locales.ts';
import { LanguageOptions } from '../i18n/LanguageSelector.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { useEffect, useId, useRef, useState } from 'react';
import type { DistanceUnit } from '../types.ts';
import {
  IconDetour,
  IconDiversion,
  IconLanguage,
  IconWaves,
  IconMotion,
  IconLocate,
  IconBorders,
  IconFrame,
  IconLabels,
  IconLayers,
  IconMoon,
  IconRuler,
  IconSunMoon,
} from './Icons.tsx';

interface MapToolsProps {
  /** False when WebGL is unavailable: only settings that still matter are offered. */
  globe: boolean;
  /** Cinematic playback hides the controls; they leave the tab order too. */
  hidden?: boolean;
  showBorders: boolean;
  showCountryNames: boolean;
  showWaterNames: boolean;
  reducedMotion: boolean;
  myLocation: boolean;
  locationAvailable: boolean;
  onToggleWaterNames: () => void;
  onToggleReduceMotion: () => void;
  onToggleMyLocation: () => void;
  dayNight: boolean;
  unit: DistanceUnit;
  avoidAirspace: boolean;
  onToggleAvoidAirspace: () => void;
  diversionRouting: boolean;
  onToggleDiversionRouting: () => void;
  /** Label for the re-centre button, or null when there is nothing to frame. */
  frameLabel: string | null;
  onToggleBorders: () => void;
  onToggleCountryNames: () => void;
  onToggleDayNight: () => void;
  onUnitChange: (unit: DistanceUnit) => void;
  /** Turns the globe to the Moon; offered while the sky is shown. */
  onFindMoon?: () => void;
  onFit: () => void;
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
    <button type="button" className="map-menu__item" title={label} aria-pressed={on} onClick={onClick}>
      <span className="map-menu__icon">{icon}</span>
      <span className="map-menu__label">{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

/**
 * One grouped control at the globe's top-right corner: display options (map layers and units) in a
 * small menu, a language menu, and re-centring on the route.
 */
export function MapTools(props: MapToolsProps) {
  const { t, locale } = useI18n();

  const [open, setOpen] = useState<'display' | 'language' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const languageButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const languageMenuId = useId();
  const closeLanguage = () => {
    setOpen(null);
    languageButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(null);
      (open === 'language' ? languageButtonRef : buttonRef).current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="map-tools" ref={rootRef} inert={props.hidden}>
      <div className="float-group" role="group" aria-label={t('maptools.globeControls')}>
        <button
          ref={buttonRef}
          type="button"
          className="float-group__btn"
          aria-label={t('maptools.displayOptions')}
          aria-expanded={open === 'display'}
          aria-controls={menuId}
          onClick={() => setOpen((v) => (v === 'display' ? null : 'display'))}
        >
          <IconLayers />
        </button>
        <button
          ref={languageButtonRef}
          type="button"
          className="float-group__btn"
          aria-label={t('maptools.languageButton', localeInfo[locale].name)}
          aria-expanded={open === 'language'}
          aria-controls={languageMenuId}
          title={t('common.language')}
          onClick={() => setOpen((v) => (v === 'language' ? null : 'language'))}
        >
          <IconLanguage />
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
      {open === 'display' && (
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
                label={t('maptools.waterNames')}
                icon={<IconWaves size={18} />}
                on={props.showWaterNames}
                onClick={props.onToggleWaterNames}
              />
              <Toggle
                label={t('maptools.dayAndNight')}
                icon={<IconSunMoon size={18} />}
                on={props.dayNight}
                onClick={props.onToggleDayNight}
              />
              {props.onFindMoon && (
                <button
                  type="button"
                  className="map-menu__item"
                  onClick={() => {
                    setOpen(null);
                    props.onFindMoon?.();
                  }}
                >
                  <IconMoon size={18} className="map-menu__icon" />
                  <span className="map-menu__label">{t('maptools.findMoon')}</span>
                </button>
              )}
            </>
          )}
          {props.globe && props.locationAvailable && (
            <Toggle
              label={t('maptools.myLocation')}
              icon={<IconLocate size={18} />}
              on={props.myLocation}
              onClick={props.onToggleMyLocation}
            />
          )}
          <hr className="map-menu__rule" />
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
                  tabIndex={props.unit === u ? 0 : -1}
                  onKeyDown={(event) => {
                    let next: DistanceUnit;
                    switch (event.key) {
                      case 'Home':
                        next = 'km';
                        break;
                      case 'End':
                        next = 'mi';
                        break;
                      case 'ArrowLeft':
                      case 'ArrowRight':
                      case 'ArrowUp':
                      case 'ArrowDown':
                        next = u === 'km' ? 'mi' : 'km';
                        break;
                      default:
                        return;
                    }
                    event.preventDefault();
                    props.onUnitChange(next);
                    const radios =
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]');
                    radios?.[next === 'km' ? 0 : 1]?.focus();
                  }}
                  onClick={() => props.onUnitChange(u)}
                >
                  {u}
                </button>
              ))}
            </span>
          </div>
          <Toggle
            label={t('maptools.avoidAirspace')}
            icon={<IconDetour size={18} />}
            on={props.avoidAirspace}
            onClick={props.onToggleAvoidAirspace}
          />
          <Toggle
            label={t('maptools.diversionRouting')}
            icon={<IconDiversion size={18} />}
            on={props.diversionRouting}
            onClick={props.onToggleDiversionRouting}
          />
          <Toggle
            label={t('maptools.reduceMotion')}
            icon={<IconMotion size={18} />}
            on={props.reducedMotion}
            onClick={props.onToggleReduceMotion}
          />
        </div>
      )}
      {open === 'language' && (
        <div
          id={languageMenuId}
          className="map-menu map-menu--language"
          role="radiogroup"
          aria-label={t('common.language')}
        >
          <LanguageOptions menu onSelect={closeLanguage} />
        </div>
      )}
    </div>
  );
}
