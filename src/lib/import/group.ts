import type { ImportedFlight } from './types.ts';

/** Group by airport continuity only; cap each journey at nine flights and the result at six journeys. */
export function groupFlights(flights: ImportedFlight[]): { journeys: ImportedFlight[][]; dropped: number } {
  const journeys: ImportedFlight[][] = [];
  let previous: ImportedFlight | undefined;
  let current: ImportedFlight[] | null = null;
  let dropped = 0;
  for (const flight of flights) {
    if (!previous || previous.to.id !== flight.from.id) {
      current = journeys.length < 6 ? [] : null;
      if (current) journeys.push(current);
    }
    if (current && current.length < 9) current.push(flight);
    else dropped++;
    previous = flight;
  }
  return { journeys, dropped };
}
