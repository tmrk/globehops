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
  planComparison as planAnyComparison,
  resolveItinerary,
  searchAirports,
  timelineAt,
  validateItinerary,
} from './plan.ts';
import { validateItineraryDocument } from './itinerary.ts';
import { ITINERARY_SCHEMA } from './schema.ts';
import { parseLink } from '../state/link.ts';

// These regression cases exercise the existing single-journey comparison variant.
function planComparison(...args: Parameters<typeof planAnyComparison>) {
  const result = planAnyComparison(...args);
  if (result.kind !== 'comparison') throw new Error('Expected a journey comparison.');
  return result;
}
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
    expect(plan.issues.some((i) => i.code === 'document_link_too_large' && i.severity === 'warning')).toBe(true);
    expect(plan.valid).toBe(true);
    expect(plan.url).toContain('?route=CPH-JFK');
    expect(plan.itineraryParamUrl).toBeNull();
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

it('canonicalises airport clock aliases and validates flight selection', () => {
  const plan = planItinerary(ctx, {
    version: 1,
    stops: [{ airport: 'EKCH' }, { airport: 'EGLL' }],
    view: { clock: 'EGLL', lang: 'hu', names: true, borders: false, leg: 1 },
  });
  expect(plan.valid).toBe(true);
  expect(plan.url).toContain('/hu/?route=CPH-LHR&clock=LHR');
  expect(plan.itineraryParamUrl).toContain('/hu/?itinerary=');
  expect(
    planItinerary(ctx, { version: 1, stops: [{ airport: 'CPH' }, { airport: 'LHR' }], view: { leg: 2 } }).issues,
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_leg' })]));
});

describe('agent comparisons', () => {
  const journeys = [
    {
      label: 'Via London',
      stops: [
        { airport: 'BUD', departure: '2026-12-01T07:10' },
        { airport: 'LHR', arrival: '2026-12-01T08:55', departure: '2026-12-01T11:20' },
        { airport: 'JFK', arrival: '2026-12-01T14:35' },
      ],
    },
    {
      label: 'Direct',
      stops: [
        { airport: 'BUD', departure: '2026-12-01T08:00' },
        { airport: 'JFK', arrival: '2026-12-01T12:00' },
      ],
    },
  ];
  it('computes per-journey details with the single planner shapes and shares both document forms', () => {
    const plan = planComparison(ctx, { version: 1, journeys, view: { clock: 'EGLL', lang: 'sv', follow: false } });
    expect(plan.valid).toBe(true);
    expect(plan.comparison).toMatchObject({
      fastest: 'B',
      firstArrival: 'B',
      ranking: [{ id: 'B', deltaMinutes: 0 }, { id: 'A' }],
    });
    expect(plan.journeys[0].totals).toEqual(planItinerary(ctx, { version: 1, stops: journeys[0].stops }).totals);
    expect(plan.journeys[0].legs).toEqual(planItinerary(ctx, { version: 1, stops: journeys[0].stops }).legs);
    expect(plan.journeys[0].transfers).toEqual(planItinerary(ctx, { version: 1, stops: journeys[0].stops }).transfers);
    expect(plan.humanSummary).toContain('B BUD → JFK 10h 00m (fastest, arrives first)');
    expect(plan.url).toContain('/sv/?route=BUD-LHR-JFK');
    expect(plan.url).toContain('b.route=BUD-JFK');
    expect(plan.url).toContain('clock=LHR');
    expect(plan.url).toContain('follow=0');
    const readable = parseLink(new URL(plan.url!).search, new URL(plan.url!).pathname);
    const document = parseLink(new URL(plan.itineraryParamUrl!).search, new URL(plan.itineraryParamUrl!).pathname);
    // Readable links canonicalise ICAO clock aliases.
    expect({ ...document, view: { ...document.view, clock: 'LHR' } }).toEqual(readable);
  });
  it('resolves route shorthand, aligns undated alternatives and canonicalises cross-journey clocks', () => {
    const plan = planComparison(ctx, {
      journeys: [journeys[1], { label: 'Via London', route: 'BUD-LHR_180-JFK' }],
      view: { clock: 'EGLL' },
    });
    expect(plan.valid).toBe(true);
    expect(plan.journeys.map((journey) => journey.anchor)).toEqual(['entered', 'assumed']);
    expect(plan.journeys[1].departure?.utc).toBe(plan.journeys[0].departure?.utc);
    expect(plan.url).toContain('b.route=BUD-LHR_180-JFK');
    expect(plan.url).toContain('clock=LHR');
    const assumed = planComparison(
      ctx,
      { journeys: [{ route: 'BUD-JFK' }, { route: 'BUD-LHR-JFK' }] },
      { assumeDeparture: '2026-12-01T07:00Z' },
    );
    expect(
      assumed.journeys.every(
        (journey) => journey.departure?.utc === '2026-12-01T07:00Z' && journey.anchor === 'assumed',
      ),
    ).toBe(true);
    const undated = planComparison(ctx, { journeys: [{ route: 'BUD-JFK' }, { route: 'BUD-LHR-JFK' }] });
    expect(undated.journeys.every((journey) => journey.departure === null && journey.anchor === 'none')).toBe(true);
    expect(undated.comparison.firstArrival).toBeNull();
  });
  it('keeps issue paths after skipped airports and excludes invalid journeys from rankings', () => {
    const plan = planComparison(ctx, {
      journeys: [
        journeys[0],
        { stops: [{ airport: 'BUD' }, { airport: 'ZZZ' }, { airport: 'JFK', arrival: '2026-03-08T02:30' }] },
      ],
    });
    expect(plan.valid).toBe(false);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown_airport', path: '/journeys/1/stops/1/airport' }),
    );
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'nonexistent_local_time', path: '/journeys/1/stops/2/arrival' }),
    );
    expect(plan.comparison.ranking.map((entry) => entry.id)).toEqual(['A']);
    expect(plan.comparison.fastest).toBeNull();
    expect(plan.comparison.firstArrival).toBeNull();
    expect(plan.journeys).toHaveLength(2);
  });
  it('validates malformed inputs, view references and assumptions without throwing', () => {
    for (const raw of [
      null,
      {},
      { journeys: [] },
      { journeys: [{ route: 'BUD-!' }] },
      { journeys: [{ route: 'BUD-JFK', stops: journeys[0].stops }] },
      { journeys: [{ stops: [{ airport: '!' }] }] },
    ])
      expect(planComparison(ctx, raw).valid).toBe(false);
    expect(planComparison(ctx, { version: 1, journeys }, { assumeDeparture: 'bad' }).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_assumption' }),
    );
    const invalidView = planComparison(ctx, {
      version: 1,
      journeys: [journeys[1], journeys[0]],
      view: { clock: 'SYD', leg: 2 },
    });
    expect(invalidView.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid_clock', 'invalid_leg']),
    );
  });
  it('handles ties and warns if the document URL exceeds limits while retaining the readable link', () => {
    const plan = planComparison(ctx, { version: 1, $schema: 'x'.repeat(6100), journeys: [journeys[0], journeys[0]] });
    expect(plan.valid).toBe(true);
    expect(plan.comparison.fastest).toBeNull();
    expect(plan.comparison.firstArrival).toBeNull();
    expect(plan.comparison.ranking.map((entry) => entry.deltaMinutes)).toEqual([0, 0]);
    expect(plan.url).toContain('&b.route=');
    expect(plan.itineraryParamUrl).toBeNull();
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'document_link_too_large', severity: 'warning' }),
    );
  });
  it('lets the single planner handle one journey and redirects multi-journey calculations', () => {
    expect(planItinerary(ctx, { version: 1, journeys: [journeys[0]] }).valid).toBe(true);
    const plan = planItinerary(ctx, { version: 1, journeys });
    expect(plan.totals).toEqual(planItinerary(ctx, { version: 1, stops: journeys[0].stops }).totals);
    expect(plan.issues).toContainEqual({
      code: 'use_compare_journeys',
      severity: 'error',
      message: 'This document compares journeys; use compare_journeys.',
    });
    expect(timelineAt(ctx, { version: 1, journeys }, { samples: 2 }).issues).toContainEqual(
      expect.objectContaining({ code: 'use_compare_journeys' }),
    );
    expect(
      validateItinerary(ctx, { version: 1, journeys }).some((issue) => issue.code === 'use_compare_journeys'),
    ).toBe(false);
  });
});

