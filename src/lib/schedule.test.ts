import { describe, it, expect } from 'vitest';
import type { Airport, LocalTimeInput } from '../types.ts';
import { computeJourney, type JourneyStopInput } from './schedule.ts';
import { formatLegTimes } from './journeyText.ts';

const fixtures: [string, number, number, string, string][] = [
  ['CPH', 55.618, 12.656, 'Europe/Copenhagen', 'Copenhagen'],
  ['LHR', 51.4706, -0.4619, 'Europe/London', 'London Heathrow'],
  ['JFK', 40.6398, -73.7789, 'America/New_York', 'New York JFK'],
  ['SYD', -33.9461, 151.177, 'Australia/Sydney', 'Sydney'],
  ['LAX', 33.9425, -118.408, 'America/Los_Angeles', 'Los Angeles'],
  ['HNL', 21.3187, -157.922, 'Pacific/Honolulu', 'Honolulu'],
  ['AKL', -37.0082, 174.785, 'Pacific/Auckland', 'Auckland'],
  ['KEF', 63.985, -22.6056, 'Atlantic/Reykjavik', 'Reykjavik'],
  ['NRT', 35.7647, 140.386, 'Asia/Tokyo', 'Tokyo'],
];
const time = (local: string, offsetMin: number | null = null): LocalTimeInput => ({ local, offsetMin });
function stop(code: string, values: Partial<JourneyStopInput> = {}): JourneyStopInput {
  const index = fixtures.findIndex((f) => f[0] === code);
  const [, lat, lng, zone, city] = fixtures[index];
  const airport: Airport = {
    id: index + 1,
    ident: code,
    iata: code,
    icao: null,
    lat,
    lng,
    city,
    name: city,
    country: '',
    countryCode: '',
    region: '',
    type: 'large',
    scheduled: true,
    keywords: [],
  };
  return { airport, zone, layoverMin: null, arrival: null, departure: null, ...values };
}
const journey = (stops: JourneyStopInput[], assumedStart?: number) =>
  computeJourney({ id: 'A', stops }, { now: Date.UTC(2027, 0, 1), assumedStart });
const codes = (j: ReturnType<typeof journey>) => j.issues.map((i) => i.code);

