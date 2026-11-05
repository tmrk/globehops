/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { decodeDataset } from '../data/airports.ts';
import { decodeTimeZones } from '../data/timezones.ts';
import { computeJourney } from '../lib/schedule.ts';
import { greatCircleDistanceKm } from '../lib/geo.ts';
import { daylightAt, subsolarPoint } from '../lib/sun.ts';
import {
  createAgentContext,
  planItinerary,
  resolveItinerary,
  searchAirports,
  timelineAt,
  validateItinerary,
} from './plan.ts';
import { validateItineraryDocument } from './itinerary.ts';
import { ITINERARY_SCHEMA } from './schema.ts';
import { parseLink } from '../state/link.ts';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../data/generated/${name}.json`, import.meta.url), 'utf8'));
const ctx = createAgentContext({
  airports: decodeDataset(read('airports')),
  timezones: decodeTimeZones(read('timezones')),
  now: () => Date.UTC(2026, 0, 1),
});
const scheduled = {
  version: 1,
  stops: [
    { airport: 'CPH', departure: '2026-11-20T08:15' },
    { airport: 'LHR', arrival: '2026-11-20T09:05', departure: '2026-11-20T11:00' },
    { airport: 'JFK', arrival: '2026-11-20T13:50' },
  ],
};
const minimal = { version: 1, stops: [{ airport: 'CPH' }] };
import { DOCUMENT_CORPUS } from '../../mcp/document-corpus.ts';
const schemaValid = new Ajv2020({ strict: true }).compile(ITINERARY_SCHEMA);
describe('document schema agrees with the structural validator', () => {
  it.each(DOCUMENT_CORPUS.map((raw, index) => ({ raw, index })))('corpus case $index', ({ raw }) => {
    expect(schemaValid(raw), JSON.stringify(raw)).toBe(validateItineraryDocument(raw).ok);
  });
});
describe('shared agent planning', () => {
  it('uses existing airport ranking and returns zones', () => {
    expect(searchAirports(ctx, 'London')[0].code).toBe('LHR');
    expect(searchAirports(ctx, 'cph', 1)[0]).toMatchObject({
      code: 'CPH',
      timeZone: 'Europe/Copenhagen',
      countryCode: 'DK',
    });
    expect(searchAirports(ctx, 'malmo').some((a) => a.code === 'MMX')).toBe(true);
  });
  it('resolves IATA, ICAO, idents and numeric ids identically', () => {
    const cph = searchAirports(ctx, 'CPH', 1)[0];
    const airport = resolveItinerary(ctx, 'CPH-JFK').input.stops[0].airport;
    for (const code of ['cph', 'EKCH', airport.ident, String(airport.id)])
      expect(resolveItinerary(ctx, { version: 1, stops: [{ airport: code }] }).input.stops[0].airport.id).toBe(
        airport.id,
      );
    expect(cph.icao).toBe('EKCH');
  });
  it('reports and skips unknown airports without losing usable legs', () => {
    const plan = planItinerary(ctx, { route: 'CPH-ZZZ-JFK' });
    expect(plan.valid).toBe(false);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: 'unknown_airport', path: '/stops/1/airport' }));
    expect(plan.legs).toHaveLength(1);
  });
  it('shares exact journey totals and exposes all entered time provenance', () => {
    const journey = computeJourney(resolveItinerary(ctx, scheduled).input, { now: ctx.now() });
    const plan = planItinerary(ctx, scheduled);
    expect(plan.totals).toMatchObject({
      flightMinutes: journey.totals.flightMin,
      journeyMinutes: journey.totals.journeyMin,
      layoverMinutes: 115,
      provenance: 'entered',
    });
    expect(plan.legs[0].departure).toMatchObject({
      local: '2026-11-20T08:15',
      utc: '2026-11-20T07:15Z',
      offset: '+01:00',
      provenance: 'entered',
    });
    expect(plan.transfers[0]).toMatchObject({ source: 'times', provenance: 'entered', minutes: 115 });
  });
  it('exposes estimated durations without inventing dates for undated routes', () => {
    const plan = planItinerary(ctx, 'CPH-LHR_180-JFK');
    expect(plan.legs.every((l) => l.departure === null && l.arrival === null && l.durationSource === 'estimated')).toBe(
      true,
    );
    expect(plan.transfers[0]).toMatchObject({ minutes: 180, source: 'setting', provenance: 'estimated' });
    expect(plan.totals.provenance).toBe('estimated');
    expect(plan.totals.journeyMinutes).toBe(plan.totals.flightMinutes + 180);
    expect(parseLink(new URL(plan.url!).search).stops?.[1].layoverMin).toBe(180);
  });
  it('propagates partial schedules and labels estimated endpoints', () => {
    const plan = planItinerary(ctx, {
      version: 1,
      stops: [{ airport: 'CPH', departure: '2026-11-20T08:15' }, { airport: 'JFK' }],
    });
    expect(plan.legs[0].arrival?.provenance).toBe('estimated');
    expect(plan.legs[0].departure?.provenance).toBe('entered');
  });
  it('returns structural and semantic issues in one API', () => {
    expect(validateItinerary(ctx, { version: 1, stops: [] })[0].severity).toBe('error');
    expect(
      validateItinerary(ctx, {
        version: 1,
        stops: [{ airport: 'JFK', departure: '2026-03-08T02:30' }, { airport: 'LHR' }],
      }).some((i) => i.code === 'nonexistent_local_time'),
    ).toBe(true);
  });
  it('disambiguates DST using an explicit offset', () => {
    const doc = (departure: string) => ({ version: 1, stops: [{ airport: 'JFK', departure }, { airport: 'LHR' }] });
    expect(planItinerary(ctx, doc('2026-11-01T01:30')).issues.some((i) => i.code === 'ambiguous_local_time')).toBe(
      true,
    );
    expect(planItinerary(ctx, doc('2026-11-01T01:30-05:00')).legs[0].departure?.utc).toBe('2026-11-01T06:30Z');
    expect(planItinerary(ctx, doc('2026-11-01T01:30Z')).issues.some((i) => i.code === 'offset_mismatch')).toBe(true);
  });
  it('retains semantic errors for syntactically allowed invalid offsets', () => {
    expect(
      planItinerary(ctx, {
        version: 1,
        stops: [{ airport: 'CPH', departure: '2026-11-20T08:15+99:99' }, { airport: 'JFK' }],
      }).valid,
    ).toBe(false);
  });
  it('labels a connection between independently entered and estimated endpoints as mixed', () => {
    const plan = planItinerary(ctx, {
      version: 1,
      stops: [
        { airport: 'CPH', departure: '2026-11-20T08:15' },
        { airport: 'LHR', departure: '2026-11-20T11:00' },
        { airport: 'JFK' },
      ],
    });
    expect(plan.transfers[0]).toMatchObject({ source: 'times', provenance: 'mixed' });
    expect(plan.totals.provenance).toBe('mixed');
  });
  it('returns explicit share-limit issues without dropping the calculated journey', () => {
    const plan = planItinerary(ctx, {
      version: 1,
      $schema: 'x'.repeat(6100),
      stops: [{ airport: 'CPH' }, { airport: 'JFK' }],
    });
    expect(plan.issues.some((i) => i.code === 'link_too_large')).toBe(true);
    expect(plan.legs).toHaveLength(1);
  });
  it('retains original stop paths after skipping an unknown airport', () => {
    const plan = planItinerary(ctx, {
      version: 1,
      stops: [{ airport: 'CPH' }, { airport: 'ZZZ' }, { airport: 'JFK', arrival: '2026-03-08T02:30' }],
    });
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'nonexistent_local_time', path: '/stops/2/arrival' }),
    );
  });
  it('reports missing zones and supports a custom base', () => {
    const context = createAgentContext({
      airports: ctx.airports,
      timezones: null,
      baseUrl: 'https://example.com/other/?old=1#old',
    });
    const plan = planItinerary(context, scheduled);
    expect(plan.issues.some((i) => i.code === 'timezone_unknown')).toBe(true);
    expect(plan.url).toMatch(/^https:\/\/example.com\/other\/\?route=/);
  });
  it('handles malformed input and empty routes without throwing', () => {
    for (const raw of [null, {}, { route: '' }, 'CPH-LHR_99999-JFK']) expect(planItinerary(ctx, raw).valid).toBe(false);
  });
});
describe('agent timeline', () => {
  it('requires an explicit assumption for an undated journey', () => {
    expect(timelineAt(ctx, 'CPH-JFK', { samples: 3 }).issues.some((i) => i.code === 'assume_departure_required')).toBe(
      true,
    );
    const result = timelineAt(ctx, 'CPH-JFK', { samples: 3, assumeDeparture: '2026-11-20T08:00Z' });
    expect(result.valid).toBe(true);
    expect(result.timeline).toHaveLength(3);
    expect(result.timeline[1].anchorProvenance).toBe('assumed');
    expect(result.timeline[1].phase).toBe('flight');
    expect(result.timeline[2].phase).toBe('after');
  });
  it('uses the shared great-circle position, status and sunlight calculations', () => {
    const result = timelineAt(ctx, scheduled, ['2026-11-20T10:00Z', '2026-11-20T14:00Z']);
    expect(result.timeline[0]).toMatchObject({
      phase: 'transfer',
      stopCode: 'LHR',
      status: { title: expect.stringContaining('Connecting') },
    });
    const flight = result.timeline[1];
    expect(flight.phase).toBe('flight');
    expect(flight.daylight).toBe(daylightAt(Date.parse(flight.time), flight.position));
    expect(flight.subsolarPoint).toEqual(subsolarPoint(Date.parse(flight.time)));
    const [from, to] = resolveItinerary(ctx, 'LHR-JFK').input.stops.map((s) => s.airport);
    expect(greatCircleDistanceKm(from, flight.position) / greatCircleDistanceKm(from, to)).toBeCloseTo(
      flight.distanceFraction!,
      8,
    );
    expect(flight.altitudeKmIllustrative).toBeGreaterThan(0);
  });
  it('validates instant and sampling bounds and unavailable single-airport timelines', () => {
    for (const count of [0, 1, 1.5, 1001]) expect(timelineAt(ctx, scheduled, { samples: count }).valid).toBe(false);
    expect(timelineAt(ctx, scheduled, ['yesterday']).valid).toBe(false);
    expect(timelineAt(ctx, minimal, { samples: 2 }, { assumeDeparture: 'invalid' }).valid).toBe(false);
    expect(timelineAt(ctx, minimal, { samples: 2 }, { assumeDeparture: '2026-11-20T08:00Z' }).valid).toBe(false);
  });
});

describe('clock validation', () => {
  it('rejects a clock airport that is not part of the route', () => {
    const issues = validateItinerary(ctx, {
      version: 1,
      stops: [{ airport: 'CPH' }, { airport: 'JFK' }],
      view: { clock: 'SYD' },
    });
    expect(issues.map((i) => i.code)).toContain('invalid_clock');
    expect(
      validateItinerary(ctx, {
        version: 1,
        stops: [{ airport: 'CPH' }, { airport: 'JFK' }],
        view: { clock: 'jfk' },
      }).map((i) => i.code),
    ).not.toContain('invalid_clock');
  });
});
