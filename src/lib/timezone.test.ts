import { describe, expect, it, vi } from 'vitest';
import {
  MAX_YEAR,
  MIN_YEAR,
  browserTimeZone,
  formatClock,
  formatIsoInstant,
  formatIsoOffset,
  formatLocalDateTime,
  formatOffset,
  isSupportedTimeZone,
  localDayDifference,
  offsetMinutesAt,
  parseIsoInstant,
  parseLocalDate,
  parseLocalDateTime,
  resolveLocal,
  utcToLocal,
  zoneAbbreviation,
  type LocalDateTime,
  type ResolvedTime,
} from './timezone.ts';

function local(s: string): LocalDateTime {
  const value = parseLocalDateTime(s);
  if (!value) throw new Error(`Invalid test date: ${s}`);
  return value;
}

function edgeWall(edge: ResolvedTime): string {
  return new Date(edge.epochMs + edge.offsetMin * 60_000).toISOString().slice(0, 16);
}

describe('UTC ↔ local calendar conversions', () => {
  it.each([
    ['Europe/Copenhagen', '2026-01-15T12:34Z', '2026-01-15T13:34', 60],
    ['Europe/Copenhagen', '2026-07-15T12:34Z', '2026-07-15T14:34', 120],
    ['Europe/London', '2026-01-15T12:34Z', '2026-01-15T12:34', 0],
    ['Europe/London', '2026-07-15T12:34Z', '2026-07-15T13:34', 60],
    ['America/New_York', '2026-01-15T12:34Z', '2026-01-15T07:34', -300],
    ['America/New_York', '2026-07-15T12:34Z', '2026-07-15T08:34', -240],
    ['Australia/Sydney', '2026-01-15T12:34Z', '2026-01-15T23:34', 660],
    ['Australia/Sydney', '2026-07-15T12:34Z', '2026-07-15T22:34', 600],
    ['Asia/Kathmandu', '2026-01-15T12:34Z', '2026-01-15T18:19', 345],
    ['Pacific/Chatham', '2026-01-15T12:34Z', '2026-01-16T02:19', 825],
    ['Pacific/Chatham', '2026-07-15T12:34Z', '2026-07-16T01:19', 765],
    ['Pacific/Kiritimati', '2026-01-15T12:34Z', '2026-01-16T02:34', 840],
  ] as const)('%s converts %s and resolves the result', (zone, iso, wall, offsetMin) => {
    const epochMs = Date.parse(iso);
    expect(utcToLocal(zone, epochMs)).toEqual({ ...local(wall), offsetMin });
    expect(offsetMinutesAt(zone, epochMs + 59_999)).toBe(offsetMin);
    expect(resolveLocal(zone, local(wall))).toEqual({ kind: 'exact', time: { epochMs, offsetMin } });
  });

  it('keeps midnight on the correct day and handles the pre-epoch millisecond floor', () => {
    expect(utcToLocal('UTC', -1)).toEqual({ ...local('1969-12-31T23:59'), offsetMin: 0 });
    expect(utcToLocal('Europe/Copenhagen', Date.parse('2026-01-01T23:00Z'))).toEqual({
      ...local('2026-01-02T00:00'),
      offsetMin: 60,
    });
  });

  it('guards ICU versions that emit 24 for midnight despite h23', () => {
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockImplementation(function (
      this: Intl.DateTimeFormat,
      date,
    ) {
      return original.call(this, date).map((p) => (p.type === 'hour' && p.value === '00' ? { ...p, value: '24' } : p));
    });
    try {
      expect(utcToLocal('UTC', Date.parse('2026-01-02T00:00Z'))).toEqual({
        ...local('2026-01-02T00:00'),
        offsetMin: 0,
      });
      expect(formatClock(Date.parse('2026-01-02T00:00Z'), 'UTC')).toBe('00:00');
    } finally {
      spy.mockRestore();
    }
  });

  it('round-trips every supported year including both limits', () => {
    expect([MIN_YEAR, MAX_YEAR]).toEqual([1900, 2100]);
    for (let year = MIN_YEAR; year <= MAX_YEAR; year++) {
      for (const zone of ['UTC', 'Europe/Copenhagen', 'America/New_York', 'Asia/Kathmandu', 'Pacific/Chatham']) {
        const epochMs = Date.UTC(year, 0, 15, 12, 34);
        const converted = utcToLocal(zone, epochMs);
        const resolved = resolveLocal(zone, converted);
        expect(resolved.kind).toBe('exact');
        if (resolved.kind !== 'exact') throw new Error('Expected exact time');
        // Old local-mean-time offsets include seconds; LocalDateTime intentionally has minute precision.
        expect(resolved.time.epochMs).toBeLessThanOrEqual(epochMs);
        expect(epochMs - resolved.time.epochMs).toBeLessThan(60_000);
        expect(formatLocalDateTime(utcToLocal(zone, resolved.time.epochMs))).toBe(formatLocalDateTime(converted));
      }
    }
  });
});

