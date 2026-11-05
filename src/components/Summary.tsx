import { useId, useState } from 'react';
import { DEFAULT_ALTITUDE_MODEL } from '../lib/altitude.ts';
import { DEFAULT_FLIGHT_TIME_MODEL, formatDuration, sumDurations } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN, formatLayover } from '../lib/layover.ts';
import { formatDistanceNumber } from '../lib/units.ts';
import type { DistanceUnit, Layover, Leg } from '../types.ts';
import { IconInfo } from './Icons.tsx';

interface SummaryProps {
  legs: Leg[];
  layovers: Layover[];
  unit: DistanceUnit;
  onUnitChange: (unit: DistanceUnit) => void;
}

export function Summary({ legs, layovers, unit, onUnitChange }: SummaryProps) {
  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();
  const totalKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  const flightMin = sumDurations(legs.map((l) => l.durationMin));
  const groundMin = layovers.reduce((s, l) => s + l.minutes, 0);
  const totalMin = flightMin ? flightMin + groundMin : 0;
  const flights = legs.length;
  const m = DEFAULT_FLIGHT_TIME_MODEL;
  const speed = unit === 'km' ? `${m.cruiseSpeedKmh} km/h` : `${Math.round(m.cruiseSpeedKmh / 1.609344 / 5) * 5} mph`;
  const cruise =
    unit === 'km'
      ? `${DEFAULT_ALTITUDE_MODEL.cruiseAltitudeKm} km`
      : `${Math.round((DEFAULT_ALTITUDE_MODEL.cruiseAltitudeKm * 3280.84) / 1000) * 1000} ft`;

  const note =
    flights === 0
      ? 'Choose two airports to see the great-circle route.'
      : layovers.length
        ? `${flights} flights · ${formatDuration(flightMin)} flying · ${formatDuration(groundMin)} ${
            layovers.length === 1 ? 'layover' : 'in layovers'
          }`
        : `${flights} flight${flights === 1 ? '' : 's'} · shortest great-circle distance`;

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
            {layovers.length ? 'Est. total time' : 'Est. flight time'}
            <button
              type="button"
              className="info-btn"
              aria-expanded={showInfo}
              aria-controls={infoId}
              aria-label="How times are estimated"
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
      <p className="summary__note">{note}</p>
      <div id={infoId} className="summary__info" hidden={!showInfo}>
        <p>
          Flight times are estimates, not schedules: great-circle distance at an average {speed}, plus{' '}
          {m.overheadMinutes} min for take-off, climb, approach and landing. Real flights vary with winds, routing, air
          traffic control and taxi times.
        </p>
        <p>
          Each connection adds a layover, {formatLayover(DEFAULT_LAYOVER_MIN)} unless you change it under the connecting
          airport. Arcs climb to a typical cruising altitude of about {cruise}, hold it, and descend before landing;
          height is exaggerated so it shows on the globe.
        </p>
      </div>
    </section>
  );
}
