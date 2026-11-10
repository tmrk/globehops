import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { context } from './data.ts';
import { handleTool, INPUT_SCHEMAS, OUTPUT_SCHEMAS, type ToolName } from './tools.ts';
import { DOCUMENT_CORPUS } from './document-corpus.ts';
import { validateItineraryDocument } from '../src/agent/itinerary.ts';

const validArgs: Record<ToolName, unknown> = {
  compare_journeys: {
    journeys: [{ label: 'Direct', route: 'CPH-JFK' }, { route: 'CPH-LHR-JFK' }],
    assumeDeparture: '2026-11-20T08:00Z',
  },
  search_airports: { query: 'Copenhagen', limit: 1 },
  calculate_route: { route: 'CPH-LHR_180-JFK' },
  validate_itinerary: { route: 'CPH-JFK' },
  visualize_route: { route: 'CPH-JFK', view: { units: 'mi', clock: 'utc', dayNight: false, speed: 3600 } },
  get_journey_timeline: { route: 'CPH-JFK', samples: 3, assumeDeparture: '2026-11-20T08:00Z' },
};
describe('MCP direct handlers', () => {
  it.each(Object.keys(validArgs) as ToolName[])('%s returns equivalent structured and text JSON', (name) => {
    const result = handleTool(context, name, validArgs[name]);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });
  it('opens the interactive visualisation with view options', () => {
    const result = handleTool(context, 'visualize_route', validArgs.visualize_route);
    const url = new URL(result.structuredContent!.url as string);
    expect(url.pathname).toBe('/globehops/');
    expect(url.searchParams.get('route')).toBe('CPH-JFK');
    expect(url.searchParams.get('units')).toBe('mi');
    expect(url.searchParams.get('clock')).toBe('utc');
    expect(url.searchParams.get('daynight')).toBe('0');
  });
  it.each([
    ['calculate_route', {}],
    ['calculate_route', { route: 'CPH-JFK', itinerary: { version: 1, stops: [{ airport: 'CPH' }] } }],
    ['calculate_route', { route: 'CPH-ZZZ-JFK' }],
    ['search_airports', { query: 'CPH', limit: 0 }],
    ['validate_itinerary', { itinerary: { version: 2, stops: [] } }],
    ['get_journey_timeline', { route: 'CPH-JFK' }],
    ['get_journey_timeline', { route: 'CPH-JFK', at: ['invalid'], samples: 3 }],
  ] as const)('%s contains failures as clear tool errors', (name, args) => {
    const result = handleTool(context, name, args);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeDefined();
  });
  it('handles explicit timeline instants and scheduled document input', () => {
    const result = handleTool(context, 'get_journey_timeline', {
      itinerary: { version: 1, stops: [{ airport: 'CPH', departure: '2026-11-20T08:15' }, { airport: 'JFK' }] },
      at: ['2026-11-20T09:00Z'],
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent!.timeline).toHaveLength(1);
  });
  it('exports the same document schema semantics through the MCP input schema', () => {
    const published = new Ajv2020({ strict: false }).compile(
      z.toJSONSchema(INPUT_SCHEMAS.calculate_route, { io: 'input' }),
    );
    for (const doc of DOCUMENT_CORPUS) {
      expect(INPUT_SCHEMAS.calculate_route.safeParse({ itinerary: doc }).success, JSON.stringify(doc)).toBe(
        validateItineraryDocument(doc).ok,
      );
      expect(published({ itinerary: doc }), JSON.stringify(doc)).toBe(validateItineraryDocument(doc).ok);
    }
  });
});

it('view overrides can repair itinerary view semantics and oversized documents retain readable links', () => {
  const repaired = handleTool(context, 'visualize_route', {
    itinerary: { version: 1, stops: [{ airport: 'CPH' }, { airport: 'JFK' }], view: { leg: 2, clock: 'LAX' } },
    view: { leg: 1, clock: 'utc' },
  });
  expect(repaired.isError).not.toBe(true);
  expect(repaired.structuredContent!.url).toContain('clock=utc');
  const oversized = handleTool(context, 'visualize_route', {
    itinerary: { version: 1, $schema: 'x'.repeat(6100), stops: [{ airport: 'CPH' }, { airport: 'JFK' }] },
    view: { names: true },
  });
  expect(oversized.isError).not.toBe(true);
  expect(oversized.structuredContent!.url).toContain('names=1');
  expect(oversized.structuredContent!.itineraryParamUrl).toBeNull();
});

describe('MCP comparisons', () => {
  const journeys = [
    { label: 'Direct', stops: [{ airport: 'BUD', departure: '2026-12-01T08:00' }, { airport: 'JFK' }] },
    { label: 'Via London', route: 'BUD-LHR_180-JFK' },
  ];
  it('returns the documented comparison shape and a link carrying every journey', () => {
    const result = handleTool(context, 'compare_journeys', { journeys, view: { play: true } });
    expect(result.isError).not.toBe(true);
    const plan = OUTPUT_SCHEMAS.compare_journeys.parse(result.structuredContent);
    expect(plan.journeys.map((journey) => journey.id)).toEqual(['A', 'B']);
    expect(plan.journeys[0].anchor).toBe('entered');
    expect(plan.journeys[1].anchor).toBe('assumed');
    if (!('departure' in plan.journeys[0]) || !('departure' in plan.journeys[1])) throw new Error('Expected journeys.');
    expect(plan.journeys[1].departure?.utc).toBe(plan.journeys[0].departure?.utc);
    expect(plan.url).toContain('b.route=BUD-LHR_180-JFK');
    expect(plan.comparison.fastest).toBe('A');
  });
  it('supports journeys documents in visualization and validation, and directs calculation tools to compare_journeys', () => {
    const itinerary = {
      version: 1,
      journeys: [
        journeys[0],
        { label: 'Via London', stops: [{ airport: 'BUD' }, { airport: 'LHR' }, { airport: 'JFK' }] },
      ],
    };
    const visual = handleTool(context, 'visualize_route', { itinerary, view: { clock: 'LHR', lang: 'hu' } });
    expect(visual.isError).not.toBe(true);
    const output = OUTPUT_SCHEMAS.visualize_route.parse(visual.structuredContent);
    expect(output.url).toContain('/hu/?route=BUD-JFK');
    expect(output.comparison?.fastest).toBe('A');
    expect(output.summary.totals?.flights).toBe(1);
    expect(handleTool(context, 'validate_itinerary', { itinerary }).isError).not.toBe(true);
    for (const name of ['calculate_route', 'get_journey_timeline'] as const) {
      const result = handleTool(context, name, { itinerary });
      expect(result.isError).toBe(true);
      expect(result.structuredContent!.issues).toContainEqual(
        expect.objectContaining({ code: 'use_compare_journeys' }),
      );
    }
  });
  it('rejects ambiguous/oversized input and reports journey-prefixed errors', () => {
    for (const args of [
      { journeys: [journeys[0]] },
      { journeys: Array(5).fill(journeys[0]) },
      { journeys: [{ route: 'BUD-JFK', stops: journeys[0].stops }, journeys[0]] },
      { journeys: [{}, journeys[0]] },
      { journeys, view: { lang: 'de' } },
    ])
      expect(handleTool(context, 'compare_journeys', args).isError).toBe(true);
    const invalid = handleTool(context, 'compare_journeys', { journeys: [journeys[0], { route: 'BUD-ZZZ-JFK' }] });
    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent!.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown_airport', path: '/journeys/1/stops/1/airport' }),
    );
  });
  it('validates each handler result against its output schema', () => {
    for (const name of Object.keys(validArgs) as ToolName[]) {
      const result = handleTool(context, name, validArgs[name]);
      expect(OUTPUT_SCHEMAS[name].safeParse(result.structuredContent).success, name).toBe(true);
    }
  });
});