describe('DST gaps and folds', () => {
  it.each([
    [
      'America/New_York',
      '2026-03-08T02:30',
      '2026-03-08T02:00',
      '2026-03-08T03:00',
      -300,
      -240,
      60,
      '2026-03-08T07:00Z',
    ],
    ['Europe/London', '2026-03-29T01:30', '2026-03-29T01:00', '2026-03-29T02:00', 0, 60, 60, '2026-03-29T01:00Z'],
    [
      'Australia/Lord_Howe',
      '2026-10-04T02:15',
      '2026-10-04T02:00',
      '2026-10-04T02:30',
      630,
      660,
      30,
      '2026-10-03T15:30Z',
    ],
    ['Pacific/Apia', '2011-12-30T12:00', '2011-12-30T00:00', '2011-12-31T00:00', -600, 840, 1440, '2011-12-30T10:00Z'],
  ] as const)(
    '%s resolves the gap containing %s',
    (zone, wall, before, after, oldOffset, newOffset, gapMin, instant) => {
      const result = resolveLocal(zone, local(wall));
      expect(result.kind).toBe('nonexistent');
      if (result.kind !== 'nonexistent') throw new Error('Expected gap');
      expect(result).toEqual({
        kind: 'nonexistent',
        before: { epochMs: Date.parse(instant), offsetMin: oldOffset },
        after: { epochMs: Date.parse(instant), offsetMin: newOffset },
        gapMin,
      });
      expect(edgeWall(result.before)).toBe(before);
      expect(edgeWall(result.after)).toBe(after);
      expect(offsetMinutesAt(zone, result.before.epochMs - 1)).toBe(oldOffset);
      expect(offsetMinutesAt(zone, result.after.epochMs)).toBe(newOffset);
      expect(resolveLocal(zone, local(before)).kind).toBe('nonexistent');
      expect(resolveLocal(zone, local(after)).kind).toBe('exact');
    },
  );

  it.each([
    ['America/New_York', '2026-11-01T01:30', -240, -300, '2026-11-01T05:30Z', '2026-11-01T06:30Z'],
    ['Europe/London', '2026-10-25T01:30', 60, 0, '2026-10-25T00:30Z', '2026-10-25T01:30Z'],
    ['Australia/Lord_Howe', '2026-04-05T01:45', 660, 630, '2026-04-04T14:45Z', '2026-04-04T15:15Z'],
    ['Australia/Sydney', '2026-04-05T02:30', 660, 600, '2026-04-04T15:30Z', '2026-04-04T16:30Z'],
  ] as const)('%s returns both sides of %s, earlier first', (zone, wall, firstOffset, secondOffset, first, second) => {
    const result = resolveLocal(zone, local(wall));
    expect(result).toEqual({
      kind: 'ambiguous',
      options: [
        { epochMs: Date.parse(first), offsetMin: firstOffset },
        { epochMs: Date.parse(second), offsetMin: secondOffset },
      ],
    });
    if (result.kind !== 'ambiguous') throw new Error('Expected fold');
    for (const option of result.options) expect(formatLocalDateTime(utcToLocal(zone, option.epochMs))).toBe(wall);
  });

  it('rejects every hour of Apia’s skipped date', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(resolveLocal('Pacific/Apia', { ...local('2011-12-30T00:00'), hour }).kind).toBe('nonexistent');
    }
    expect(resolveLocal('Pacific/Apia', local('2011-12-29T23:59')).kind).toBe('exact');
  });

  it('has exact instants immediately outside New York’s gap and fold', () => {
    for (const wall of ['2026-03-08T01:59', '2026-03-08T03:00', '2026-11-01T00:59', '2026-11-01T02:00'])
      expect(resolveLocal('America/New_York', local(wall)).kind).toBe('exact');
  });
});

