import { MAX_LABEL_LENGTH } from '../lib/journeyLabel.ts';
import {
  MAX_STOPS,
  MAX_JOURNEYS,
  MAX_SECTIONS,
  MAX_STAY_MIN,
  MAX_TRIP_FLIGHTS,
  MAX_LAYOVER_MIN,
  MAX_URL_LENGTH,
} from './contract.ts';
import { AIRPORT_PATTERN, LOCAL_TIME_PATTERN, INSTANT_PATTERN, LABEL_PATTERN } from './itinerary.ts';

const stopProperties = {
  airport: { type: 'string', pattern: AIRPORT_PATTERN, description: 'IATA, ICAO/OurAirports ident, or numeric id.' },
  arrival: {
    type: 'string',
    pattern: LOCAL_TIME_PATTERN,
    description: 'Local wall time at this airport; optional offset.',
  },
  departure: {
    type: 'string',
    pattern: LOCAL_TIME_PATTERN,
    description: 'Local wall time at this airport; optional offset.',
  },
} as const;

const sectionProperties = {
  label: { type: 'string', minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: LABEL_PATTERN },
  stops: { $ref: '#/$defs/stops' },
} as const;
const section = {
  type: 'object',
  additionalProperties: false,
  required: ['stops'],
  properties: {
    ...sectionProperties,
    stayMinutes: {
      type: 'integer',
      minimum: 0,
      maximum: MAX_STAY_MIN,
      description: 'Stay before this section, used only while its own times do not fix it (default 7 days).',
    },
  },
} as const;
const sections = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_SECTIONS,
  description: 'Sequential journeys separated by explicit stays; connections belong inside a section.',
  // Fixed-length forms keep the first-section stay rule explicit, like the transfer-only stops rule below.
  anyOf: Array.from({ length: MAX_SECTIONS }, (_, i) => ({
    type: 'array',
    minItems: i + 1,
    maxItems: i + 1,
    prefixItems: Array.from({ length: i + 1 }, (_, k) => ({
      $ref: k === 0 ? '#/$defs/firstSection' : '#/$defs/section',
    })),
    items: false,
  })),
} as const;
/** The published document contract. Calendar, airport and chronology checks are semantic. */
export const ITINERARY_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://tmrk.github.io/globehops/agent/itinerary.schema.json',
  title: 'GlobeHops itinerary v1',
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  oneOf: [
    { type: 'object', required: ['stops'], properties: { stops: { type: 'array' } } },
    { type: 'object', required: ['journeys'], properties: { journeys: { type: 'array' } } },
    { type: 'object', required: ['sections'], properties: { sections: { type: 'array' } } },
  ],
  properties: {
    $schema: { type: 'string' },
    version: { const: 1 },
    stops: { $ref: '#/$defs/stops' },
    journeys: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_JOURNEYS,
      anyOf: [
        { items: { type: 'object', required: ['stops'], properties: { stops: {} } } },
        ...Array.from({ length: MAX_SECTIONS }, (_, i) => ({
          items: {
            type: 'object',
            required: ['sections'],
            properties: {
              sections: { type: 'array', minItems: i + 1, maxItems: i + 1 },
            },
          },
        })),
      ],
      items: {
        type: 'object',
        additionalProperties: false,
        oneOf: [
          { required: ['stops'], properties: { stops: {} } },
          { required: ['sections'], properties: { sections: {} } },
        ],
        properties: {
          sections,
          label: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_LABEL_LENGTH,
            pattern: LABEL_PATTERN,
            description: 'Name of this alternative, e.g. the traveller when comparing people’s journeys, or the offer.',
          },
          stops: { $ref: '#/$defs/stops' },
        },
      },
    },
    sections,
    view: {
      type: 'object',
      additionalProperties: false,
      properties: {
        time: { type: 'string', pattern: INSTANT_PATTERN },
        play: { type: 'boolean' },
        speed: { enum: ['auto', 1800, 3600, 7200] },
        clock: { type: 'string', pattern: '^(?:local|utc|[A-Za-z0-9]{2,8}|[0-9]+)$' },
        units: { enum: ['km', 'mi'] },
        dayNight: { type: 'boolean' },
        follow: { type: 'boolean' },
        lang: { enum: ['en', 'hu', 'sv'] },
        names: { type: 'boolean' },
        borders: { type: 'boolean' },
        airspace: { type: 'boolean', description: 'Avoid restricted airspace for this visit (app default on).' },
        diversion: {
          type: 'boolean',
          description:
            'Diversion-aware routing for this visit: keep routes within modelled reach of potential diversion airports (app default on).',
        },
        leg: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_TRIP_FLIGHTS,
          description: 'One-based flight number; must exist in this route (in a trip, counted across all sections).',
        },
      },
    },
  },
  $defs: {
    section,
    firstSection: { type: 'object', additionalProperties: false, required: ['stops'], properties: sectionProperties },
    stops: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_STOPS,
      // Enumerating lengths expresses the transfer-only layover rule without custom keywords.
      anyOf: Array.from({ length: MAX_STOPS }, (_, i) => ({
        type: 'array',
        minItems: i + 1,
        maxItems: i + 1,
        prefixItems: Array.from({ length: i + 1 }, (_, j) => ({
          $ref: j === 0 || j === i ? '#/$defs/endpoint' : '#/$defs/transfer',
        })),
        items: false,
      })),
    },

    endpoint: { type: 'object', additionalProperties: false, required: ['airport'], properties: stopProperties },
    transfer: {
      type: 'object',
      additionalProperties: false,
      required: ['airport'],
      properties: {
        ...stopProperties,
        layoverMinutes: { type: 'integer', minimum: 0, maximum: MAX_LAYOVER_MIN },
      },
    },
  },
} as const;

