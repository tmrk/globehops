import type { Airport, DistanceUnit } from '../types.ts';
import { displayCity } from '../data/airports.ts';
import { formatDuration } from '../lib/flightTime.ts';
import { formatLayover } from '../lib/layover.ts';
import { convertDistance, roundDistance } from '../lib/units.ts';
import { formatClock, parseLocalDate } from '../lib/timezone.ts';
import { formatDateLabel, formatZoneLabel } from '../lib/journeyText.ts';
import { localeInfo, type Locale } from './locales.ts';

const cache = new Map<Locale, ReturnType<typeof createFormatters>>();
function createFormatters(locale: Locale) {
  const tag = localeInfo[locale].tag;
  const numbers = new Intl.NumberFormat(tag, { maximumFractionDigits: 6 });
  const regions = new Intl.DisplayNames([tag], { type: 'region', fallback: 'none' });
  const city = (airport: Airport) => displayCity(airport);
  const country = (airport: Airport) => {
    try {
      return regions.of(airport.countryCode) ?? airport.country;
    } catch {
      return airport.country;
    }
  };
  const lists = new Intl.ListFormat(tag, { style: 'long', type: 'conjunction' });
  const dates = new Intl.DateTimeFormat(tag, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const yearlessDates = new Intl.DateTimeFormat(tag, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const shortDates = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayMarks = new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  const dayMonths = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const noon = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`);
  const clocks = new Map<string, Intl.DateTimeFormat>();
  function duration(minutes: number, layover = false): string {
    if (locale === 'en') return layover ? formatLayover(minutes) : formatDuration(minutes);
    const total = Math.max(0, Math.round(minutes));
    const d = Math.floor(total / 1440),
      h = Math.floor((total % 1440) / 60),
      m = total % 60;
    const units = locale === 'hu' ? ['n', 'ó', 'p'] : ['d', 'h', 'min'];
    return [
      d ? `${numbers.format(d)} ${units[0]}` : '',
      h ? `${numbers.format(h)} ${units[1]}` : '',
      m || (!d && !h) ? `${numbers.format(m)} ${units[2]}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return {
    number: (value: number) => numbers.format(value),
    distanceNumber: (km: number, unit: DistanceUnit) => numbers.format(roundDistance(convertDistance(km, unit))),
    distance: (km: number, unit: DistanceUnit) => `${numbers.format(roundDistance(convertDistance(km, unit)))} ${unit}`,
    duration: (minutes: number) => duration(minutes),
    layover: (minutes: number) => duration(minutes, true),
    // Single integration seam for the independently maintained city exonym table.
    city,
    country,
    place(airport: Airport): string {
      return [airport.city ? this.city(airport) : '', airport.region, this.country(airport)].filter(Boolean).join(', ');
    },
    list: (values: string[]) => lists.format(values),
    /** A country or territory by ISO 3166-1 alpha-2 code, in the interface language. */
    region(code: string): string {
      try {
        return regions.of(code) ?? code;
      } catch {
        return code;
      }
    },
    shortDate: (isoDate: string) => shortDates.format(new Date(`${isoDate}T12:00:00Z`)),
    /** Two local calendar dates as a compact range: “15–20 Nov”, “30 Nov – 2 Dec”; one date when equal. */
    dateRange: (fromIso: string, toIso: string) =>
      fromIso === toIso ? dayMonths.format(noon(fromIso)) : dayMonths.formatRange(noon(fromIso), noon(toIso)),
    /** A day on a time scale: “Sun 8”. */
    dayMark: (isoDate: string) => dayMarks.format(new Date(`${isoDate}T12:00:00Z`)),
    /** “Fri 20 Nov 2026”; without the year (“Fri 20 Nov”) where the year goes without saying. */
    date: (isoDate: string, options: { year?: boolean } = {}) => {
      const year = options.year ?? true;
      if (locale === 'en') return formatDateLabel(isoDate, year);
      const parsed = parseLocalDate(isoDate);
      if (!parsed) return '';
      const day = new Date(0);
      day.setUTCFullYear(parsed.year, parsed.month - 1, parsed.day);
      return (year ? dates : yearlessDates).format(day);
    },
    clock: (instant: number, zone: string, options: { weekday?: boolean; date?: boolean } = {}) => {
      if (locale === 'en') return formatClock(instant, zone, options);
      const key = `${zone}:${!!options.weekday}:${!!options.date}`;
      let formatter = clocks.get(key);
      if (!formatter) {
        formatter = new Intl.DateTimeFormat(tag, {
          timeZone: zone,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
          ...(options.weekday ? { weekday: 'short' } : {}),
          ...(options.date ? { day: 'numeric', month: 'short' } : {}),
        });
        clocks.set(key, formatter);
      }
      return formatter.format(instant);
    },
    zone: formatZoneLabel,
  };
}
export type Formatters = ReturnType<typeof createFormatters>;
export function formatters(locale: Locale): Formatters {
  let result = cache.get(locale);
  if (!result) {
    result = createFormatters(locale);
    cache.set(locale, result);
  }
  return result;
}