describe('historical rules and calendar days', () => {
  it.each([
    ['Asia/Kolkata', '1945-01-01T12:00Z', 390],
    ['Asia/Kolkata', '1900-01-01T12:00Z', 321 + 10 / 60],
    ['America/Indiana/Indianapolis', '2005-07-01T12:00Z', -300],
    ['America/Indiana/Indianapolis', '2006-07-01T12:00Z', -240],
    ['Europe/Moscow', '2011-07-01T12:00Z', 240],
    ['Europe/Moscow', '2012-01-01T12:00Z', 240],
    ['Europe/Moscow', '2014-07-01T12:00Z', 240],
    ['Europe/Moscow', '2014-12-01T12:00Z', 180],
  ] as const)('uses historical %s rules at %s', (zone, instant, expected) => {
    expect(offsetMinutesAt(zone, Date.parse(instant))).toBe(expected);
  });

  it('resolves historical offset seconds without rounding them to minutes', () => {
    const result = resolveLocal('Asia/Kolkata', local('1900-01-01T12:00'));
    expect(result).toEqual({
      kind: 'exact',
      time: { epochMs: Date.parse('1900-01-01T06:38:50Z'), offsetMin: 321 + 10 / 60 },
    });
  });

  it('uses calendar days across the date line, leap days and a 23-hour DST day', () => {
    const instant = Date.parse('2026-01-01T12:00Z');
    const auckland = utcToLocal('Pacific/Auckland', instant);
    const honolulu = utcToLocal('Pacific/Honolulu', instant);
    expect(formatLocalDateTime(auckland)).toBe('2026-01-02T01:00');
    expect(formatLocalDateTime(honolulu)).toBe('2026-01-01T02:00');
    expect(localDayDifference(auckland, honolulu)).toBe(-1);
    expect(localDayDifference(honolulu, auckland)).toBe(1);
    expect(localDayDifference(local('2024-02-28T23:59'), local('2024-03-01T00:01'))).toBe(2);
    expect(localDayDifference(local('2026-03-08T00:00'), local('2026-03-09T00:00'))).toBe(1);
    expect(localDayDifference(local('2026-01-01T00:01'), local('2026-01-01T23:59'))).toBe(0);
  });
});

