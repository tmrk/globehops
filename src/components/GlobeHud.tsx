import { airportCode } from '../data/airports.ts';
import type { Leg } from '../types.ts';
import { IconBorders, IconChevronLeft, IconChevronRight, IconClose, IconFrame, IconSunMoon } from './Icons.tsx';

interface GlobeHudProps {
  legs: Leg[];
  selectedLeg: number | null;
  fits: boolean;
  timeOpen: boolean;
  dayNight: boolean;
  onToggleDayNight: () => void;
  showBorders: boolean;
  onSelectLeg: (leg: number | null) => void;
  onFit: () => void;
  onToggleBorders: () => void;
}

/** Small floating controls over the globe: leg stepper, map layer toggle and "frame route" button. */
export function GlobeHud({
  legs,
  selectedLeg,
  fits,
  showBorders,
  onSelectLeg,
  onFit,
  onToggleBorders,
  timeOpen,
  dayNight,
  onToggleDayNight,
}: GlobeHudProps) {
  const showStepper = legs.length > 1 && (selectedLeg !== null || !fits);
  const sel = selectedLeg !== null ? legs[selectedLeg] : null;
  return (
    <div className="hud">
      {showStepper && !timeOpen && (
        <div className="leg-stepper" role="group" aria-label="Inspect flights one by one">
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous flight"
            onClick={() =>
              onSelectLeg(selectedLeg === null ? legs.length - 1 : (selectedLeg - 1 + legs.length) % legs.length)
            }
          >
            <IconChevronLeft size={18} />
          </button>
          <span className="leg-stepper__label" aria-live="polite">
            {sel ? (
              <>
                <span className="leg-stepper__num">
                  {sel.index + 1}/{legs.length}
                </span>
                {airportCode(sel.from)} → {airportCode(sel.to)}
              </>
            ) : (
              <span className="leg-stepper__hint">Step through flights</span>
            )}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next flight"
            onClick={() => onSelectLeg(selectedLeg === null ? 0 : (selectedLeg + 1) % legs.length)}
          >
            <IconChevronRight size={18} />
          </button>
          {sel && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Show the full route"
              onClick={() => onSelectLeg(null)}
            >
              <IconClose size={16} />
            </button>
          )}
        </div>
      )}
      <div className="hud__tools">
        <button
          type="button"
          className="icon-btn icon-btn--floating"
          aria-label="Country borders"
          aria-pressed={showBorders}
          title={showBorders ? 'Hide country borders' : 'Show country borders'}
          onClick={onToggleBorders}
        >
          <IconBorders />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--floating"
          aria-label="Day and night"
          aria-pressed={dayNight}
          onClick={onToggleDayNight}
        >
          <IconSunMoon />
        </button>
        {legs.length > 0 && (
          <button
            type="button"
            className="icon-btn icon-btn--floating"
            aria-label={sel ? 'Re-centre on this flight' : 'Re-centre on the route'}
            title="Re-centre"
            onClick={onFit}
          >
            <IconFrame />
          </button>
        )}
      </div>
    </div>
  );
}