describe('agent compared trips', () => {
  const journeys = [
    {
      label: 'Via Frankfurt',
      sections: [
        {
          stops: [
            { airport: 'BUD', departure: '2026-12-01T07:10' },
            { airport: 'FRA', arrival: '2026-12-01T08:40', departure: '2026-12-01T10:10' },
            { airport: 'JFK', arrival: '2026-12-01T13:05' },
          ],
        },
        {
          stops: [
            { airport: 'JFK', departure: '2026-12-10T18:00' },
            { airport: 'FRA', arrival: '2026-12-11T07:00', departure: '2026-12-11T08:00' },
            { airport: 'BUD', arrival: '2026-12-11T09:20' },
          ],
        },
      ],
    },
    {
      label: 'Nonstop',
      sections: [
        {
          stops: [
            { airport: 'BUD', departure: '2026-12-01T08:00' },
            { airport: 'JFK', arrival: '2026-12-01T12:00' },
          ],
        },
        {
          stops: [
            { airport: 'JFK', departure: '2026-12-12T18:00' },
            { airport: 'BUD', arrival: '2026-12-13T08:15' },
          ],
        },
      ],
    },
  ];
  it('ranks travel across sections, excludes stays and emits both link forms', () => {
    const doc = { version: 1, journeys, view: { leg: 4, clock: 'EDDF' } };
    const plan = planAnyComparison(ctx, doc);
    expect(plan.kind).toBe('trip_comparison');
    if (plan.kind !== 'trip_comparison') throw new Error('Expected trips.');
    expect(plan.valid).toBe(true);
    expect(plan.journeys.map((journey) => journey.sections.map((section) => section.index))).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(plan.journeys[0].totals.travelMinutes).toBe(715 + 560);
    expect(plan.journeys[1].totals.tripMinutes).toBeGreaterThan(plan.journeys[0].totals.tripMinutes);
    expect(plan.comparison).toMatchObject({
      fastest: 'B',
      ranking: [
        { id: 'B', travelMinutes: 1095, deltaMinutes: 0 },
        { id: 'A', travelMinutes: 1275, deltaMinutes: 180 },
      ],
      sections: [
        { name: 'Outbound', fastest: 'B' },
        { name: 'Return', fastest: 'B' },
      ],
    });
    expect(plan.humanSummary).toContain('A Via Frankfurt: outbound BUD → FRA → JFK');
    expect(plan.humanSummary).toContain('21h 15m travelling');
    expect(plan.humanSummary).toContain('fastest');
    expect(plan.url).toContain('&b.2.route=JFK-BUD');
    expect(plan.url).toContain('clock=FRA');
    expect(parseLink(new URL(plan.url!).search).issues).toEqual([]);
    const encoded = parseLink(new URL(plan.itineraryParamUrl!).search);
    expect(encoded.compare?.[0].sections?.[0].stops.map((stop) => stop.code)).toEqual(['JFK', 'BUD']);
    expect(validateItinerary(ctx, doc).some((issue) => issue.severity === 'error')).toBe(false);
    expect(planItinerary(ctx, doc).issues).toContainEqual(expect.objectContaining({ code: 'use_compare_journeys' }));
    expect(timelineAt(ctx, doc, { samples: 2 }).issues).toContainEqual(
      expect.objectContaining({ code: 'use_compare_journeys' }),
    );
  });
  it('aligns untimed sections individually, preserves chosen stays and supports assumptions and routing', () => {
    const input = { journeys: [journeys[0], { sections: [{ route: 'BUD-JFK' }, { route: 'JFK-BUD' }] }] };
    const plan = planAnyComparison(ctx, input);
    if (plan.kind !== 'trip_comparison') throw new Error('Expected trips.');
    expect(plan.journeys[1].anchor).toBe('assumed');
    for (let k = 0; k < 2; k++)
      expect(plan.journeys[1].sections[k].departure?.utc).toBe(plan.journeys[0].sections[k].departure?.utc);
    const custom = planAnyComparison(ctx, {
      journeys: [journeys[0], { route: 'BUD-JFK', returnRoute: 'JFK-BUD', stay: '2d' }],
    });
    if (custom.kind !== 'trip_comparison') throw new Error('Expected trips.');
    expect(custom.journeys[1].stays[0]).toMatchObject({ minutes: 2880, source: 'setting' });
    expect(custom.journeys[1].sections[1].departure?.utc).not.toBe(plan.journeys[1].sections[1].departure?.utc);
    const assumed = planAnyComparison(
      ctx,
      {
        journeys: [
          { route: 'BUD-JFK', returnRoute: 'JFK-BUD' },
          { route: 'BUD-FRA-JFK', returnRoute: 'JFK-FRA-BUD' },
        ],
      },
      { assumeDeparture: '2026-12-01T07:00Z', routing: { avoidAirspace: true } },
    );
    expect(assumed.kind).toBe('trip_comparison');
    expect(assumed.routing?.avoidAirspace).toBe(true);
    expect(assumed.issues).toContainEqual(
      expect.objectContaining({ code: 'routing_unavailable', severity: 'warning' }),
    );
    if (assumed.kind === 'trip_comparison')
      expect(assumed.journeys[0].sections[0].departure?.utc).toBe('2026-12-01T07:00Z');
  });
  it('keeps nested issue pointers after skipped stops and excludes incomplete or invalid trips', () => {
    const invalid = {
      label: 'Broken',
      sections: [
        journeys[0].sections[0],
        { stops: [{ airport: 'JFK', departure: '2026-03-08T02:30' }, { airport: 'ZZZ' }, { airport: 'BUD' }] },
      ],
    };
    const plan = planAnyComparison(ctx, { version: 1, journeys: [journeys[0], invalid] });
    if (plan.kind !== 'trip_comparison') throw new Error('Expected trips.');
    expect(plan.valid).toBe(false);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown_airport', path: '/journeys/1/sections/1/stops/1/airport' }),
    );
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'nonexistent_local_time', path: '/journeys/1/sections/1/stops/0/departure' }),
    );
    expect(plan.comparison.fastest).toBeNull();
    expect(plan.comparison.ranking.map((entry) => entry.id)).toEqual(['A']);
    const missingFlight = planAnyComparison(ctx, {
      version: 1,
      journeys: [journeys[0], { sections: [journeys[0].sections[0], { stops: [{ airport: 'JFK' }] }] }],
    });
    expect(missingFlight.comparison.ranking.map((entry) => entry.id)).toEqual(['A']);
  });
  it('retains per-section diagnostics when no alternative can be ranked', () => {
    const invalid = {
      sections: [
        { stops: [{ airport: 'BUD' }, { airport: 'ZZZ' }, { airport: 'JFK' }] },
        { stops: [{ airport: 'JFK' }, { airport: 'BUD' }] },
      ],
    };
    const plan = planAnyComparison(ctx, { version: 1, journeys: [invalid, invalid] });
    if (plan.kind !== 'trip_comparison') throw new Error('Expected trips.');
    expect(plan.comparison.ranking).toEqual([]);
    expect(plan.comparison.sections).toEqual([
      { name: 'Outbound', fastest: null, deltaMinutes: { A: 0, B: 0, C: 0, D: 0 } },
      { name: 'Return', fastest: null, deltaMinutes: { A: 0, B: 0, C: 0, D: 0 } },
    ]);
  });
});

