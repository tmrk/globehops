import { importRoute } from '../src/lib/import/index.ts';
import { ImportFailure, MAX_TEXT_BYTES } from '../src/lib/import/common.ts';
import { TRACK_FORMATS } from '../src/lib/trackCodec.ts';
import { agentImportContext, importedRouteSummary, importedComparisonDocument } from '../src/agent/importRoute.ts';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  searchAirports,
  isTripDocument,
  planComparison,
  planItinerary,
  planTrip,
  timelineAt,
  tripTimelineAt,
  validateItinerary,
  type AgentContext,
  type RoutingRequest,
} from '../src/agent/plan.ts';
import { linkStateToDocument, type ItineraryDocument } from '../src/agent/itinerary.ts';
import { parseLink } from '../src/state/link.ts';
import { MAX_LABEL_LENGTH } from '../src/lib/journeyLabel.ts';
import {
  MAX_TRACK_POINTS,
  MAX_JOURNEYS,
  MAX_SECTIONS,
  MAX_STAY_MIN,
  MAX_URL_LENGTH,
  MAX_TIMELINE_SAMPLES,
} from '../src/agent/contract.ts';
import { ITINERARY_SCHEMA } from '../src/agent/schema.ts';

// Derive the MCP document description and validation directly from the published schema.
// Zod's JSON Schema importer treats oneOf as the whole schema, ignoring sibling constraints.
// Import each complete form, then retain the document's exclusive choice with z.xor.
const documentDefs = {
  ...ITINERARY_SCHEMA.$defs,
  track: {
    anyOf: ['points', 'encoded'].map((field) => ({
      ...ITINERARY_SCHEMA.$defs.track,
      oneOf: undefined,
      required: [field],
      properties: Object.fromEntries(
        Object.entries(ITINERARY_SCHEMA.$defs.track.properties).filter(
          ([key]) => key !== (field === 'points' ? 'encoded' : 'points'),
        ),
      ),
    })),
  },
};
function documentForm(field: 'stops' | 'journeys' | 'sections') {
  const journeys = ITINERARY_SCHEMA.properties.journeys;
  const { sections, stops, ...shared } = journeys.items.properties;
  // Expand the homogeneous alternatives into complete schemas: Zod's importer drops sibling constraints
  // alongside oneOf/anyOf. The published schema keeps the compact, explicit journey-item oneOf.
  const journeyForms = [
    { ...journeys.items, oneOf: undefined, required: ['stops'], properties: { ...shared, stops } },
    ...Array.from({ length: MAX_SECTIONS }, (_, i) => ({
      ...journeys.items,
      oneOf: undefined,
      required: ['sections'],
      properties: { ...shared, sections: { ...sections, anyOf: [sections.anyOf[i]] } },
    })),
  ];
  const schema = {
    ...ITINERARY_SCHEMA,
    $id: undefined,
    oneOf: undefined,
    required: ['version', field],
    // Stable local definition IDs keep repeated stop/section schemas as references on MCP export.
    $defs: Object.fromEntries(
      Object.entries(documentDefs).map(([name, value]) => [name, { ...value, id: `Itinerary_${field}_${name}` }]),
    ),
    properties: {
      $schema: ITINERARY_SCHEMA.properties.$schema,
      version: ITINERARY_SCHEMA.properties.version,
      view: ITINERARY_SCHEMA.properties.view,
      [field]:
        field === 'journeys'
          ? { anyOf: journeyForms.map((items) => ({ ...journeys, anyOf: undefined, items })) }
          : ITINERARY_SCHEMA.properties[field],
    },
  };
  return z.fromJSONSchema(JSON.parse(JSON.stringify(schema)));
}
const itinerary = z
  .xor([documentForm('stops'), documentForm('journeys'), documentForm('sections')])
  .describe(
    'ItineraryDocument v1; airport-local wall times, optional explicit offsets. Stops may carry planned or recorded custom tracks (points or encoded); recorded times anchor missing endpoints. Use sections for a round trip or multi-stage trip (stays between sections are explicit, never layovers).',
  );
