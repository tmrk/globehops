import type { useI18n } from '../i18n/I18nProvider.tsx';
import { sectionRole, type Trip, type TripStay } from '../lib/trip.ts';
import type { Airport } from '../types.ts';

type I18n = Pick<ReturnType<typeof useI18n>, 't' | 'fmt'>;

/** A journey's name in a trip: the traveller's own, else Outbound, Return (when it comes home) or Journey n. */
export function sectionName(
  index: number,
  sections: readonly { label: string | null; airports: readonly Airport[] }[],
  { t, fmt }: I18n,
): string {
  const custom = sections[index]?.label;
  if (custom) return custom;
  const role = sectionRole(index, sections.length, sections[0]?.airports[0], sections[index]?.airports.at(-1));
  return role === 'outbound'
    ? t('trip.outbound')
    : role === 'return'
      ? t('trip.return')
      : t('trip.onward', fmt.number(index + 1));
}

/** Every journey's name, from the trip's computed journeys. */
export function sectionNames(trip: Trip, i18n: I18n): string[] {
  const sections = trip.sections.map((s) => ({
    label: s.label,
    airports: s.journey.stops.map((stop) => stop.airport),
  }));
  return sections.map((_, index) => sectionName(index, sections, i18n));
}

/** A length of stay: calendar days once timed (“5 days”), else rounded days, or hours for a same-day stay. */
export function stayLength(minutes: number, days: number | null, { t, fmt }: I18n): string {
  const count = days !== null && days > 0 ? days : minutes >= 1440 ? Math.round(minutes / 1440) : null;
  if (count === null) return fmt.duration(minutes);
  return t(count === 1 ? 'trip.day' : 'trip.days', fmt.number(count));
}

/** “5 days in Nairobi”, or for an open jaw “6 days · Rome to Milan”. */
export function stayText(stay: TripStay, i18n: I18n): string {
  const length = stayLength(stay.minutes, stay.days, i18n);
  const { t, fmt } = i18n;
  return stay.arrivalAirport.id === stay.departureAirport.id ||
    fmt.city(stay.arrivalAirport) === fmt.city(stay.departureAirport)
    ? t('trip.stayIn', length, fmt.city(stay.arrivalAirport))
    : t('trip.stayOpenJaw', length, fmt.city(stay.arrivalAirport), fmt.city(stay.departureAirport));
}

/** Local dates of a stay at the arrival airport, “15–20 Nov”, once both ends are known. */
export function stayDates(stay: TripStay, { fmt }: I18n): string | null {
  if (!stay.arrival || !stay.departure) return null;
  return fmt.dateRange(stay.arrival.local.slice(0, 10), stay.departure.local.slice(0, 10));
}