describe('MCP trips and routing', () => {
  const trip = {
    version: 1,
    sections: [
      { stops: [{ airport: 'CPH', departure: '2026-11-15T07:00' }, { airport: 'AMS' }, { airport: 'NBO' }] },
      {
        label: 'Home',
        stops: [{ airport: 'NBO', departure: '2026-11-20T23:55' }, { airport: 'CDG' }, { airport: 'CPH' }],
      },
    ],
  };
  it('calculates, validates, visualises and samples a round trip through the published schemas', () => {
    const calculated = handleTool(context, 'calculate_route', { itinerary: trip });
    expect(calculated.isError).not.toBe(true);
    const output = OUTPUT_SCHEMAS.calculate_route.parse(calculated.structuredContent);
    expect(output.kind).toBe('trip');
    expect(output.sections?.map((s) => s.name)).toEqual(['Outbound', 'Home']);
    expect(output.stays?.[0]).toMatchObject({ arrivalAirport: 'NBO', source: 'times', days: 5 });
    const visual = OUTPUT_SCHEMAS.visualize_route.parse(
      handleTool(context, 'visualize_route', { itinerary: trip }).structuredContent,
    );
    expect(visual.url).toContain('2.route=NBO-CDG-CPH');
    expect(visual.trip?.stays).toHaveLength(1);
    expect(handleTool(context, 'validate_itinerary', { itinerary: trip }).isError).not.toBe(true);
    const timeline = OUTPUT_SCHEMAS.get_journey_timeline.parse(
      handleTool(context, 'get_journey_timeline', { itinerary: trip, samples: 20 }).structuredContent,
    );
    expect(timeline.kind).toBe('trip');
    expect(timeline.timeline.some((sample) => sample.phase === 'stay')).toBe(true);
  });
  it('routes on request, with the same choice carried into the visualisation link', () => {
    const args = { route: 'JNB-PER', routing: { avoidAirspace: true, diversion: true } };
    const output = OUTPUT_SCHEMAS.calculate_route.parse(handleTool(context, 'calculate_route', args).structuredContent);
    expect(output.routing).toMatchObject({ avoidAirspace: true, diversion: { maxDiversionMinutes: 180 } });
    expect(output.legs?.[0].route?.diversion?.limitMinutes).toBe(180);
    const visual = OUTPUT_SCHEMAS.visualize_route.parse(handleTool(context, 'visualize_route', args).structuredContent);
    expect(visual.url).toContain('airspace=1&diversion=1');
    const plain = OUTPUT_SCHEMAS.calculate_route.parse(
      handleTool(context, 'calculate_route', { route: 'JNB-PER' }).structuredContent,
    );
    expect(plain.routing).toBeNull();
    expect(plain.legs?.[0].distanceModel).toBe('great_circle');
    expect(INPUT_SCHEMAS.calculate_route.safeParse({ route: 'JNB-PER', routing: { diversion: 30 } }).success).toBe(
      false,
    );
  });
});

