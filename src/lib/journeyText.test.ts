import { describe, it, expect } from 'vitest';
import type { Airport } from '../types.ts';
import { computeJourney } from './schedule.ts';
import {
  describeState,
  formatLegTimes,
  clockZoneOptions,
  formatDateLabel,
  formatUtcOffset,
  formatZoneLabel,
} from './journeyText.ts';
import { buildTimeline, journeyStateAt } from './timeline.ts';
const airport = (iata: string, city: string, lat: number, lng: number): Airport => ({
  id: lat,
  ident: iata,
  iata,
  icao: null,
  name: city,
  city,
  lat,
  lng,
  country: '',
  countryCode: '',
  region: '',
  type: 'large',
  scheduled: true,
  keywords: [],
});
const j = computeJourney({
  id: 'A',
  stops: [
    {
      airport: airport('CPH', 'Copenhagen', 55.618, 12.656),
      zone: 'Europe/Copenhagen',
      arrival: null,
      departure: { local: '2026-11-20T08:15', offsetMin: null },
      layoverMin: null,
    },
    {
      airport: airport('LHR', 'London Heathrow', 51.4706, -0.4619),
      zone: 'Europe/London',
      arrival: { local: '2026-11-20T09:05', offsetMin: null },
      departure: null,
      layoverMin: null,
    },
    {
      airport: airport('JFK', 'New York JFK', 40.6398, -73.7789),
      zone: 'America/New_York',
      arrival: null,
      departure: null,
      layoverMin: null,
    },
  ],
});
describe('journey text', () => {
  it('formats entered airport-local times and estimated times', () => {
    expect(formatLegTimes(j.legs[0])).toEqual({ dep: '08:15', arr: '09:05', dayShift: 0, estimated: false });
    expect(formatLegTimes(j.legs[1]).estimated).toBe(true);
    expect(formatLegTimes({ ...j.legs[0], arrival: null, departure: null })).toEqual({
      dep: '–',
      arr: '–',
      dayShift: 0,
      estimated: true,
    });
  });
  it('describes flight, transfer, before and after states', () => {
    const tl = buildTimeline(j)!;
    const before = describeState(j, journeyStateAt(j, tl, tl.start - 1));
    expect(before.title).toBe('Ready to depart Copenhagen');
    expect(before.detail).toContain('08:15');
    expect(before.detail).toContain('CET');
    const flight = describeState(j, journeyStateAt(j, tl, tl.start + 55 * 60000), 'mi');
    expect(flight.title).toBe('Flight 1 of 2 · En route to London Heathrow');
    expect(flight.detail).toBe('50% of flight · ≈ 55m to arrival');
    expect(describeState(j, journeyStateAt(j, tl, tl.segments[1].start))).toEqual({
      title: 'Connecting at London Heathrow',
      detail: 'Next flight in 1h 30m',
    });
    expect(describeState(j, journeyStateAt(j, tl, tl.end))).toEqual({
      title: 'Arrived at New York JFK',
      detail: 'Journey complete',
    });
  });
  it('offers local/UTC and unique airport zones with city labels', () => {
    expect(clockZoneOptions(j, 'Europe/Copenhagen')).toEqual([
      { value: 'local', label: 'Your time (CET)' },
      { value: 'utc', label: 'UTC' },
      { value: 'LHR', label: 'London Heathrow time' },
      { value: 'JFK', label: 'New York JFK time' },
    ]);
    expect(
      clockZoneOptions({ ...j, stops: [...j.stops, j.stops[1], { ...j.stops[0], zone: null }] }, 'UTC').filter(
        (o) => o.value === 'LHR',
      ),
    ).toHaveLength(1);
    expect(clockZoneOptions(j, 'UTC').find((o) => o.value === 'CPH')?.label).toBe('Copenhagen time');
  });
});

describe('date and zone labels', () => {
  it('formats calendar dates without time-zone shifts', () => {
    expect(formatDateLabel('2026-11-20')).toBe('Fri 20 Nov 2026');
    expect(formatDateLabel('2024-02-29')).toBe('Thu 29 Feb 2024');
    expect(formatDateLabel('0099-01-01')).toBe('Thu 1 Jan 99');
    expect(formatDateLabel('2026-02-30')).toBe('');
    expect(formatDateLabel('2026-11-20T08:15')).toBe('');
  });
  it('always signs offsets, including zero and half hours', () => {
    expect(formatUtcOffset(0)).toBe('UTC+0');
    expect(formatUtcOffset(60)).toBe('UTC+1');
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
    expect(formatUtcOffset(-210)).toBe('UTC−3:30');
  });
  it('names each airport zone with its abbreviation where one is customary', () => {
    const winter = Date.parse('2026-01-15T12:00Z');
    const summer = Date.parse('2026-07-15T12:00Z');
    // ICU versions differ: browsers currently name London's winter zone "GMT+0", Node "GMT".
    expect(formatZoneLabel('Europe/London', winter)).toMatch(/^(?:GMT · )?UTC\+0$/);
    expect(formatZoneLabel('Europe/London', summer)).toMatch(/^(?:BST · )?UTC\+1$/);
    expect(formatZoneLabel('Europe/Copenhagen', summer)).toMatch(/^(?:CEST · )?UTC\+2$/);
    expect(formatZoneLabel('America/New_York', winter)).toBe('EST · UTC−5');
    expect(formatZoneLabel('Asia/Kolkata', winter)).toBe('UTC+5:30');
    expect(formatZoneLabel('UTC', winter)).toBe('UTC+0');
  });
});