describe('strict parsing and presentation', () => {
  it.each([
    '2026-02-30T12:00',
    '1900-02-29T12:00',
    '2100-02-29T12:00',
    '2026-01-01T24:00',
    '2026-13-01T12:00',
    '2026-00-01T12:00',
    '2026-01-00T12:00',
    '2026-01-01T12:60',
    '2026-01-01T12:00:01',
    '2026-01-01 12:00',
    '2026-01-01T12:00Z',
    '2026-1-1T1:00',
    '',
    ' 2026-01-01T12:00',
  ])('rejects malformed wall time %j', (s) => expect(parseLocalDateTime(s)).toBeNull());

  it.each(['2026-02-30', '2026-13-01', '2026-01-01T00:00', '', '2026-1-01'])('rejects malformed date %j', (s) =>
    expect(parseLocalDate(s)).toBeNull(),
  );

  it('round-trips calendar fields and accepts only zero optional wall seconds', () => {
    for (const s of ['1900-01-01T00:00', '2000-02-29T23:59', '2026-11-20T09:30', '2100-12-31T23:59']) {
      expect(formatLocalDateTime(local(s))).toBe(s);
      expect(parseLocalDateTime(`${s}:00`)).toEqual(local(s));
      expect(parseLocalDate(s.slice(0, 10))).toEqual({ year: local(s).year, month: local(s).month, day: local(s).day });
    }
    expect(parseLocalDate('0099-02-28')).toEqual({ year: 99, month: 2, day: 28 });
    expect(parseLocalDate('0099-02-29')).toBeNull();
    expect(() => resolveLocal('UTC', { ...local('2026-01-01T00:00'), hour: 24 })).toThrow(RangeError);
  });

  it.each([
    [0, 'UTC', '+00:00'],
    [60, 'UTC+1', '+01:00'],
    [-240, 'UTC−4', '-04:00'],
    [345, 'UTC+5:45', '+05:45'],
    [825, 'UTC+13:45', '+13:45'],
    [-210, 'UTC−3:30', '-03:30'],
    [321 + 10 / 60, 'UTC+5:21:10', '+05:21:10'],
  ] as const)('formats offset %s', (offset, label, iso) => {
    expect(formatOffset(offset)).toBe(label);
    expect(formatIsoOffset(offset)).toBe(iso);
  });

  it('selects useful short names in both European and American locales, with a numeric fallback', () => {
    expect(zoneAbbreviation('Europe/Copenhagen', Date.parse('2026-01-01T12:00Z'))).toBe('CET');
    expect(zoneAbbreviation('Europe/London', Date.parse('2026-01-01T12:00Z'))).toBe('GMT');
    expect(zoneAbbreviation('America/New_York', Date.parse('2026-07-01T12:00Z'))).toBe('EDT');
    expect(zoneAbbreviation('America/New_York', Date.parse('2026-01-01T12:00Z'))).toBe('EST');
    expect(zoneAbbreviation('Asia/Kathmandu', Date.parse('2026-01-01T12:00Z'))).toBe('UTC+5:45');
  });

  it.each([
    ['2026-11-20T09:30Z', '2026-11-20T09:30Z'],
    ['2026-11-20T09:30:00Z', '2026-11-20T09:30Z'],
    ['2026-11-20T09:30:45Z', '2026-11-20T09:30:45Z'],
    ['2026-11-20T09:30+01:00', '2026-11-20T08:30Z'],
    ['2026-11-20T09:30:15-04:00', '2026-11-20T13:30:15Z'],
    ['2026-01-01T00:15+14:00', '2025-12-31T10:15Z'],
    ['1900-01-01T00:00-03:30', '1900-01-01T03:30Z'],
  ])('parses instant %s and formats it as UTC', (input, expected) => {
    const epoch = parseIsoInstant(input);
    expect(epoch).toBe(Date.parse(expected));
    expect(formatIsoInstant(epoch!)).toBe(expected);
    expect(parseIsoInstant(formatIsoInstant(epoch!))).toBe(epoch);
  });

  it.each([
    '2026-11-20T09:30',
    '2026-11-20',
    '2026-02-30T09:30Z',
    '2026-13-01T09:30Z',
    '2026-11-20T24:00Z',
    '2026-11-20T09:30:60Z',
    '2026-11-20T09:30+24:00',
    '2026-11-20T09:30+01:60',
    '2026-11-20T09:30+0100',
    '2026-11-20T09:30Z trailing',
    '',
  ])('rejects malformed or offset-less instant %j', (s) => expect(parseIsoInstant(s)).toBeNull());

  it('formats clocks in the requested zone and locale with h23 even in en-US', () => {
    const epoch = Date.parse('2026-11-20T09:42Z');
    expect(formatClock(epoch, 'Europe/London')).toBe('09:42');
    expect(formatClock(epoch, 'Europe/London', { weekday: true, date: true })).toBe('Fri 20 Nov, 09:42');
    expect(formatClock(epoch, 'Europe/London', { date: true })).toBe('20 Nov, 09:42');
    expect(formatClock(epoch, 'Europe/London', { weekday: true })).toBe('Fri, 09:42');
    expect(formatClock(Date.parse('2026-11-20T00:00Z'), 'UTC', { locale: 'en-US' })).toBe('00:00');
    expect(formatClock(epoch, 'Asia/Kathmandu')).toBe('15:27');
  });

  it('caches formatters by zone, locale and options and caches unsupported zones', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      const epoch = Date.parse('2026-11-20T09:42Z');
      for (let i = 0; i < 3; i++) formatClock(epoch, 'Africa/Ouagadougou', { locale: 'fr-FR', date: true });
      expect(spy).toHaveBeenCalledTimes(2);
      formatClock(epoch, 'Africa/Ouagadougou', { locale: 'de-DE' });
      expect(spy).toHaveBeenCalledTimes(3);
      expect(isSupportedTimeZone('Not/A_Real_Zone')).toBe(false);
      expect(isSupportedTimeZone('Not/A_Real_Zone')).toBe(false);
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
    expect(isSupportedTimeZone('Europe/Copenhagen')).toBe(true);
    expect(isSupportedTimeZone('')).toBe(false);
    expect(isSupportedTimeZone(browserTimeZone())).toBe(true);
  });
});