const routing = z
  .strictObject({
    avoidAirspace: z
      .boolean()
      .optional()
      .describe('Route around restricted airspace valid on the flight date (EASA bulletins; EU/EEA operator assumed).'),
    diversion: z
      .union([z.boolean(), z.number().int().min(60).max(370)])
      .optional()
      .describe(
        'Keep flights within modelled reach of potential diversion airports (ETOPS/EDTO-inspired): true = 180 minutes at an assumed 400 kt on one engine; or minutes 60–370. Not an operator authorisation.',
      ),
  })
  .optional()
  .describe(
    'Opt-in modelled routing. Omitted: generated paths use great circles; custom planned/recorded tracks always apply.',
  );
const route = z
  .string()
  .max(MAX_URL_LENGTH)
  .describe('Airport codes separated by hyphens; custom transfer minutes follow _, e.g. CPH-LHR_180-JFK.');
const journeyFields = { itinerary: itinerary.optional(), route: route.optional(), routing };
const journeyInput = z
  .strictObject(journeyFields)
  .refine((v) => (v.itinerary !== undefined) !== (v.route !== undefined), 'Supply exactly one of itinerary or route.')
  .describe('Supply exactly one of itinerary (ItineraryDocument v1) or route (readable route string).');
const view = z
  .fromJSONSchema(
    JSON.parse(JSON.stringify({ ...ITINERARY_SCHEMA.properties.view, $schema: ITINERARY_SCHEMA.$schema })),
  )
  .describe('Optional visualisation options; overrides itinerary.view.');
const comparisonStops = z.fromJSONSchema(
  JSON.parse(
    JSON.stringify({
      ...ITINERARY_SCHEMA.$defs.stops,
      $schema: ITINERARY_SCHEMA.$schema,
      $defs: documentDefs,
    }),
  ),
);
const stay = z.union([z.number().int().min(0).max(MAX_STAY_MIN), z.string().regex(/^\d{1,6}[mhd]?$/i)]);
const comparisonSection = z
  .strictObject({
    route: route.optional(),
    stops: comparisonStops.optional(),
    label: z.string().min(1).max(MAX_LABEL_LENGTH).optional(),
    stay: stay.optional(),
  })
  .refine(
    (section) => (section.route !== undefined) !== (section.stops !== undefined),
    'Supply exactly one of route or stops.',
  );
const comparisonJourney = z
  .strictObject({
    label: z
      .string()
      .min(1)
      .max(MAX_LABEL_LENGTH)
      .regex(new RegExp(ITINERARY_SCHEMA.properties.journeys.items.properties.label.pattern))
      .optional()
      .describe(
        'Name shown for this alternative on its tab, table row, timeline lane and plane: e.g. the traveller (Anna) when comparing people’s trips, or the offer (Lufthansa).',
      ),
    route: route.optional(),
    stops: comparisonStops.optional(),
    sections: z.array(comparisonSection).min(1).max(MAX_SECTIONS).optional(),
    returnRoute: route.optional(),
    stay: stay.optional(),
  })
  .refine(
    (journey) =>
      [journey.route, journey.stops, journey.sections].filter((value) => value !== undefined).length === 1 &&
      (journey.returnRoute === undefined || journey.route !== undefined) &&
      (journey.stay === undefined || journey.returnRoute !== undefined),
    'Supply exactly one of route, stops or sections; returnRoute requires route, and stay requires returnRoute.',
  );
