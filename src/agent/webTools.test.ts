import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseWebCommand, WEB_TOOL_DEFINITIONS, type WebToolName } from './webTools.ts';

describe('browser agent commands', () => {
  it('maps partial view changes without replacing unspecified fields', () => {
    expect(
      parseWebCommand(
        'set_view',
        { t: '2026-11-20T10:00Z', play: false, names: true, borders: false, follow: true, lang: 'hu', leg: 2 },
        2,
      ),
    ).toEqual({
      type: 'set_view',
      view: {
        time: Date.parse('2026-11-20T10:00Z'),
        play: false,
        names: true,
        borders: false,
        follow: true,
        lang: 'hu',
        leg: 2,
      },
    });
    expect(parseWebCommand('set_view', { units: 'mi' }, 0)).toEqual({ type: 'set_view', view: { units: 'mi' } });
  });
  it('uses the shared route and document parsers', () => {
    const route = parseWebCommand('set_route', { route: 'CPH-LHR_180-JFK' }, 0);
    expect(route.type === 'set_route' && route.link.stops?.[1]).toMatchObject({ code: 'LHR', layoverMin: 180 });
    const doc = parseWebCommand(
      'set_route',
      {
        itinerary: {
          version: 1,
          stops: [{ airport: 'JFK', departure: '2026-11-01T01:30-04:00' }, { airport: 'LHR' }],
          view: { lang: 'sv', names: true },
        },
      },
      0,
    );
    expect(doc.type === 'set_route' && doc.link.view).toMatchObject({ lang: 'sv', names: true });
    expect(parseWebCommand('set_route', { route: '' }, 0).type).toBe('set_route');
  });
  it.each<[WebToolName, unknown]>([
    ['get_journey', { airport: 'CPH' }],
    ['get_share_link', null],
    ['set_view', { t: '2026-11-20T10:00' }],
    ['set_view', { t: '2026-02-30T10:00Z' }],
    ['set_view', { names: 1 }],
    ['set_view', { speed: 1 }],
    ['set_view', { lang: 'de' }],
    ['set_view', { leg: 3 }],
    ['set_view', { leg: 0 }],
    ['set_view', { unknown: true }],
    ['select_flight', {}],
    ['select_flight', { leg: 1.5 }],
    ['select_flight', { leg: 3 }],
    ['set_route', { route: 'CPH', itinerary: {} }],
    ['set_route', {}],
    ['set_route', { route: 'CPH-!' }],
    ['set_route', { route: Array(11).fill('CPH').join('-') }],
    ['set_route', { itinerary: { version: 2 } }],
  ])('rejects %s arguments %j before mutation', (name, args) => {
    expect(() => parseWebCommand(name, args, 2)).toThrow();
  });
  it('allows explicit flight deselection and read commands', () => {
    expect(parseWebCommand('select_flight', { leg: null }, 2)).toEqual({ type: 'select_flight', leg: null });
    expect(parseWebCommand('get_journey', {}, 2)).toEqual({ type: 'get_journey' });
    expect(parseWebCommand('get_share_link', {}, 2)).toEqual({ type: 'get_share_link' });
  });
  it('publishes valid JSON schemas for all five tools', () => {
    for (const definition of WEB_TOOL_DEFINITIONS)
      expect(new Ajv2020({ strict: false }).compile(definition.inputSchema)).toBeTypeOf('function');
  });
});
