import type { useI18n } from '../i18n/I18nProvider.tsx';
import { airportCode } from '../data/airports.ts';
import type { ComparedTrip } from '../lib/compareTrips.ts';
import { tripRouteCodes } from '../lib/tripView.ts';
import { sectionNames } from './tripText.ts';

type I18n = Pick<ReturnType<typeof useI18n>, 't' | 'fmt'>;

const airportsOf = ({ trip }: ComparedTrip) => trip.sections.map((s) => s.journey.stops.map((stop) => stop.airport));

/** A compared trip's route in codes: `BUD → JFK → BUD`. */
export function tripCodes(entry: ComparedTrip): string {
  return tripRouteCodes(airportsOf(entry));
}

/**
 * What tells compared trips apart, when they have no name of their own. Trips between the same places
 * differ in their connections (“via FRA”, “Nonstop”); otherwise, their routes do.
 */
export function tripCaptions(list: readonly ComparedTrip[], { t }: I18n): string[] {
  const routes = list.map(tripCodes);
  const filled = routes.filter(Boolean);
  const samePlaces = filled.every((route) => route === filled[0]);
  return list.map((entry, index) => {
    if (entry.label) return entry.label;
    if (!routes[index]) return t('compare.chooseAirports');
    if (!samePlaces) return routes[index];
    const via = [
      ...new Set(
        entry.trip.sections.flatMap(({ journey }) => journey.stops.slice(1, -1).map((s) => airportCode(s.airport))),
      ),
    ];
    if (!via.length) return t('trips.nonstop');
    return t('trips.via', via.length > 2 ? `${via.slice(0, 2).join(', ')}…` : via.join(', '));
  });
}

/** Column names for compared trips: Outbound, Return, …, from the first trip with a route. */
export function tripColumnNames(list: readonly ComparedTrip[], i18n: I18n): string[] {
  const reference = list.find((entry) => entry.trip.sections.some((s) => s.journey.stops.length)) ?? list[0];
  return reference
    ? sectionNames({ ...reference.trip, sections: reference.trip.sections.map((s) => ({ ...s, label: null })) }, i18n)
    : [];
}
