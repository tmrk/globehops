import { useId, useState } from 'react';
import { DEFAULT_FLIGHT_TIME_MODEL, formatDuration, sumDurations } from '../lib/flightTime.ts';
import { formatDistanceNumber } from '../lib/units.ts';
import type { DistanceUnit, Leg } from '../types.ts';
import { IconInfo } from './Icons.tsx';

interface SummaryProps {
  legs: Leg[];
  unit: DistanceUnit;
  onUnitChange: (unit: DistanceUnit) => void;
}

export function Summary({ legs, unit, onUnitChange }: SummaryProps) {
  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();
  const totalKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  const totalMin = sumDurations(legs.map((l) => l.durationMin));
  const flights = legs.length;
  const m = DEFAULT_FLIGHT_TIME_MODEL;
  const speed = unit === 'km' ? `${m.cruiseSpeedKmh} km/h` : `${Math.round(m.cruiseSpeedKmh / 1.609344 / 5) * 5} mph`;

  return (
    <section className="summary" aria-label="Journey totals">
      <div className="summary__row">
        <div className="stat">
          <span className="stat__label">{flights > 1 ? 'Total distance' : 'Distance'}</span>
          <span className="stat__value">
            {flights ? formatDistanceNumber(totalKm, unit) : '—'}
            <span className="stat__unit">{unit}</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">
            Est. flight time
            <button
              type="button"
              className="info-btn"
              aria-expanded={showInfo}
              aria-controls={infoId}
              aria-label="How flight time is estimated"
              onClick={() => setShowInfo((v) => !v)}
            >
              <IconInfo size={15} />
            </button>
          </span>
          <span className="stat__value">{flights && totalMin ? `≈ ${formatDuration(totalMin)}` : '—'}</span>
        </div>
        <div className="unit-toggle" role="radiogroup" aria-label="Distance unit">
          {(['km', 'mi'] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              className={unit === u ? 'is-on' : ''}
              onClick={() => onUnitChange(u)}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <p className="summary__note">
        {flights === 0
          ? 'Choose two airports to see the great-circle route.'
          : `${flights} flight${flights === 1 ? '' : 's'} · shortest great-circle distance${flights > 1 ? ', excluding layovers' : ''}`}
      </p>
      <div id={infoId} className="summary__info" hidden={!showInfo}>
        <p>
          Flight times are estimates, not schedules: great-circle distance at an average {speed}, plus{' '}
          {m.overheadMinutes} min for take-off, climb, approach and landing. Real flights vary with winds, routing, air
          traffic control and taxi times.
        </p>
      </div>
    </section>
  );
}
