import { describe, expect, it } from 'vitest';
import { formatters } from './format.ts';
import { LOCALES } from './locales.ts';
import { formatDuration } from '../lib/flightTime.ts';
import { formatLayover } from '../lib/layover.ts';
import { formatDistance } from '../lib/units.ts';
import { formatClock } from '../lib/timezone.ts';
import { formatDateLabel } from '../lib/journeyText.ts';
import type { Airport } from '../types.ts';
const airport: Airport = {
  id: 1,
  ident: 'TEST',
  iata: null,
  icao: null,
  name: 'Test Airport',
  city: 'Stockholm',
  region: '',
  countryCode: 'SE',
  country: 'Sweden',
  lat: 0,
  lng: 0,
  type: 'large',
  scheduled: true,
  keywords: [],
};
describe('localized formatting', () => {
  it('caches each locale and preserves established English output', () => {
    const fmt = formatters('en');
    expect(fmt).toBe(formatters('en'));
    for (const minutes of [0, 45, 100, 420, 1505, 4320]) {
      expect(fmt.duration(minutes)).toBe(formatDuration(minutes));
      expect(fmt.layover(minutes)).toBe(formatLayover(minutes));
    }
    expect(fmt.distance(12345, 'mi')).toBe(formatDistance(12345, 'mi'));
    expect(fmt.date('2026-11-20')).toBe(formatDateLabel('2026-11-20'));
    expect(fmt.date('2026-11-20', { year: false })).toBe('Fri 20 Nov');
    expect(fmt.clock(0, 'UTC', { weekday: true, date: true })).toBe(
      formatClock(0, 'UTC', { weekday: true, date: true }),
    );
  });
  it('uses local decimal separators, compact durations and translated countries', () => {
    expect(
      formatters('hu')
        .number(12345.5)
        .replace(/[\s\u00a0\u202f]/g, ''),
    ).toBe('12345,5');
    expect(
      formatters('sv')
        .number(12345.5)
        .replace(/[\s\u00a0\u202f]/g, ''),
    ).toBe('12345,5');
    expect(formatters('hu').duration(100)).toBe('1 ó 40 p');
    expect(formatters('sv').duration(100)).toBe('1 h 40 min');
    expect(formatters('hu').duration(1440)).toBe('1 n');
    expect(formatters('sv').layover(0)).toBe('0 min');
    expect(formatters('hu').country(airport)).toBe('Svédország');
    expect(formatters('sv').country(airport)).toBe('Sverige');
    expect(formatters('hu').country({ ...airport, countryCode: 'QZ' })).toBe('Sweden');
    expect(formatters('hu').country({ ...airport, countryCode: '' })).toBe('Sweden');
    expect(formatters('sv').place(airport)).toBe('Stockholm, Sverige');
  });
  for (const locale of LOCALES)
    it(`formats dates, clocks, lists and offsets in ${locale}`, () => {
      const fmt = formatters(locale);
      expect(fmt.date('2026-11-20')).toMatch(/2026/);
      expect(fmt.date('2026-11-20')).toMatch(/20/);
      expect(fmt.date('2026-11-20').toLowerCase()).toMatch(/nov/);
      expect(fmt.date('invalid')).toBe('');
      expect(fmt.date('2026-11-20', { year: false })).not.toMatch(/2026/);
      expect(fmt.date('2026-11-20', { year: false })).toMatch(/20/);
      expect(fmt.clock(Date.parse('2026-11-20T08:15Z'), 'UTC')).toMatch(/08[:.]15/);
      expect(fmt.clock(Date.parse('2026-11-20T00:00Z'), 'UTC')).toMatch(/00[:.]00/);
      expect(fmt.zone('Europe/Stockholm', Date.parse('2026-11-20T08:15Z'))).toMatch(/UTC\+1/);
      expect(fmt.list(['A', 'B', 'C'])).toMatch(/A.*B.*C/);
      expect(fmt.city(airport)).toBe('Stockholm');
    });
});
