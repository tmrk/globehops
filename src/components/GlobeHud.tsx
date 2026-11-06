import { airportCode } from '../data/airports.ts';
import type { Leg } from '../types.ts';
import { IconChevronLeft, IconChevronRight, IconClose } from './Icons.tsx';

interface GlobeHudProps {
  legs: Leg[];
  selectedLeg: number | null;
  fits: boolean;
  onSelectLeg: (leg: number | null) => void;
}

/** Flight stepper over the globe, for routes too wide for one view or while one flight is selected. */
export function GlobeHud({ legs, selectedLeg, fits, onSelectLeg }: GlobeHudProps) {
  if (legs.length < 2 || (selectedLeg === null && fits)) return null;
  const sel = selectedLeg !== null ? legs[selectedLeg] : null;
  return (
    <div className="hud">
      <div className="leg-stepper" role="group" aria-label="Inspect flights one by one">
        <button
          type="button"
          className="float-group__btn"
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
          className="float-group__btn"
          aria-label="Next flight"
          onClick={() => onSelectLeg(selectedLeg === null ? 0 : (selectedLeg + 1) % legs.length)}
        >
          <IconChevronRight size={18} />
        </button>
        {sel && (
          <button
            type="button"
            className="float-group__btn"
            aria-label="Show the full route"
            onClick={() => onSelectLeg(null)}
          >
            <IconClose size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
