import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { context } from './data.ts';
import { handleTool, INPUT_SCHEMAS, type ToolName } from './tools.ts';
import { DOCUMENT_CORPUS } from './document-corpus.ts';
import { validateItineraryDocument } from '../src/agent/itinerary.ts';

const validArgs: Record<ToolName, unknown> = {
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