export const INPUT_SCHEMAS = {
  import_route: z
    .strictObject({
      text: z
        .string()
        .max(MAX_TEXT_BYTES)
        .optional()
        .describe('UTF-8 file contents or an aviation route string; at most 20 MiB.'),
      base64: z
        .string()
        .max(4 * Math.ceil(MAX_TEXT_BYTES / 3))
        .optional()
        .describe('Base64-encoded KMZ ZIP bytes instead of text; decoded size at most 20 MiB.'),
      fileName: z.string().max(1024).optional().describe('File name used for format detection and attribution.'),
      format: z.enum(TRACK_FORMATS).optional(),
      view: view.optional(),
      routing,
      compareWithGenerated: z.boolean().optional(),
    })
    .refine((v) => (v.text !== undefined) !== (v.base64 !== undefined), 'Supply exactly one of text or base64.')
    .meta({ oneOf: [{ required: ['text'] }, { required: ['base64'] }] }),
  search_airports: z.strictObject({
    query: z.string().max(500).describe('City, airport name, code or alternative name; accents optional.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum matches (default 8).'),
  }),
  compare_journeys: z.strictObject({
    journeys: z.array(comparisonJourney).min(2).max(MAX_JOURNEYS),
    view: view.optional(),
    assumeDeparture: z.string().max(50).optional(),
    routing,
  }),
  calculate_route: journeyInput,
  validate_itinerary: journeyInput,
  visualize_route: z
    .strictObject({ ...journeyFields, view: view.optional() })
    .refine(
      (v) => (v.itinerary !== undefined) !== (v.route !== undefined),
      'Supply exactly one of itinerary or route.',
    ),
  get_journey_timeline: z
    .strictObject({
      ...journeyFields,
      at: z
        .array(z.string().max(50).describe('ISO instant with Z or an explicit offset.'))
        .max(MAX_TIMELINE_SAMPLES)
        .optional(),
      samples: z
        .number()
        .int()
        .min(2)
        .max(MAX_TIMELINE_SAMPLES)
        .optional()
        .describe('Evenly spaced samples including journey boundaries; default 10.'),
      assumeDeparture: z
        .string()
        .max(50)
        .optional()
        .describe('ISO instant required to anchor an undated route; all derived times are assumed.'),
    })
    .refine((v) => (v.itinerary !== undefined) !== (v.route !== undefined), 'Supply exactly one of itinerary or route.')
    .refine((v) => !(v.at !== undefined && v.samples !== undefined), 'Supply at or samples, not both.'),
};
export type ToolName = keyof typeof INPUT_SCHEMAS;
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  import_route:
    'Parse a local flight file or aviation route string into flights, warnings, an itinerary document and globe links. Supports GPX, KML/KMZ (base64), GeoJSON, CSV, IGC, Garmin FPL and MSFS/Little Navmap PLN. Connected flights form a journey; open jaws form trip sections. Optional compareWithGenerated compares one imported journey with GlobeHops routing. Long links simplify paths and report issues; nothing is uploaded.',
  compare_journeys:
    'Compare 2–4 alternative journeys or round trips (offers, or different people’s trips) and return one GlobeHops link on a shared clock. Name each with label (e.g. the traveller). Each alternative supplies route, stops or sections; route plus returnRoute and optional stay is a round-trip shorthand. Trips require equal section counts and rank travel time excluding stays, with section-by-section winners. Plain journeys report fastest/first arrival. Use airport-local timetable times; untimed trip sections align with the earliest timed counterpart unless the traveller chose the stay; assumeDeparture anchors undated alternatives.',
  search_airports: 'Find airports using GlobeHops ranking, with coordinates and IANA time zones.',
  calculate_route:
    'Calculate 1–10 airport stops (or a trip of up to 6 sections with explicit stays), distances in km/mi (custom planned/recorded stop tracks, otherwise great circle by default; routing opts into restricted-airspace and diversion-aware routes), durations in minutes, airport-local and UTC times, canonical links and issues. Flight estimates (850 km/h + 30 min) are not airline schedules.',
  validate_itinerary:
    'Validate document structure, airports, local time-zone offsets and chronology using the same model as the app. Warnings remain valid.',
  visualize_route:
    'Return readable and itinerary-document globe URLs, a humanSummary and totals. Use 1–10 airport stops, or sections for a round trip/multi-stage trip; departures/arrivals are airport-local wall times; view.time is an absolute ISO instant. lang chooses en/hu/sv paths; leg is a one-based flight (counted across a trip).',
  get_journey_timeline:
    'Sample 2–1000 instants (or up to 1000 explicit ISO instants with offsets): state, latitude/longitude in degrees, track altitude when available, otherwise illustrative altitude in km, and daylight. Undated routes require assumeDeparture; a single stop has no timeline.',
};
function result(value: Record<string, unknown>, isError = false): CallToolResult {
  return {
    structuredContent: value,
    content: [{ type: 'text', text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}
/** Direct, guarded entry point shared by SDK callbacks and unit tests. */
export function handleTool(ctx: AgentContext, name: 'import_route', raw: unknown): Promise<CallToolResult>;
export function handleTool(ctx: AgentContext, name: Exclude<ToolName, 'import_route'>, raw: unknown): CallToolResult;
export function handleTool(ctx: AgentContext, name: ToolName, raw: unknown): CallToolResult | Promise<CallToolResult>;
export function handleTool(ctx: AgentContext, name: ToolName, raw: unknown): CallToolResult | Promise<CallToolResult> {
  if (name === 'import_route') return handleImportRoute(ctx, raw);
  try {
    const checked = INPUT_SCHEMAS[name].safeParse(raw);
    if (!checked.success)
      return result(
        {
          error: 'Invalid tool arguments',
          issues: checked.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        true,
      );
    if (name === 'search_airports') {
      const args = INPUT_SCHEMAS.search_airports.parse(raw);
      return result({ airports: searchAirports(ctx, args.query, args.limit) });
    }
    if (name === 'compare_journeys') {
      const args = INPUT_SCHEMAS.compare_journeys.parse(raw);
      const { assumeDeparture, routing: requestedRouting, ...input } = args;
      const plan = planComparison(ctx, input, {
        assumeDeparture,
        ...(requestedRouting ? { routing: requestedRouting } : {}),
      });
      return result(plan, !plan.valid);
    }
    const args = checked.data as {
      itinerary?: unknown;
      route?: string;
      at?: string[];
      samples?: number;
      assumeDeparture?: string;
      routing?: RoutingRequest;
    };
    const options = args.routing ? { routing: args.routing } : {};
    let input: unknown = args.itinerary ?? { route: args.route };
    if (name === 'visualize_route') {
      const visual = INPUT_SCHEMAS.visualize_route.parse(raw);
      if (visual.view !== undefined || args.routing) {
        const parsedRoute = args.route !== undefined ? parseLink(`?route=${encodeURIComponent(args.route)}`) : null;
        const initial =
          args.itinerary !== undefined
            ? (args.itinerary as ItineraryDocument)
            : linkStateToDocument(parsedRoute ?? parseLink(''));
        input = {
          ...initial,
          view: { ...(args.itinerary !== undefined ? initial.view : {}), ...((visual.view as object) ?? {}) },
        };
        // Keep tolerant route diagnostics when converting to a strict document.
        if (parsedRoute?.issues.length) return result({ error: 'Invalid route', issues: parsedRoute.issues }, true);
      }
      if (args.routing && input && typeof input === 'object') {
        // The app shows the same routing for this visit; minutes other than 180 can't be shown there.
        const doc = input as ItineraryDocument;
        input = {
          ...doc,
          view: { ...doc.view, airspace: !!args.routing.avoidAirspace, diversion: !!args.routing.diversion },
        };
      }
      if (input && typeof input === 'object' && 'journeys' in input) {
        const plan = planComparison(ctx, input, options);
        return result(
          {
            url: plan.url,
            itineraryParamUrl: plan.itineraryParamUrl,
            humanSummary: plan.humanSummary,
            summary: { valid: plan.valid, issues: plan.issues, totals: plan.journeys[0]?.totals },
            comparison: plan.comparison,
          },
          !plan.valid,
        );
      }
      if (isTripDocument(input)) {
        const plan = planTrip(ctx, input, options);
        return result(
          {
            url: plan.url,
            itineraryParamUrl: plan.itineraryParamUrl,
            humanSummary: plan.humanSummary,
            summary: { valid: plan.valid, issues: plan.issues, totals: plan.sections[0]?.totals },
            trip: { totals: plan.totals, stays: plan.stays },
          },
          !plan.valid,
        );
      }
      const plan = planItinerary(ctx, input, options);
      return result(
        {
          url: plan.url,
          itineraryParamUrl: plan.itineraryParamUrl,
          humanSummary: `${plan.stops.map((s) => s.code).join(' → ') || 'Empty route'} · ${plan.totals.flights} flights · ${plan.totals.distanceKm} km · ${plan.totals.journeyMinutes} min (${plan.totals.provenance}).`,
          summary: { totals: plan.totals, issues: plan.issues, valid: plan.valid },
        },
        !plan.valid,
      );
    }
    if (name === 'validate_itinerary') {
      const issues = validateItinerary(ctx, input);
      const valid = !issues.some((i) => i.severity === 'error');
      return result({ valid, issues }, !valid);
    }
    if (name === 'get_journey_timeline') {
      const at = args.at ?? { samples: args.samples ?? 10 };
      const value = isTripDocument(input)
        ? tripTimelineAt(ctx, input, at, { assumeDeparture: args.assumeDeparture, ...options })
        : timelineAt(ctx, input, at, { assumeDeparture: args.assumeDeparture, ...options });
      return result(value, !value.valid);
    }
    const plan = isTripDocument(input) ? planTrip(ctx, input, options) : planItinerary(ctx, input, options);
    return result(plan, !plan.valid);
  } catch (error) {
    return result({ error: error instanceof Error ? error.message : 'Tool failed.' }, true);
  }
}
/** Async only for the importer (KMZ decompression); existing direct handlers remain synchronous. */
async function handleImportRoute(ctx: AgentContext, raw: unknown): Promise<CallToolResult> {
  try {
    const checked = INPUT_SCHEMAS.import_route.safeParse(raw);
    if (!checked.success) {
      const tooLarge = checked.error.issues.some(
        (issue) => issue.code === 'too_big' && ['text', 'base64'].includes(String(issue.path[0])),
      );
      return result(
        {
          code: tooLarge ? 'too_large' : 'invalid',
          message: checked.error.issues.map((issue) => issue.message).join(' '),
        },
        true,
      );
    }
    const args = checked.data;
    let input: string | Uint8Array = args.text ?? '';
    if (args.base64 !== undefined) {
      if (args.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(args.base64))
        throw new ImportFailure('invalid', 'base64 must contain standard padded Base64 KMZ bytes.');
      input = Buffer.from(args.base64, 'base64');
      if (Buffer.from(input).toString('base64') !== args.base64)
        throw new ImportFailure('invalid', 'base64 must use canonical padded Base64.');
      if (input.length > MAX_TEXT_BYTES) throw new ImportFailure('too_large', 'Route input exceeds 20 MB.');
      if (args.format !== undefined && args.format !== 'kmz')
        throw new ImportFailure('unsupported', 'base64 is supported only for KMZ.');
    }
    const parsed = await importRoute(input, agentImportContext(ctx), {
      fileName: args.fileName,
      format: args.base64 !== undefined ? 'kmz' : args.format,
    });
    if (parsed.flights.some((flight) => flight.track.points.length > MAX_TRACK_POINTS))
      throw new ImportFailure(
        'too_large',
        `Itinerary documents support at most ${MAX_TRACK_POINTS} points per flight.`,
      );
    const summary = importedRouteSummary(parsed);
    const document = args.compareWithGenerated
      ? importedComparisonDocument(summary.document, parsed.name)
      : summary.document;
    const visual = handleTool(ctx, 'visualize_route', { itinerary: document, view: args.view, routing: args.routing });
    return result({ ...summary, document, ...visual.structuredContent }, visual.isError === true);
  } catch (error) {
    return result(
      {
        code: error instanceof ImportFailure ? error.code : 'invalid',
        message: error instanceof Error ? error.message : 'Route import failed.',
      },
      true,
    );
  }
}
const issuesOutput = z.array(
  z.object({
    code: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    path: z.string().optional(),
  }),
);
const totalsOutput = z.object({
  distanceKm: z.number(),
  distanceMi: z.number(),
  flightMinutes: z.number().int(),
  layoverMinutes: z.number().int(),
  journeyMinutes: z.number().int(),
  flights: z.number().int(),
  transfers: z.number().int(),
  provenance: z.enum(['entered', 'estimated', 'mixed']),
});
const airportOutput = z.object({
  code: z.string(),
  iata: z.string().nullable(),
  icao: z.string().nullable(),
  name: z.string(),
  city: z.string(),
  region: z.string(),
  country: z.string(),
  countryCode: z.string(),
  lat: z.number(),
  lng: z.number(),
  type: z.enum(['large', 'medium', 'small', 'seaplane', 'heliport']),
  scheduled: z.boolean(),
  timeZone: z.string().nullable(),
});
const timeOutput = z
  .object({
    local: z.string(),
    utc: z.string(),
    offset: z.string(),
    timeZone: z.string(),
    provenance: z.enum(['entered', 'estimated', 'assumed']),
  })
  .nullable();
const routingOutput = z
  .object({
    avoidAirspace: z.boolean(),
    airspaceReviewed: z.string().nullable(),
    diversion: z
      .object({
        profile: z.string(),
        maxDiversionMinutes: z.number(),
        oeiSpeedKt: z.number(),
        radiusKm: z.number(),
      })
      .nullable(),
    note: z.string(),
  })
  .nullable();
const legOutput = z.object({
  path: z.object({
    kind: z.enum(['generated', 'planned', 'recorded']),
    distanceKm: z.number(),
    greatCircleKm: z.number(),
    points: z.number().int().min(2).max(MAX_TRACK_POINTS),
    source: z.object({ format: z.string(), name: z.string().nullable() }).optional(),
    recordedDurationMin: z.number().int().optional(),
  }),
  id: z.string(),
  from: z.string(),
  to: z.string(),
  distanceKm: z
    .number()
    .describe(
      'Flown distance used for estimates: a custom track, otherwise the routed path when routed, else the great circle.',
    ),
  distanceMi: z.number(),
  greatCircleKm: z.number(),
  distanceModel: z.enum(['great_circle', 'routed', 'planned', 'recorded']),
  route: z
    .object({
      airspace: z.object({
        status: z.enum(['clear', 'detour', 'partial', 'unavoided']),
        avoided: z.array(z.string()),
        crossed: z.array(z.string()),
      }),
      diversion: z
        .object({
          profile: z.string(),
          limitMinutes: z.number(),
          status: z.enum(['covered', 'adjusted', 'gap']),
          maxDiversionMinutes: z.number(),
          outsideKm: z.number(),
          extraKm: z.number(),
          beyondThresholdKm: z.number(),
        })
        .optional(),
    })
    .optional(),
  estimatedFlightMinutes: z.number().int().nullable(),
  departure: timeOutput,
  arrival: timeOutput,
  durationMinutes: z.number().int().nullable(),
  durationSource: z.enum(['entered', 'estimated', 'mixed']),
});
const transferOutput = z.object({
  id: z.string(),
  airport: z.string(),
  minutes: z.number().int(),
  source: z.enum(['setting', 'times']),
  provenance: z.enum(['entered', 'estimated', 'mixed']),
});
const tripTotalsOutput = z.object({
  distanceKm: z.number(),
  distanceMi: z.number(),
  flightMinutes: z.number().int(),
  connectionMinutes: z.number().int(),
  stayMinutes: z.number().int(),
  tripMinutes: z.number().int(),
  flights: z.number().int(),
  connections: z.number().int(),
  sections: z.number().int(),
  stays: z.number().int(),
  departure: timeOutput,
  arrival: timeOutput,
  provenance: z.enum(['entered', 'estimated', 'mixed']),
});
const stayOutput = z.object({
  afterSection: z.number().int(),
  beforeSection: z.number().int(),
  arrivalAirport: z.string(),
  departureAirport: z.string(),
  openJaw: z.boolean(),
  arrival: timeOutput,
  departure: timeOutput,
  minutes: z.number().int(),
  days: z.number().int().nullable(),
  source: z.enum(['times', 'setting']),
  provenance: z.enum(['entered', 'estimated', 'assumed', 'mixed']),
});
const sectionOutput = z.object({
  index: z.number().int(),
  name: z.string(),
  label: z.string().nullable(),
  anchor: z.enum(['entered', 'estimated', 'assumed', 'none']),
  stops: z.array(airportOutput),
  legs: z.array(legOutput),
  transfers: z.array(transferOutput),
  totals: totalsOutput,
  departure: timeOutput,
  arrival: timeOutput,
});
const comparisonOutput = z.object({
  fastest: z.enum(['A', 'B', 'C', 'D']).nullable(),
  firstArrival: z.enum(['A', 'B', 'C', 'D']).nullable(),
  ranking: z.array(
    z.object({ id: z.enum(['A', 'B', 'C', 'D']), journeyMinutes: z.number(), deltaMinutes: z.number() }),
  ),
});
const tripComparisonOutput = z.object({
  fastest: z.enum(['A', 'B', 'C', 'D']).nullable(),
  ranking: z.array(z.object({ id: z.enum(['A', 'B', 'C', 'D']), travelMinutes: z.number(), deltaMinutes: z.number() })),
  sections: z.array(
    z.object({
      name: z.string(),
      fastest: z.enum(['A', 'B', 'C', 'D']).nullable(),
      deltaMinutes: z.object({ A: z.number(), B: z.number(), C: z.number(), D: z.number() }),
    }),
  ),
});
const comparedTripOutput = z.object({
  id: z.enum(['A', 'B', 'C', 'D']),
  label: z.string().nullable(),
  color: z.string(),
  anchor: z.enum(['entered', 'assumed', 'none']),
  sections: z.array(sectionOutput),
  stays: z.array(stayOutput),
  totals: tripTotalsOutput.extend({ travelMinutes: z.number().int() }),
});
const singleOutputs = {
  search_airports: z.object({ airports: z.array(airportOutput) }),
  calculate_route: z.object({
    contractVersion: z.literal(1),
    kind: z.enum(['journey', 'trip']).describe('trip for documents with sections; its journeys are in sections.'),
    input: z.unknown(),
    valid: z.boolean(),
    issues: issuesOutput,
    url: z.string().nullable(),
    itineraryParamUrl: z.string().nullable(),
    routing: routingOutput,
    totals: z.union([totalsOutput, tripTotalsOutput]),
    stops: z.array(airportOutput).optional(),
    notes: z.array(z.string()),
    legs: z.array(legOutput).optional(),
    transfers: z.array(transferOutput).optional(),
    humanSummary: z.string().optional(),
    sections: z.array(sectionOutput).optional(),
    stays: z.array(stayOutput).optional(),
  }),
  validate_itinerary: z.object({ valid: z.boolean(), issues: issuesOutput }),
  visualize_route: z.object({
    url: z.string().nullable(),
    itineraryParamUrl: z.string().nullable(),
    humanSummary: z.string(),
    summary: z.object({
      valid: z.boolean(),
      issues: issuesOutput,
      totals: z.union([totalsOutput, tripTotalsOutput]).optional(),
    }),
    comparison: z.union([comparisonOutput, tripComparisonOutput]).optional(),
    trip: z.object({ totals: tripTotalsOutput, stays: z.array(stayOutput) }).optional(),
  }),
  get_journey_timeline: z.object({
    contractVersion: z.literal(1),
    kind: z.enum(['journey', 'trip']),
    valid: z.boolean(),
    issues: issuesOutput,
    timeline: z.array(
      z.object({
        time: z.string(),
        phase: z.enum(['before', 'flight', 'transfer', 'after', 'stay']),
        section: z.number().int().optional().describe('Trip section; during a stay, the section that follows it.'),
        globalLeg: z.number().int().optional(),
        legId: z.string().optional(),
        stopCode: z.string().optional(),
        distanceFraction: z.number().optional(),
        altitudeKmIllustrative: z.number().optional(),
        position: z.object({
          lat: z.number(),
          lng: z.number(),
          provenance: z.literal('estimated'),
          model: z.enum(['great_circle', 'routed', 'planned', 'recorded']),
        }),
        status: z.object({ title: z.string(), detail: z.string() }),
        daylight: z.enum(['day', 'twilight', 'night']),
        subsolarPoint: z.object({ lat: z.number(), lng: z.number() }),
        timeProvenance: z.enum(['entered', 'estimated']),
        anchorProvenance: z.enum(['entered', 'assumed']),
      }),
    ),
  }),
};
export const OUTPUT_SCHEMAS = {
  ...singleOutputs,
  import_route: singleOutputs.visualize_route.extend({
    format: z.enum(TRACK_FORMATS).nullable(),
    name: z.string().nullable(),
    flights: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        kind: z.enum(['planned', 'recorded']),
        points: z.number().int().min(2),
        distanceKm: z.number(),
        greatCircleKm: z.number(),
        recordedDurationMin: z.number().int().optional(),
        fromDistanceKm: z.number(),
        toDistanceKm: z.number(),
      }),
    ),
    warnings: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])),
      }),
    ),
    document: itinerary,
  }),
  compare_journeys: z.object({
    contractVersion: z.literal(1),
    valid: z.boolean(),
    issues: issuesOutput,
    notes: z.array(z.string()),
    url: z.string().nullable(),
    itineraryParamUrl: z.string().nullable(),
    routing: routingOutput,
    humanSummary: z.string(),
    kind: z.enum(['comparison', 'trip_comparison']),
    journeys: z.union([
      z.array(
        z.object({
          id: z.enum(['A', 'B', 'C', 'D']),
          label: z.string().nullable(),
          color: z.string(),
          stops: z.array(airportOutput),
          legs: z.array(legOutput),
          transfers: z.array(transferOutput),
          totals: totalsOutput,
          departure: timeOutput,
          arrival: timeOutput,
          anchor: z.enum(['entered', 'assumed', 'none']),
        }),
      ),
      z.array(comparedTripOutput),
    ]),
    comparison: z.union([comparisonOutput, tripComparisonOutput]),
  }),
};
export function registerTools(server: McpServer, ctx: AgentContext) {
  for (const name of Object.keys(INPUT_SCHEMAS) as ToolName[]) {
    server.registerTool(
      name,
      {
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: INPUT_SCHEMAS[name],
        outputSchema: OUTPUT_SCHEMAS[name],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      (args: unknown) => handleTool(ctx, name, args),
    );
  }
}
