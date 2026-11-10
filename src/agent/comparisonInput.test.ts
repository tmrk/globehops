import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { comparisonDocument } from './comparisonInput.ts';
import { COMPARISON_INPUT_SCHEMA, ITINERARY_SCHEMA } from './schema.ts';
import { documentToLinkState, linkStateToDocument, validateItineraryDocument } from './itinerary.ts';
import { parseLink, serializeLink } from '../state/link.ts';

const stops = [{ airport: 'BUD' }, { airport: 'JFK' }];
const sections = [{ stops }, { stops: [...stops].reverse() }];
const schema = new Ajv2020({ strict: true }).compile(ITINERARY_SCHEMA);
const shorthandSchema = new Ajv2020({ strict: true }).compile(COMPARISON_INPUT_SCHEMA);

describe('compared trip documents and shorthand', () => {
  it('normalizes round-trip shorthand and section routes/stops to one document', () => {
    const input = {
      journeys: [
        { label: 'Direct', route: 'BUD-JFK', returnRoute: 'JFK-BUD', stay: '5d' },
        { sections: [{ route: 'BUD-JFK' }, { stops: [...stops].reverse(), stay: 7200 }] },
      ],
    };
    expect(shorthandSchema(input), JSON.stringify(shorthandSchema.errors)).toBe(true);
    const checked = comparisonDocument(input);
    expect(checked).toEqual({
      ok: true,
      doc: {
        version: 1,
        journeys: [
          { label: 'Direct', sections: [{ stops }, { stops: [...stops].reverse(), stayMinutes: 7200 }] },
          { sections: [{ stops }, { stops: [...stops].reverse(), stayMinutes: 7200 }] },
        ],
      },
    });
    if (checked.ok) expect(schema(checked.doc)).toBe(true);
  });
  it.each([
    [{ stops, sections }, { sections }],
    [{}, { stops }],
    [{ stops }, { sections }],
    [{ sections }, { sections: [sections[0]] }],
    [{ sections: [] }, { sections: [] }],
    [{ sections: Array(7).fill(sections[0]) }, { sections }],
    [{ sections: [{ ...sections[0], extra: true }] }, { sections: [sections[0]] }],
  ])('rejects incompatible document forms %# in runtime and schema', (...journeys) => {
    const raw = { version: 1, journeys };
    expect(schema(raw)).toBe(false);
    expect(validateItineraryDocument(raw).ok).toBe(false);
  });
  it('reports the exact mismatch pointer and exclusive-choice code', () => {
    const result = validateItineraryDocument({ version: 1, journeys: [{ sections }, { sections: [sections[0]] }] });
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          path: '/journeys/1/sections',
          code: 'sections_mismatch',
          message: 'Compared trips need the same number of sections in every journey.',
        },
      ],
    });
    const both = validateItineraryDocument({ version: 1, journeys: [{ stops, sections }] });
    expect(both).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: '/journeys/0', code: 'oneOf' })],
    });
  });
  it.each([
    { sections: [{ route: 'BUD-JFK', stops }] },
    { sections: [{ route: 'BUD-JFK' }, { route: 'JFK-BUD', stay: '400d' }] },
    { route: 'BUD-JFK', stay: '5d' },
    { stops, returnRoute: 'JFK-BUD' },
    { sections: [{ route: 'BUD-JFK', stay: 3 }] },
    { sections: [{ route: 'BUD-JFK' }, { route: 'JFK-BUD', stay: 1.5 }] },
    { sections: [{ route: 'BUD-JFK', secret: true }] },
    { route: 'BUD-!' },
  ])('rejects invalid shorthand %#', (journey) => {
    expect(comparisonDocument({ journeys: [journey, journey] }).ok).toBe(false);
  });
  it('keeps alternative labels separate from section labels and pads partial links', () => {
    const document = {
      version: 1 as const,
      journeys: [
        {
          label: 'Airline A',
          sections: [
            { label: 'Out', stops },
            { label: 'Back', stayMinutes: 7200, stops },
          ],
        },
        { sections: [{ label: 'Airline B', stops }, { stops }] },
      ],
    };
    const link = documentToLinkState(document);
    expect(link.label).toBe('Airline A');
    expect(link.sections?.[0]).toMatchObject({ label: 'Back', stayMin: 7200 });
    expect(link.compare?.[0].label).toBe('Airline B');
    const partial = linkStateToDocument(
      parseLink('?route=BUD-JFK&2.route=JFK-BUD&b.route=BUD-FRA-JFK&c.route=&c.2.route='),
    );
    expect(partial.journeys?.map((journey) => journey.sections?.length)).toEqual([2, 2, 2]);
    expect(partial.journeys?.[1].sections?.[1]).toEqual({ stops: [] });
    expect(validateItineraryDocument(partial).ok).toBe(false);
    const roundTrip = linkStateToDocument(link);
    expect(roundTrip.journeys?.[0]).toEqual({
      label: 'Airline A',
      sections: [{ stops }, { label: 'Back', stayMinutes: 7200, stops }],
    });
  });
  it.each([1, 6])('normalizes readable links for compared documents with %i sections', (count) => {
    const document = {
      version: 1 as const,
      journeys: [
        { label: 'A', sections: Array.from({ length: count }, () => ({ stops })) },
        { label: 'B', sections: Array.from({ length: count }, () => ({ stops })) },
      ],
    };
    const state = documentToLinkState(document);
    const airport = {
      id: 1,
      iata: 'BUD',
      icao: null,
      ident: 'BUD',
      name: '',
      city: '',
      region: '',
      country: '',
      countryCode: '',
      lat: 0,
      lng: 0,
      type: 'large' as const,
      scheduled: true,
      keywords: [],
    };
    const mapStops = (list: NonNullable<typeof state.stops>) =>
      list.map((stop) => ({
        ...stop,
        airport: { ...airport, iata: stop.code, ident: stop.code },
      }));
    const query = serializeLink(mapStops(state.stops ?? []), {}, false, {
      label: state.label,
      sections: state.sections?.map((section) => ({ ...section, stops: mapStops(section.stops) })),
      compare: state.compare?.map((journey) => ({
        ...journey,
        stops: mapStops(journey.stops),
        sections: journey.sections?.map((section) => ({ ...section, stops: mapStops(section.stops) })),
      })),
    });
    expect(parseLink(query)).toEqual(state);
  });
});
