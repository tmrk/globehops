/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeDataset } from '../data/airports.ts';
import { decodeTimeZones } from '../data/timezones.ts';
import { decodeAirspace } from '../data/airspace.ts';
import { decodeDiversionAirports } from '../data/diversion.ts';
import { createRouter } from '../lib/router.ts';
import { createAgentContext, planItinerary, planTrip, tripTimelineAt, validateItinerary } from './plan.ts';
import { parseLink } from '../state/link.ts';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../data/generated/${name}.json`, import.meta.url), 'utf8'));
const data = {
  airports: decodeDataset(read('airports')),
  timezones: decodeTimeZones(read('timezones')),
  now: () => Date.UTC(2026, 10, 9),
};
const ctx = createAgentContext(data);
const routed = createAgentContext({
  ...data,
  router: createRouter({
    airspace: decodeAirspace(read('airspace')),
    diversion: decodeDiversionAirports(read('diversion-airports')),
  }),
});

// The primary case: Copenhagen to Nairobi via Amsterdam on 15 November, home via Paris on 20–21 November.
const nairobi = {
  version: 1,
  sections: [
    {
      stops: [
        { airport: 'CPH', departure: '2026-11-15T07:00' },
        { airport: 'AMS', arrival: '2026-11-15T08:20', departure: '2026-11-15T10:20' },
        { airport: 'NBO', arrival: '2026-11-15T20:55' },
      ],
    },
    {
      stops: [
        { airport: 'NBO', departure: '2026-11-20T23:55' },
        { airport: 'CDG', arrival: '2026-11-21T06:50', departure: '2026-11-21T09:30' },
        { airport: 'CPH', arrival: '2026-11-21T11:25' },
      ],
    },
  ],
} as const;

describe('agent trips', () => {
  it('plans a round trip with an explicit stay, never a layover', () => {
    const plan = planTrip(ctx, nairobi);
    expect(plan.valid).toBe(true);
    expect(plan.kind).toBe('trip');
    expect(plan.sections.map((s) => s.name)).toEqual(['Outbound', 'Return']);
    expect(plan.sections.map((s) => s.transfers.map((t) => t.airport))).toEqual([['AMS'], ['CDG']]);
    expect(plan.stays).toEqual([
      expect.objectContaining({
        afterSection: 0,
        beforeSection: 1,
        arrivalAirport: 'NBO',
        departureAirport: 'NBO',
        openJaw: false,
        minutes: 5 * 1440 + 180,
        days: 5,
        source: 'times',
        provenance: 'entered',
      }),
    ]);
    expect(plan.totals).toMatchObject({ flights: 4, connections: 2, sections: 2, stays: 1, provenance: 'entered' });
    expect(plan.totals.connectionMinutes).toBe(280);
    expect(plan.url).toContain('route=CPH-AMS-NBO');
    expect(plan.url).toContain('2.route=NBO-CDG-CPH');
    expect(plan.itineraryParamUrl).toContain('itinerary=');
    expect(parseLink(new URL(plan.url!).search).sections?.[0].stops.map((s) => s.code)).toEqual(['NBO', 'CDG', 'CPH']);
    expect(plan.humanSummary).toMatch(/Outbound: CPH → AMS → NBO .* · stay .* at NBO · Return: NBO → CDG → CPH/);
    expect(plan.routing).toBeNull();
    expect(validateItinerary(ctx, nairobi)).toEqual(plan.issues);
  });

  it('builds a trip progressively: an untimed return is placed by its stay and marked as assumed', () => {
    const plan = planTrip(ctx, {
      version: 1,
      sections: [
        { stops: [{ airport: 'CPH', departure: '2026-11-15T07:00' }, { airport: 'NBO' }] },
        { label: 'Home', stops: [{ airport: 'NBO' }, { airport: 'CPH' }] },
      ],
    });
    expect(plan.valid).toBe(true);
    expect(plan.sections.map((s) => [s.name, s.anchor])).toEqual([
      ['Outbound', 'entered'],
      ['Home', 'assumed'],
    ]);
    expect(plan.stays[0]).toMatchObject({ source: 'setting', provenance: 'assumed', minutes: 7 * 1440 });
    // A single-journey document stays a journey; a trip must not be planned as one.
    expect(planItinerary(ctx, { version: 1, sections: nairobi.sections }).issues).toContainEqual(
      expect.objectContaining({ code: 'use_trip_sections' }),
    );
  });

  it('reports overlapping journeys and unknown airports with section paths', () => {
    const plan = planTrip(ctx, {
      version: 1,
      sections: [
        { stops: [{ airport: 'CPH', departure: '2026-11-15T07:00' }, { airport: 'NBO' }] },
        { stops: [{ airport: 'NBO', departure: '2026-11-15T09:00' }, { airport: 'ZZZZZZ' }, { airport: 'CPH' }] },
      ],
    });
    expect(plan.valid).toBe(false);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: 'stay_overlap', path: '/sections/1' }));
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown_airport', path: '/sections/1/stops/1/airport' }),
    );
  });

  it('samples the single traveller through journeys and the stay', () => {
    const result = tripTimelineAt(ctx, nairobi, ['2026-11-15T09:00+01:00', '2026-11-18T12:00Z', '2026-11-21T02:00Z']);
    expect(result.valid).toBe(true);
    expect(result.timeline.map((sample) => [sample.phase, sample.section])).toEqual([
      ['transfer', 0],
      ['stay', 1],
      ['flight', 1],
    ]);
    expect(result.timeline[1]).toMatchObject({ stopCode: 'NBO', status: { title: 'Staying in Nairobi NBO' } });
    expect(result.timeline[2]).toMatchObject({ globalLeg: 2 });
  });

  it('keeps great circles by default and routes on request, distinguishing the distances', () => {
    const doc = { version: 1, stops: [{ airport: 'JNB', departure: '2026-11-15T10:00' }, { airport: 'PER' }] };
    const plain = planItinerary(routed, doc);
    expect(plain.routing).toBeNull();
    expect(plain.legs[0]).toMatchObject({ distanceModel: 'great_circle' });
    expect(plain.legs[0].distanceKm).toBe(plain.legs[0].greatCircleKm);
    expect('route' in plain.legs[0]).toBe(false);
    const diverted = planItinerary(routed, doc, { routing: { avoidAirspace: true, diversion: true } });
    expect(diverted.routing).toMatchObject({
      avoidAirspace: true,
      diversion: { profile: 'twin-180', maxDiversionMinutes: 180, oeiSpeedKt: 400 },
    });
    const leg = diverted.legs[0];
    expect(leg.route?.diversion).toMatchObject({ limitMinutes: 180 });
    expect(['covered', 'adjusted', 'gap']).toContain(leg.route?.diversion?.status);
    if (leg.route?.diversion?.status === 'adjusted') {
      expect(leg.distanceModel).toBe('routed');
      expect(leg.distanceKm).toBeGreaterThan(leg.greatCircleKm);
      expect(leg.route.diversion.maxDiversionMinutes).toBeLessThanOrEqual(180);
    }
    // A longer limit is a parameter, not an aircraft form; out-of-range values are rejected.
    const longer = planItinerary(routed, doc, { routing: { diversion: 330 } });
    expect(longer.legs[0].route?.diversion).toMatchObject({ limitMinutes: 330, status: 'covered' });
    expect(planItinerary(routed, doc, { routing: { diversion: 999 } }).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_routing' }),
    );
    // Without routing data the request is reported and great circles are kept.
    const unavailable = planItinerary(ctx, doc, { routing: { diversion: true } });
    expect(unavailable.issues).toContainEqual(
      expect.objectContaining({ code: 'routing_unavailable', severity: 'warning' }),
    );
    expect(unavailable.legs[0].distanceModel).toBe('great_circle');
  });

  it('reports a South Pacific crossing beyond the 180-minute model without inventing a route', () => {
    const plan = planItinerary(
      routed,
      { version: 1, stops: [{ airport: 'SYD', departure: '2026-11-15T10:00' }, { airport: 'SCL' }] },
      { routing: { diversion: true } },
    );
    const leg = plan.legs[0];
    expect(leg.route?.diversion).toMatchObject({ status: 'gap', limitMinutes: 180 });
    expect(leg.route!.diversion!.maxDiversionMinutes).toBeGreaterThan(180);
    expect(leg.route!.diversion!.outsideKm).toBeGreaterThan(0);
    expect(leg.distanceKm).toBe(leg.greatCircleKm);
  });
});
