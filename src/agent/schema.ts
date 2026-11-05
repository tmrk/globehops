import { MAX_STOPS, MAX_LAYOVER_MIN } from './contract.ts';
import { AIRPORT_PATTERN, LOCAL_TIME_PATTERN, INSTANT_PATTERN } from './itinerary.ts';

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

/** The published document contract. Calendar, airport and chronology checks are semantic. */
export const ITINERARY_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://tmrk.github.io/globehops/agent/itinerary.schema.json',
  title: 'GlobeHops itinerary v1',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'stops'],
  properties: {
    $schema: { type: 'string' },
    version: { const: 1 },
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
      },
    },
  },
  $defs: {
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
