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
import { MAX_JOURNEYS, MAX_URL_LENGTH, MAX_TIMELINE_SAMPLES } from '../src/agent/contract.ts';
import { ITINERARY_SCHEMA } from '../src/agent/schema.ts';

// Derive the MCP document description and validation directly from the published schema.
// Zod's JSON Schema importer treats oneOf as the whole schema, ignoring sibling constraints.
// Import each complete form, then retain the document's exclusive choice with z.xor.
function documentForm(field: 'stops' | 'journeys' | 'sections') {
  const schema = { ...ITINERARY_SCHEMA, $id: undefined, oneOf: undefined, required: ['version', field] };
  return z.fromJSONSchema(JSON.parse(JSON.stringify(schema)));
}
const itinerary = z
  .xor([documentForm('stops'), documentForm('journeys'), documentForm('sections')])
  .describe(
    'ItineraryDocument v1; airport-local wall times, optional explicit offsets. Use sections for a round trip or multi-stage trip (stays between sections are explicit, never layovers).',
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
  .describe('Opt-in modelled routing. Omitted: great-circle distances and positions (the default).');
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
      $defs: ITINERARY_SCHEMA.$defs,
    }),
  ),
);
const comparisonJourney = z
  .strictObject({
    label: z
      .string()
      .min(1)
      .max(MAX_LABEL_LENGTH)
      .regex(new RegExp(ITINERARY_SCHEMA.properties.journeys.items.properties.label.pattern))
      .optional(),
    route: route.optional(),
    stops: comparisonStops.optional(),
  })
  .refine(
    (journey) => (journey.route !== undefined) !== (journey.stops !== undefined),
    'Supply exactly one of route or stops.',
  );
export const INPUT_SCHEMAS = {
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
  compare_journeys:
    'Compare 2–4 alternative journeys (e.g. different airlines/connections between the same cities) and return a single GlobeHops link that plays them simultaneously on one clock, with per-journey totals and which is fastest/arrives first. Use airport-local wall times from the timetable; undated journeys align to the earliest dated departure or assumeDeparture.',
  search_airports: 'Find airports using GlobeHops ranking, with coordinates and IANA time zones.',
  calculate_route:
    'Calculate 1–10 airport stops (or a trip of up to 6 sections with explicit stays), distances in km/mi (great circle by default; routing opts into restricted-airspace and diversion-aware routes), durations in minutes, airport-local and UTC times, canonical links and issues. Flight estimates (850 km/h + 30 min) are not airline schedules.',
  validate_itinerary:
    'Validate document structure, airports, local time-zone offsets and chronology using the same model as the app. Warnings remain valid.',
  visualize_route:
    'Return readable and itinerary-document globe URLs, a humanSummary and totals. Use 1–10 airport stops, or sections for a round trip/multi-stage trip; departures/arrivals are airport-local wall times; view.time is an absolute ISO instant. lang chooses en/hu/sv paths; leg is a one-based flight (counted across a trip).',
  get_journey_timeline:
    'Sample 2–1000 instants (or up to 1000 explicit ISO instants with offsets): state, latitude/longitude in degrees, illustrative altitude in km and daylight. Undated routes require assumeDeparture; a single stop has no timeline.',
};
function result(value: Record<string, unknown>, isError = false): CallToolResult {
  return {
    structuredContent: value,
    content: [{ type: 'text', text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}
/** Direct, guarded entry point shared by SDK callbacks and unit tests. */
export function handleTool(ctx: AgentContext, name: ToolName, raw: unknown): CallToolResult {
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
      const { assumeDeparture, ...input } = args;
      const plan = planComparison(ctx, input, { assumeDeparture, ...(args.routing ? { routing: args.routing } : {}) });
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
  id: z.string(),
  from: z.string(),
  to: z.string(),
  distanceKm: z
    .number()
    .describe('Flown distance used for estimates: the routed path when routed, else the great circle.'),
  distanceMi: z.number(),
  greatCircleKm: z.number(),
  distanceModel: z.enum(['great_circle', 'routed']),
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
    summary: z.object({ valid: z.boolean(), issues: issuesOutput, totals: totalsOutput.optional() }),
    comparison: comparisonOutput.optional(),
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
          model: z.enum(['great_circle', 'routed']),
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
  compare_journeys: z.object({
    contractVersion: z.literal(1),
    valid: z.boolean(),
    issues: issuesOutput,
    notes: z.array(z.string()),
    url: z.string().nullable(),
    itineraryParamUrl: z.string().nullable(),
    routing: routingOutput,
    humanSummary: z.string(),
    journeys: z.array(
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
    comparison: comparisonOutput,
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
