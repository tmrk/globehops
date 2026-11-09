import { describe, expect, it } from 'vitest';
import type { Airport, LocalTimeInput } from '../types.ts';
import type { JourneyStopInput } from './schedule.ts';
import {
  computeTrip,
  DEFAULT_STAY_MIN,
  normalizeStay,
  sectionOfFlight,
  sectionRole,
  stayChoices,
  stayPlaybackSkips,
  tripStateAt,
  STAY_ARRIVAL_MS,
  STAY_LEAD_MS,
  type TripSectionInput,
} from './trip.ts';

const fixtures: Record<string, [number, number, number, string, string, string]> = {
  CPH: [1, 55.618, 12.656, 'Europe/Copenhagen', 'Copenhagen', 'DK'],
  AMS: [2, 52.3086, 4.7639, 'Europe/Amsterdam', 'Amsterdam', 'NL'],
  NBO: [3, -1.3192, 36.9278, 'Africa/Nairobi', 'Nairobi', 'KE'],
  CDG: [4, 49.0097, 2.5478, 'Europe/Paris', 'Paris', 'FR'],
  JFK: [5, 40.6398, -73.7789, 'America/New_York', 'New York', 'US'],
  LHR: [6, 51.4706, -0.4619, 'Europe/London', 'London', 'GB'],
  LGW: [7, 51.1481, -0.1903, 'Europe/London', 'London', 'GB'],
  FCO: [8, 41.8003, 12.2389, 'Europe/Rome', 'Rome', 'IT'],
  MXP: [9, 45.6306, 8.7281, 'Europe/Rome', 'Milan', 'IT'],
};
const airport = (code: string): Airport => {
  const [id, lat, lng, , city, countryCode] = fixtures[code];
  return {
    id,
    ident: code,
    iata: code,
    icao: null,
    name: city,
    city,
    lat,
    lng,
    country: '',
    countryCode,
    region: '',
    type: 'large',
    scheduled: true,
    keywords: [],
  };
};
const at = (local: string): LocalTimeInput => ({ local, offsetMin: null });
const stop = (code: string, values: Partial<JourneyStopInput> = {}): JourneyStopInput => ({
  airport: airport(code),
  zone: fixtures[code][3],
  layoverMin: null,
  arrival: null,
  departure: null,
  ...values,
});
const section = (stops: JourneyStopInput[], stayMin: number | null = null, label: string | null = null) =>
  ({ label, stayMin, input: { id: 'x', stops } }) satisfies TripSectionInput;
const NOW = Date.UTC(2026, 10, 9);

