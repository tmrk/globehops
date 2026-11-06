import { useId, useState } from 'react';
import { DEFAULT_ALTITUDE_MODEL } from '../lib/altitude.ts';
import { DEFAULT_FLIGHT_TIME_MODEL, formatDuration, sumDurations } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN, formatLayover } from '../lib/layover.ts';
import { formatDistanceNumber } from '../lib/units.ts';
import type { DistanceUnit, Layover, Leg } from '../types.ts';
import type { Journey } from '../lib/schedule.ts';
import { airportCode } from '../data/airports.ts';
import { formatClock } from '../lib/timezone.ts';
import { IconInfo } from './Icons.tsx';

interface SummaryProps {
  journey: Journey;
  onCheckLeg: (leg: number) => void;
  legs: Leg[];
  layovers: Layover[];
  unit: DistanceUnit;
  /** The primary action beside the totals (Play), if any. */
  action?: React.ReactNode;
}

/** Journey totals, pinned to the bottom of the panel like the total on a ticket. */
export function Summary({ journey, onCheckLeg, legs, layovers, unit, action }: SummaryProps) {
  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();
  const totalKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  const flightMin = journey.dated ? journey.totals.flightMin : sumDurations(legs.map((l) => l.durationMin));
  const groundMin = journey.dated ? journey.totals.layoverMin : layovers.reduce((s, l) => s + l.minutes, 0);
  const totalMin = flightMin ? flightMin + groundMin : 0;
  const flights = legs.length;
  const estimated =
    !journey.dated ||
    journey.legs.some((l) => l.departure?.provenance !== 'entered' || l.arrival?.provenance !== 'entered');
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
  const issue = journey.issues.find((i) => i.severity === 'error');
  const issueLeg = issue?.leg ?? (issue?.field === 'arrival' ? Math.max(0, (issue.stop ?? 1) - 1) : (issue?.stop ?? 0));

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
            {journey.dated ? 'Journey time' : layovers.length ? 'Total time' : 'Flight time'}
            <button
              type="button"
              className="info-btn"
              aria-expanded={showInfo}
              aria-controls={infoId}
              aria-label="How times are estimated"
              onClick={() => setShowInfo((v) => !v)}
            >
              <IconInfo size={14} />
            </button>
          </span>
          <span className="stat__value">
            {flights && totalMin ? `${estimated ? '≈ ' : ''}${formatDuration(totalMin)}` : '—'}
          </span>
        </div>
        {action}
      </div>
      <p className="summary__note">
        {journey.dated && journey.start && journey.end ? (
          <>
            Departs{' '}
            {formatClock(journey.start.epochMs, journey.start.zone, { weekday: true, date: true }).replace(',', '')}{' '}
            {airportCode(journey.stops[0].airport)} · arrives {formatClock(journey.end.epochMs, journey.end.zone)}{' '}
            {airportCode(journey.stops.at(-1)!.airport)}
            <br />
          </>
        ) : null}
        {note}
      </p>
      {issue ? (
        <button type="button" className="text-btn schedule-error" onClick={() => onCheckLeg(issueLeg)}>
          Check flight {issueLeg + 1} times
        </button>
      ) : null}
      <div id={infoId} className="summary__info" hidden={!showInfo}>
        <p>
          Entered times use each airport’s local time zone; missing times are estimated. Flight times are estimates, not
          schedules: great-circle distance at an average {speed}, plus {m.overheadMinutes} min for take-off, climb,
          approach and landing. Real flights vary with winds, routing, air traffic control and taxi times.
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