const stay = {
  oneOf: [
    { type: 'integer', minimum: 0, maximum: MAX_STAY_MIN },
    { type: 'string', pattern: '^\\d{1,6}[mhdMHD]?$' },
  ],
} as const;
const routeOrStops = {
  type: 'object',
  additionalProperties: false,
  oneOf: [
    { required: ['route'], properties: { route: {} } },
    { required: ['stops'], properties: { stops: {} } },
  ],
  properties: {
    route: { type: 'string', maxLength: MAX_URL_LENGTH },
    stops: { $ref: '#/$defs/stops' },
    label: ITINERARY_SCHEMA.properties.journeys.items.properties.label,
    stay,
  },
} as const;
/** Shared browser/MCP shorthand: route/stops or sections, with optional round-trip shorthand. */
export const COMPARISON_INPUT_SCHEMA = {
  $schema: ITINERARY_SCHEMA.$schema,
  type: 'object',
  additionalProperties: false,
  required: ['journeys'],
  properties: {
    journeys: {
      type: 'array',
      minItems: 2,
      maxItems: MAX_JOURNEYS,
      items: {
        type: 'object',
        additionalProperties: false,
        oneOf: [
          { type: 'object', required: ['route'], properties: { route: { type: 'string' } } },
          { type: 'object', required: ['stops'], properties: { stops: { type: 'array' } } },
          { type: 'object', required: ['sections'], properties: { sections: { type: 'array' } } },
        ],
        dependentRequired: { returnRoute: ['route'], stay: ['returnRoute'] },
        properties: {
          label: ITINERARY_SCHEMA.properties.journeys.items.properties.label,
          sections: { type: 'array', minItems: 1, maxItems: MAX_SECTIONS, items: routeOrStops },
          returnRoute: { type: 'string', maxLength: MAX_URL_LENGTH },
          stay,
          route: { type: 'string', maxLength: MAX_URL_LENGTH },
          stops: { $ref: '#/$defs/stops' },
        },
      },
    },
    view: ITINERARY_SCHEMA.properties.view,
  },
  $defs: ITINERARY_SCHEMA.$defs,
} as const;