describe('MCP compared trips', () => {
  const journeys = [
    { label: 'Direct', route: 'BUD-JFK', returnRoute: 'JFK-BUD', stay: '5d' },
    { sections: [{ route: 'BUD-FRA-JFK' }, { route: 'JFK-FRA-BUD', stay: 7200 }] },
  ];
  const itinerary = {
    version: 1,
    journeys: journeys.map((journey, i) => ({
      label: journey.label,
      sections:
        i === 0
          ? [
              { stops: [{ airport: 'BUD' }, { airport: 'JFK' }] },
              { stops: [{ airport: 'JFK' }, { airport: 'BUD' }], stayMinutes: 7200 },
            ]
          : [
              { stops: [{ airport: 'BUD' }, { airport: 'FRA' }, { airport: 'JFK' }] },
              { stops: [{ airport: 'JFK' }, { airport: 'FRA' }, { airport: 'BUD' }], stayMinutes: 7200 },
            ],
    })),
  };
  it('accepts round-trip shorthand and returns the published output schema, including routing', () => {
    const result = handleTool(context, 'compare_journeys', {
      journeys,
      assumeDeparture: '2026-12-01T07:00Z',
      routing: { avoidAirspace: true },
    });
    expect(result.isError).not.toBe(true);
    const plan = OUTPUT_SCHEMAS.compare_journeys.parse(result.structuredContent);
    expect(plan.kind).toBe('trip_comparison');
    expect(plan.url).toContain('b.2.route=JFK-FRA-BUD');
    expect(plan.journeys[0]).toHaveProperty('sections');
    expect(plan.journeys[0].totals).toHaveProperty('travelMinutes');
    expect(plan.comparison).toHaveProperty('sections');
    expect(plan.routing?.avoidAirspace).toBe(true);
  });
  it('visualizes and validates documents but redirects calculation and timeline tools', () => {
    for (const name of ['visualize_route', 'validate_itinerary'] as const) {
      const result = handleTool(context, name, { itinerary });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(OUTPUT_SCHEMAS[name].safeParse(result.structuredContent).success).toBe(true);
    }
    for (const name of ['calculate_route', 'get_journey_timeline'] as const) {
      const result = handleTool(context, name, { itinerary });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.issues).toContainEqual(
        expect.objectContaining({ code: 'use_compare_journeys' }),
      );
    }
  });
  it('rejects mixed alternative forms, counts, and invalid section inputs', () => {
    for (const bad of [
      [journeys[0], { route: 'BUD-JFK' }],
      [journeys[0], { sections: [{ route: 'BUD-JFK', stops: [{ airport: 'BUD' }] }] }],
      [journeys[0], { route: 'BUD-JFK', stay: 7200 }],
      [journeys[0], { sections: Array(7).fill({ route: 'BUD-JFK' }) }],
    ])
      expect(handleTool(context, 'compare_journeys', { journeys: bad }).isError).toBe(true);
  });
});