const recordedDocument = {
  version: 1 as const,
  stops: [
    {
      airport: 'CPH',
      track: {
        kind: 'recorded' as const,
        format: 'gpx' as const,
        name: 'my recording',
        points: [
          [0, 0, 0, '2026-03-01T10:00:00Z'],
          [0, 1, 1000, '2026-03-01T10:10:00Z'],
          [0, 4, 0, '2026-03-01T11:00:00Z'],
        ] as import('./itinerary.ts').TrackPointDoc[],
      },
    },
    { airport: 'LHR' },
  ],
};
describe('agent custom path results', () => {
  it('reports path metadata and follows a recording without any routing request', () => {
    const plan = planItinerary(ctx, recordedDocument);
    expect(plan.valid).toBe(true);
    expect(plan.legs[0].path).toMatchObject({
      kind: 'recorded',
      points: 3,
      recordedDurationMin: 60,
      source: { format: 'gpx', name: 'my recording' },
    });
    expect(plan.legs[0].distanceKm).toBe(plan.legs[0].path.distanceKm);
    expect(plan.legs[0].greatCircleKm).toBe(plan.legs[0].path.greatCircleKm);
    expect(plan.legs[0].durationSource).toBe('entered');
    expect(parseLink(new URL(plan.url!).search).stops?.[0].track?.kind).toBe('recorded');
    expect(validateItinerary(ctx, recordedDocument).some((i) => i.severity === 'error')).toBe(false);
    const timeline = timelineAt(ctx, recordedDocument, ['2026-03-01T10:10Z']);
    expect(timeline.valid).toBe(true);
    expect(timeline.timeline[0]).toMatchObject({ altitudeKmIllustrative: 1, position: { model: 'recorded' } });
    expect(timeline.timeline[0].distanceFraction).toBeCloseTo(0.25);
    expect(timeline.timeline[0].position.lng).toBeCloseTo(1);
  });
  it('compares a recording with generated paths and propagates custom sections into trip timelines', async () => {
    const { planTrip, tripTimelineAt } = await import('./plan.ts');
    const comparison = planComparison(ctx, {
      version: 1,
      journeys: [{ stops: recordedDocument.stops }, { stops: [{ airport: 'CPH' }, { airport: 'LHR' }] }],
    });
    expect(comparison.journeys[0].legs[0].path.kind).toBe('recorded');
    expect(comparison.journeys[1].legs[0].path.kind).toBe('generated');
    expect(comparison.journeys[1].departure?.utc).toBe('2026-03-01T10:00Z');
    const doc = {
      version: 1,
      sections: [{ stops: recordedDocument.stops }, { stops: [{ airport: 'LHR' }, { airport: 'CPH' }] }],
    };
    const trip = planTrip(ctx, doc);
    expect(trip.valid).toBe(true);
    expect(trip.sections[0].legs[0].path.kind).toBe('recorded');
    const sample = tripTimelineAt(ctx, doc, ['2026-03-01T10:10Z']).timeline[0];
    expect(sample.position.lng).toBeCloseTo(1);
    expect(sample.position.model).toBe('recorded');
  });
  it('keeps exact calculations when oversized document links fall back to fitted readable tracks', () => {
    const points: import('./itinerary.ts').TrackPointDoc[] = Array.from({ length: 20000 }, (_, i) => [
      50 + Math.sin(i / 20),
      -80 + i / 1000,
      11000,
    ]);
    const doc = { version: 1, stops: [{ airport: 'CPH', track: { points } }, { airport: 'JFK' }] };
    const plan = planItinerary(ctx, doc);
    expect(plan.valid).toBe(true);
    expect(plan.url!.length).toBeLessThanOrEqual(8000);
    expect(plan.itineraryParamUrl).toBeNull();
    expect(plan.legs[0].path.points).toBe(20000);
    expect(plan.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['track_simplified', 'document_link_too_large']),
    );
    expect(parseLink(new URL(plan.url!).search).stops?.[0].track?.points.length).toBeLessThan(20000);
  });
});