describe('trips', () => {
  // The primary case: Copenhagen to Nairobi via Amsterdam, five days there, home via Paris.
  const nairobi = () =>
    computeTrip(
      [
        section([
          stop('CPH', { departure: at('2026-11-15T07:00') }),
          stop('AMS', { arrival: at('2026-11-15T08:20'), departure: at('2026-11-15T10:20') }),
          stop('NBO', { arrival: at('2026-11-15T20:55') }),
        ]),
        section([
          stop('NBO', { departure: at('2026-11-20T23:55') }),
          stop('CDG', { arrival: at('2026-11-21T06:50'), departure: at('2026-11-21T09:30') }),
          stop('CPH', { arrival: at('2026-11-21T11:25') }),
        ]),
      ],
      { assumedStart: null, now: NOW },
    );

  it('keeps a five-day stay in Nairobi as an explicit stay, never a layover', () => {
    const trip = nairobi();
    expect(trip.sections).toHaveLength(2);
    expect(trip.sections.map((s) => s.anchor)).toEqual(['entered', 'entered']);
    // Each journey's connections are its own; the stay is not among them.
    expect(trip.sections.map((s) => s.journey.transfers.map((t) => t.airport.iata))).toEqual([['AMS'], ['CDG']]);
    expect(trip.stays).toHaveLength(1);
    const [stay] = trip.stays;
    expect(stay).toMatchObject({ section: 1, after: 0, source: 'times', custom: false, days: 5 });
    expect(stay.arrivalAirport.iata).toBe('NBO');
    expect(stay.departureAirport.iata).toBe('NBO');
    // 20:55 EAT on the 15th to 23:55 EAT on the 20th.
    expect(stay.minutes).toBe(5 * 1440 + 180);
    expect(trip.totals).toMatchObject({ flights: 4, connections: 2, journeys: 2, stays: 1 });
    expect(trip.totals.connectionMin).toBe(120 + 160);
    expect(trip.totals.stayMin).toBe(stay.minutes);
    expect(trip.totals.tripMin).toBe((trip.end!.epochMs - trip.start!.epochMs) / 60000);
    expect(trip.totals.flightMin + trip.totals.connectionMin + trip.totals.stayMin).toBe(trip.totals.tripMin);
    expect(trip.sections[1].legOffset).toBe(2);
    expect(trip.issues).toEqual([]);
    expect(trip.playable).toBe(true);
    // UTC instants: CET is UTC+1, EAT is UTC+3.
    expect(new Date(trip.start!.epochMs).toISOString()).toBe('2026-11-15T06:00:00.000Z');
    expect(new Date(trip.end!.epochMs).toISOString()).toBe('2026-11-21T10:25:00.000Z');
  });

  it('places the single traveller in a journey or a stay at every instant', () => {
    const trip = nairobi();
    const tl = trip.timeline!;
    expect(tl.stays).toEqual([
      { section: 1, after: 0, start: trip.stays[0].arrival!.epochMs, end: tl.sections[1].timeline.start },
    ]);
    const before = tripStateAt(trip, tl, tl.start - 60_000);
    expect(before).toMatchObject({ phase: 'journey', section: 0, state: { phase: 'before' } });
    const connecting = tripStateAt(trip, tl, Date.UTC(2026, 10, 15, 8));
    expect(connecting).toMatchObject({ phase: 'journey', section: 0, state: { phase: 'transfer', stop: 1 } });
    const staying = tripStateAt(trip, tl, Date.UTC(2026, 10, 18, 12));
    expect(staying).toMatchObject({ phase: 'stay', section: 1, after: 0 });
    if (staying.phase === 'stay') expect(staying.departure).toBe(tl.sections[1].timeline.start);
    const home = tripStateAt(trip, tl, Date.UTC(2026, 10, 21, 3));
    expect(home).toMatchObject({ phase: 'journey', section: 1, legOffset: 2, state: { phase: 'flight', leg: 0 } });
    expect(tripStateAt(trip, tl, tl.end + 1)).toMatchObject({
      phase: 'journey',
      section: 1,
      state: { phase: 'after' },
    });
    // Boundaries belong to the later segment: landing in Nairobi starts the stay.
    expect(tripStateAt(trip, tl, tl.sections[0].timeline.end)).toMatchObject({ phase: 'stay' });
    expect(tripStateAt(trip, tl, tl.sections[1].timeline.start)).toMatchObject({
      phase: 'journey',
      section: 1,
      state: { phase: 'flight' },
    });
  });

  it('skips stays during playback without touching the real instants', () => {
    const trip = nairobi();
    const tl = trip.timeline!;
    const [skip] = stayPlaybackSkips(tl);
    expect(skip.from).toBe(tl.stays[0].start + STAY_ARRIVAL_MS);
    expect(skip.to).toBe(tl.stays[0].end - STAY_LEAD_MS);
    // Short stays play through.
    expect(stayPlaybackSkips({ ...tl, stays: [{ ...tl.stays[0], end: tl.stays[0].start + 90 * 60_000 }] })).toEqual([]);
  });

  it('places an untimed return from the outbound through the stay setting', () => {
    const inputs = (stayMin: number | null) => [
      section([stop('CPH', { departure: at('2026-11-15T07:00') }), stop('NBO')]),
      section([stop('NBO'), stop('CPH')], stayMin),
    ];
    const assumed = computeTrip(inputs(null), { assumedStart: null, now: NOW });
    expect(assumed.sections.map((s) => s.anchor)).toEqual(['entered', 'assumed']);
    const outboundEnd = assumed.sections[0].journey.end!.epochMs;
    expect(assumed.sections[1].journey.start!.epochMs).toBe(outboundEnd + DEFAULT_STAY_MIN * 60000);
    expect(assumed.sections[1].journey.start!.provenance).toBe('assumed');
    expect(assumed.sections[1].journey.dated).toBe(false);
    expect(assumed.stays[0]).toMatchObject({ source: 'setting', custom: false, minutes: DEFAULT_STAY_MIN });
    expect(assumed.dated).toBe(true);
    expect(assumed.playable).toBe(true);
    const chosen = computeTrip(inputs(3 * 1440), { assumedStart: null, now: NOW });
    expect(chosen.sections[1].anchor).toBe('estimated');
    expect(chosen.sections[1].journey.start!.provenance).toBe('estimated');
    expect(chosen.stays[0]).toMatchObject({ source: 'setting', custom: true, minutes: 3 * 1440 });
  });

  it('places an untimed outbound backwards from a timed return', () => {
    const trip = computeTrip(
      [
        section([stop('CPH'), stop('NBO')]),
        section([stop('NBO', { departure: at('2026-11-20T23:55') }), stop('CPH')], 2 * 1440),
      ],
      { assumedStart: null, now: NOW },
    );
    expect(trip.sections.map((s) => s.anchor)).toEqual(['estimated', 'entered']);
    expect(trip.sections[0].journey.end!.epochMs).toBe(trip.sections[1].journey.start!.epochMs - 2 * 1440 * 60000);
    expect(trip.stays[0].source).toBe('setting');
  });

  it('anchors a wholly untimed trip only from an example start, and keeps every journey assumed', () => {
    const inputs = [section([stop('CPH'), stop('NBO')]), section([stop('NBO'), stop('CPH')])];
    const undated = computeTrip(inputs, { assumedStart: null, now: NOW });
    expect(undated.sections.map((s) => s.anchor)).toEqual(['none', 'none']);
    expect(undated.timeline).toBeNull();
    expect(undated.totals.tripMin).toBe(undated.totals.flightMin + undated.totals.connectionMin + DEFAULT_STAY_MIN);
    const example = computeTrip(inputs, { assumedStart: Date.UTC(2026, 10, 9, 12), now: NOW });
    expect(example.sections.map((s) => s.anchor)).toEqual(['assumed', 'assumed']);
    expect(example.dated).toBe(false);
    expect(example.timeline).not.toBeNull();
  });

  it('reports a journey that departs before the previous one arrives, and blocks playback', () => {
    const trip = computeTrip(
      [
        section([stop('CPH', { departure: at('2026-11-15T07:00') }), stop('NBO')]),
        section([stop('NBO', { departure: at('2026-11-15T10:00') }), stop('CPH')]),
      ],
      { assumedStart: null, now: NOW },
    );
    expect(trip.issues).toEqual([expect.objectContaining({ code: 'stay_overlap', section: 1, severity: 'error' })]);
    expect(trip.playable).toBe(false);
    expect(trip.timeline).toBeNull();
  });

  it('never infers a stay from duration: a long connection stays a connection, a short stay stays a stay', () => {
    const longConnection = computeTrip(
      [
        section([
          stop('CPH', { departure: at('2026-11-15T07:00') }),
          stop('AMS', { arrival: at('2026-11-15T08:20'), departure: at('2026-11-19T10:20') }),
          stop('NBO'),
        ]),
      ],
      { assumedStart: null, now: NOW },
    );
    expect(longConnection.stays).toEqual([]);
    expect(longConnection.sections[0].journey.transfers[0].minutes).toBe(4 * 1440 + 120);
    const dayTrip = computeTrip(
      [
        section([stop('CPH', { departure: at('2026-11-15T07:00') }), stop('LHR', { arrival: at('2026-11-15T08:00') })]),
        section([stop('LHR', { departure: at('2026-11-15T17:00') }), stop('CPH')]),
      ],
      { assumedStart: null, now: NOW },
    );
    expect(dayTrip.stays[0]).toMatchObject({ minutes: 9 * 60, days: 0, source: 'times' });
    expect(stayPlaybackSkips(dayTrip.timeline!)).toHaveLength(1);
  });

  it('counts calendar days in the arrival zone across a daylight-saving change', () => {
    // Europe/London leaves summer time on 25 October 2026.
    const trip = computeTrip(
      [
        section([stop('JFK', { departure: at('2026-10-20T19:00') }), stop('LHR', { arrival: at('2026-10-21T07:00') })]),
        section([stop('LHR', { departure: at('2026-10-27T11:00') }), stop('JFK')]),
      ],
      { assumedStart: null, now: NOW },
    );
    const [stay] = trip.stays;
    expect(stay.days).toBe(6);
    // 07:00 BST (06:00Z) to 11:00 GMT (11:00Z): six days and five hours of real time.
    expect(stay.minutes).toBe(6 * 1440 + 5 * 60);
  });

  it('describes open jaws and multi-stage trips', () => {
    const trip = computeTrip(
      [
        section([stop('LHR', { departure: at('2026-06-01T09:00') }), stop('FCO')]),
        section([stop('MXP', { departure: at('2026-06-08T18:00') }), stop('CDG')]),
        section([stop('CDG'), stop('LGW')], 1440),
      ],
      { assumedStart: null, now: NOW },
    );
    expect(trip.stays.map((s) => [s.arrivalAirport.iata, s.departureAirport.iata])).toEqual([
      ['FCO', 'MXP'],
      ['CDG', 'CDG'],
    ]);
    expect(trip.sections.map((s) => s.anchor)).toEqual(['entered', 'entered', 'estimated']);
    expect(sectionOfFlight(trip, 2)).toEqual({ section: 2, leg: 0 });
    expect(sectionOfFlight(trip, 3)).toBeNull();
    const first = trip.sections[0].journey.stops[0].airport;
    const ends = trip.sections.map((s) => s.journey.stops.at(-1)!.airport);
    expect(ends.map((last, i) => sectionRole(i, 3, first, last))).toEqual(['outbound', 'onward', 'return']);
  });

  it('skips journeys without flights when linking stays', () => {
    const trip = computeTrip(
      [
        section([stop('CPH', { departure: at('2026-11-15T07:00') }), stop('NBO')]),
        section([stop('NBO')]),
        section([stop('NBO'), stop('CPH')]),
      ],
      { assumedStart: null, now: NOW },
    );
    expect(trip.stays).toHaveLength(1);
    expect(trip.stays[0]).toMatchObject({ section: 2, after: 0 });
    expect(trip.totals.journeys).toBe(2);
    expect(trip.sections[2].legOffset).toBe(1);
  });

  it('normalises stay settings and offers custom values in the menu', () => {
    expect(normalizeStay(DEFAULT_STAY_MIN)).toBeNull();
    expect(normalizeStay(-1)).toBeNull();
    expect(normalizeStay(1.5)).toBeNull();
    expect(normalizeStay(3 * 1440)).toBe(3 * 1440);
    expect(stayChoices(5000)).toContain(5000);
    expect(stayChoices(1440).filter((m) => m === 1440)).toHaveLength(1);
  });
});