describe('journey schedules', () => {
  it('keeps undated routes as estimates and handles zero/one stop', () => {
    for (const stops of [[], [stop('CPH')], [stop('CPH'), stop('LHR'), stop('JFK')]]) {
      const j = journey(stops);
      expect(j.dated).toBe(false);
      expect(j.playable).toBe(false);
      expect(j.start).toBeNull();
      expect(j.end).toBeNull();
      expect(j.totals.journeyMin).toBe(j.totals.flightMin + j.totals.layoverMin);
      expect(j.legs.every((l) => l.durationMin === null)).toBe(true);
    }
    expect(journey([stop('CPH'), stop('CPH')]).legs[0].estimatedMin).toBeNull();
  });
  it('propagates only CPH departure forward with entered and estimated provenance', () => {
    const stops = [stop('CPH', { departure: time('2026-11-20T08:15') }), stop('LHR'), stop('JFK')];
    const before = structuredClone(stops);
    const j = journey(stops);
    expect(stops).toEqual(before);
    expect(j.start?.epochMs).toBe(Date.UTC(2026, 10, 20, 7, 15));
    expect(j.start?.provenance).toBe('entered');
    expect(j.end?.provenance).toBe('estimated');
    expect(j.legs.map((l) => l.durationSource)).toEqual(['estimated', 'estimated']);
    expect(j.transfers[0]).toMatchObject({ minutes: 90, source: 'setting', custom: false });
    expect(j.legs[0].arrival?.local).toBe('2026-11-20T08:55');
    expect(j.totals.journeyMin).toBe(j.totals.flightMin + 90);
    expect(j.playable).toBe(true);
  });
  it('propagates only final arrival backwards', () => {
    const j = journey([stop('CPH'), stop('LHR'), stop('JFK', { arrival: time('2026-11-20T14:00') })]);
    expect(j.end?.epochMs).toBe(Date.UTC(2026, 10, 20, 19));
    expect(j.start?.provenance).toBe('estimated');
    expect(j.end?.provenance).toBe('entered');
    expect(j.legs.every((l) => l.durationSource === 'estimated')).toBe(true);
    expect(j.transfers[0].source).toBe('setting');
    expect(j.playable).toBe(true);
  });
  it.each(['arrival', 'departure'] as const)('anchors only a middle %s in both directions', (field) => {
    const j = journey([stop('CPH'), stop('LHR', { [field]: time('2026-11-20T11:00') }), stop('JFK')]);
    expect(j.start).not.toBeNull();
    expect(j.end).not.toBeNull();
    expect(j.transfers[0].minutes).toBe(90);
    expect(j.legs.every((l) => l.durationMin === l.estimatedMin)).toBe(true);
    expect(j.transfers[0][field]?.provenance).toBe('entered');
  });
  it('never overwrites entered values and distinguishes mixed from estimated durations', () => {
    const j = journey([
      stop('CPH', { departure: time('2026-11-20T08:15') }),
      stop('LHR'),
      stop('JFK', { arrival: time('2026-11-20T16:00') }),
    ]);
    expect(j.start?.local).toBe('2026-11-20T08:15');
    expect(j.end?.local).toBe('2026-11-20T16:00');
    expect(j.legs.map((l) => l.durationSource)).toEqual(['estimated', 'mixed']);
    expect(j.legs[1].durationMin).not.toBe(j.legs[1].estimatedMin);
    const independent = journey([
      stop('CPH', { departure: time('2026-11-20T08:15') }),
      stop('LHR', { departure: time('2026-11-20T12:00'), layoverMin: 30 }),
      stop('JFK'),
    ]);
    expect(independent.transfers[0]).toMatchObject({ source: 'times', minutes: 185, custom: true });
  });
  it('uses assumed provenance throughout an example but never in a dated journey', () => {
    const j = journey([stop('CPH'), stop('LHR'), stop('JFK')], Date.UTC(2026, 10, 20, 8));
    expect(j.dated).toBe(false);
    expect(j.playable).toBe(true);
    expect(j.legs.every((l) => l.arrival?.provenance === 'assumed' && l.departure?.provenance === 'assumed')).toBe(
      true,
    );
    const dated = journey([stop('CPH'), stop('JFK', { arrival: time('2026-11-20T14:00') })], 0);
    expect(dated.start?.provenance).toBe('estimated');
  });
  it.each([
    ['invalid_time', 'tomorrow'],
    ['invalid_time', '2026-02-30T12:00'],
    ['date_out_of_range', '1899-12-31T12:00'],
    ['date_out_of_range', '2101-01-01T00:00'],
    ['time_missing', '2026-11-20'],
  ])('reports %s for %s and treats it as absent', (code, local) => {
    const j = journey([stop('CPH', { departure: time(local) }), stop('LHR')]);
    expect(codes(j)).toContain(code);
    expect(j.start).toBeNull();
    expect(j.dated).toBe(false);
  });
  it.each([
    ['timezone_unknown', null],
    ['timezone_unsupported', 'Mars/Olympus'],
  ])('reports %s', (code, zone) => {
    expect(codes(journey([stop('CPH', { zone, departure: time('2026-11-20T12:00') }), stop('LHR')]))).toContain(code);
  });
  it('ignores arrival at first and departure at last, including single-airport routes', () => {
    const j = journey([
      stop('CPH', { arrival: time('2026-11-20T12:00') }),
      stop('LHR', { departure: time('2026-11-20T14:00') }),
    ]);
    expect(codes(j)).toEqual(['ignored_time', 'ignored_time']);
    expect(j.dated).toBe(false);
    expect(
      codes(journey([stop('CPH', { arrival: time('2026-11-20T12:00'), departure: time('2026-11-20T14:00') })])),
    ).toEqual(['ignored_time', 'ignored_time']);
  });
  it('offers both DST fold offsets and defaults to the earlier instant', () => {
    const j = journey([stop('JFK', { departure: time('2026-11-01T01:30') }), stop('LAX')]);
    const issue = j.issues.find((i) => i.code === 'ambiguous_local_time');
    expect(issue?.options?.map((o) => o.offsetMin)).toEqual([-240, -300]);
    expect(issue?.options?.every((o) => o.label.includes('01:30') && o.label.includes('UTC'))).toBe(true);
    expect(j.start?.epochMs).toBe(Date.UTC(2026, 10, 1, 5, 30));
    const later = journey([stop('JFK', { departure: time('2026-11-01T01:30', -300) }), stop('LAX')]);
    expect(later.start?.epochMs).toBe(Date.UTC(2026, 10, 1, 6, 30));
    expect(codes(later)).not.toContain('ambiguous_local_time');
  });
  it('rejects nonexistent local times with a useful gap message', () => {
    const j = journey([stop('JFK', { departure: time('2026-03-08T02:30') }), stop('LAX')]);
    const issue = j.issues.find((i) => i.code === 'nonexistent_local_time');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('02:00 to 03:00');
    expect(issue?.message).toContain('New York');
    expect(j.start).toBeNull();
  });
  it('rejects explicit offsets that disagree with the airport, explaining the local equivalent', () => {
    const j = journey([stop('JFK', { departure: time('2026-11-20T08:00', 0) }), stop('LAX')]);
    expect(j.issues.find((i) => i.code === 'offset_mismatch')?.message).toContain('03:00');
    expect(j.start).toBeNull();
    expect(codes(journey([stop('JFK', { departure: time('2026-11-01T01:30', 60) }), stop('LAX')]))).toContain(
      'offset_mismatch',
    );
  });
  it('reports negative flight time and preserves entered instants', () => {
    const j = journey([
      stop('CPH', { departure: time('2026-11-20T12:00') }),
      stop('LHR', { arrival: time('2026-11-20T10:00') }),
    ]);
    expect(j.legs[0].durationMin).toBe(-60);
    expect(j.legs[0].durationSource).toBe('entered');
    expect(codes(j)).toContain('negative_flight_time');
    expect(j.playable).toBe(false);
  });
  it.each([
    [-10, 'connection_overlap'],
    [10, 'short_connection'],
    [8 * 1440, 'long_layover'],
  ])('checks %i-minute connections', (minutes, code) => {
    const arrival = Date.UTC(2026, 10, 20, 12);
    const departure = new Date(arrival + minutes * 60000).toISOString().slice(0, 16);
    const j = journey([
      stop('CPH'),
      stop('LHR', { arrival: time('2026-11-20T12:00'), departure: time(departure), layoverMin: 180 }),
      stop('JFK'),
    ]);
    expect(j.transfers[0]).toMatchObject({ minutes, source: 'times' });
    expect(codes(j)).toContain(code);
  });
  it('warns about unusual entered durations and emits future rules just once', () => {
    const j = computeJourney(
      {
        id: 'A',
        stops: [
          stop('CPH', { departure: time('2026-11-20T08:00') }),
          stop('LHR', { arrival: time('2026-11-20T18:00') }),
        ],
      },
      { now: 0 },
    );
    expect(codes(j)).toContain('unusual_flight_time');
    expect(j.issues.find((i) => i.code === 'unusual_flight_time')?.message).toContain('estimate of 1h 40m');
    expect(codes(j).filter((c) => c === 'future_rules')).toHaveLength(1);
  });
  it('supports custom flight models and a two-day layover', () => {
    const j = computeJourney(
      {
        id: 'A',
        stops: [stop('CPH', { departure: time('2026-11-20T08:00') }), stop('LHR', { layoverMin: 2880 }), stop('JFK')],
      },
      { flightModel: { cruiseSpeedKmh: 500, overheadMinutes: 40, roundingMinutes: 1 } },
    );
    expect(j.transfers[0].minutes).toBe(2880);
    expect(j.legs[0].estimatedMin).toBeGreaterThan(100);
    expect(j.totals.journeyMin).toBe(j.totals.flightMin + 2880);
    expect(j.end?.local.slice(0, 10)).toBe('2026-11-22');
  });
  it('uses local calendar dates for next-day and previous-day markers', () => {
    const next = journey([stop('CPH', { departure: time('2026-11-20T23:30') }), stop('JFK')]);
    expect(formatLegTimes(next.legs[0]).dayShift).toBe(1);
    const same = journey([
      stop('AKL', { departure: time('2026-11-20T19:00') }),
      stop('HNL', { arrival: time('2026-11-20T05:45') }),
    ]);
    expect(same.legs[0].durationMin).toBe(585);
    expect(formatLegTimes(same.legs[0]).dayShift).toBe(0);
    const previous = journey([stop('AKL', { departure: time('2026-11-20T01:00') }), stop('HNL')]);
    expect(formatLegTimes(previous.legs[0]).dayShift).toBe(-1);
  });
  it('propagates elapsed UTC time across a DST transition', () => {
    const j = journey([
      stop('JFK', { departure: time('2026-11-01T00:30') }),
      stop('JFK', { layoverMin: 180 }),
      stop('LAX'),
    ]);
    expect(j.transfers[0].arrival?.offsetMin).toBe(-240);
    expect(j.transfers[0].departure?.offsetMin).toBe(-300);
    expect(j.transfers[0].departure?.local).toBe('2026-11-01T02:30');
    expect(j.transfers[0].minutes).toBe(180);
  });
  it.each(['SYD', 'NRT', 'KEF', 'LAX', 'HNL', 'AKL'])('resolves %s and preserves input zones', (code) => {
    const j = journey([stop(code, { departure: time('2026-11-20T12:00') }), stop('CPH')]);
    expect(j.start?.zone).toBe(stop(code).zone);
    expect(j.start?.local).toBe('2026-11-20T12:00');
    expect(j.playable).toBe(true);
  });
});
