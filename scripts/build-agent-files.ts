import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { createAgentContext, planComparison, planItinerary, SCHEDULE_ISSUES } from '../src/agent/plan.ts';
import { ITINERARY_SCHEMA } from '../src/agent/schema.ts';
import {
  CONTRACT_VERSION,
  DEFAULT_BASE_URL,
  MAX_STOPS,
  MAX_JOURNEYS,
  MAX_URL_LENGTH,
  MAX_TIMELINE_SAMPLES,
  MAX_ITINERARY_PARAM_LENGTH,
  MAX_LAYOVER_MIN,
} from '../src/agent/contract.ts';
import type { ItineraryDocument } from '../src/agent/itinerary.ts';
import { decodeDataset } from '../src/data/airports.ts';
import { decodeTimeZones } from '../src/data/timezones.ts';
import { DEFAULT_FLIGHT_TIME_MODEL } from '../src/lib/flightTime.ts';
import { EARTH_RADIUS_KM } from '../src/lib/geo.ts';
import { DEFAULT_LAYOVER_MIN } from '../src/lib/layover.ts';
import { MAX_LABEL_LENGTH } from '../src/lib/journeyLabel.ts';
import { MIN_YEAR, MAX_YEAR } from '../src/lib/timezone.ts';

const root = new URL('../', import.meta.url);
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const ctx = () =>
  createAgentContext({
    airports: decodeDataset(read('src/data/generated/airports.json')),
    timezones: decodeTimeZones(read('src/data/generated/timezones.json')),
    now: () => Date.UTC(2026, 0, 1),
  });
const exampleSpecs: { title: string; description: string; itinerary: ItineraryDocument }[] = [
  {
    title: 'Compare direct and connecting journeys',
    description: 'Entered local times stay absolute; the undated alternative aligns to the earliest dated departure.',
    itinerary: {
      version: 1,
      journeys: [
        {
          label: 'Via London',
          stops: [{ airport: 'BUD', departure: '2026-12-01T07:10' }, { airport: 'LHR' }, { airport: 'JFK' }],
        },
        { label: 'Direct', stops: [{ airport: 'BUD' }, { airport: 'JFK' }] },
      ],
      view: { play: true },
    },
  },
  {
    title: 'Copenhagen to New York',
    description: 'Undated route with flight estimates.',
    itinerary: { version: 1, stops: [{ airport: 'CPH' }, { airport: 'JFK' }] },
  },
  {
    title: 'Three hours at Heathrow',
    description: 'A custom transfer setting.',
    itinerary: { version: 1, stops: [{ airport: 'CPH' }, { airport: 'LHR', layoverMinutes: 180 }, { airport: 'JFK' }] },
  },
  {
    title: 'Fully scheduled via Heathrow',
    description: 'Every flight endpoint entered in airport-local time.',
    itinerary: {
      version: 1,
      stops: [
        { airport: 'CPH', departure: '2026-11-20T08:15' },
        { airport: 'LHR', arrival: '2026-11-20T09:05', departure: '2026-11-20T11:00' },
        { airport: 'JFK', arrival: '2026-11-20T13:50' },
      ],
    },
  },
  {
    title: 'First departure only',
    description: 'Remaining times propagated with shared flight and layover estimates.',
    itinerary: {
      version: 1,
      stops: [{ airport: 'CPH', departure: '2026-11-20T08:15' }, { airport: 'LHR' }, { airport: 'JFK' }],
    },
  },
  {
    title: 'Crossing the date line',
    description: 'Auckland to Honolulu arrives on the previous local calendar day.',
    itinerary: {
      version: 1,
      stops: [
        { airport: 'AKL', departure: '2026-11-20T00:30' },
        { airport: 'HNL', arrival: '2026-11-19T10:00' },
      ],
    },
  },
  {
    title: 'Repeated DST hour',
    description: 'An explicit EDT offset selects the earlier New York 01:30.',
    itinerary: { version: 1, stops: [{ airport: 'JFK', departure: '2026-11-01T01:30-04:00' }, { airport: 'LHR' }] },
  },
  {
    title: 'Visualisation options',
    description: 'Swedish view with simulation time, speed, UTC clock, miles, labels, borders and selected flight.',
    itinerary: {
      version: 1,
      stops: [{ airport: 'CPH', departure: '2026-11-20T08:15' }, { airport: 'JFK' }],
      view: {
        time: '2026-11-20T09:30Z',
        play: false,
        speed: 3600,
        clock: 'utc',
        units: 'mi',
        dayNight: false,
        lang: 'sv',
        names: true,
        borders: false,
        leg: 1,
        follow: true,
      },
    },
  },
  {
    title: 'Itinerary parameter',
    description: 'Use itineraryParamUrl to carry the complete v1 document as base64url JSON.',
    itinerary: {
      version: 1,
      stops: [{ airport: 'LHR', departure: '2026-11-20T11:00' }, { airport: 'JFK' }],
      view: { clock: 'JFK', units: 'km', dayNight: true },
    },
  },
];
const parameter = (
  type: string,
  required: boolean,
  format: string,
  examples: (string | number)[],
  semantics: string,
) => ({ type, required, format, examples, semantics });
export async function generateAgentFiles(): Promise<Record<string, string>> {
  const context = ctx();
  const capabilities = {
    name: 'GlobeHops',
    description:
      'Explore air journeys on an interactive globe; shared route estimates and local-time schedules for people and agents.',
    contractVersion: CONTRACT_VERSION,
    homepage: DEFAULT_BASE_URL,
    urlTemplates: {
      simple: `${DEFAULT_BASE_URL}?route={route}`,
      comparison: `${DEFAULT_BASE_URL}?route={routeA}&label={labelA}&b.route={routeB}&b.label={labelB}`,
      localized: `${DEFAULT_BASE_URL}{lang}/?route={route}`,
      scheduled: `${DEFAULT_BASE_URL}?route={route}&dep1={localDeparture}`,
      document: `${DEFAULT_BASE_URL}?itinerary={base64urlJson}`,
    },
    parameters: {
      label: parameter(
        'string',
        false,
        `1–${MAX_LABEL_LENGTH} characters without controls`,
        ['Via London'],
        'Trimmed journey A label; URL-encode Unicode and reserved characters.',
      ),
      'b./c./d.': parameter(
        'journey group',
        false,
        'prefix + route|depN|arrN|label',
        ['b.route=BUD-JFK', 'c.dep1=2026-12-01T08:00'],
        'Journeys B–D in order; gaps compact. Each group requires route. Parameter keys are case-insensitive. Other view parameters remain unprefixed; leg refers to A, clock may name any compared airport.',
      ),
      route: parameter(
        'string',
        false,
        'hyphen-separated airport tokens',
        ['CPH-JFK', 'CPH-LHR_180-JFK'],
        'Up to ten stops; transfer suffix _minutes overrides the default layover. Explicit empty route clears the route.',
      ),
      'depN/arrN': parameter(
        'string',
        false,
        'YYYY-MM-DDTHH:MM[±HH:MM|Z]',
        ['2026-11-20T08:15', '2026-11-01T01:30-04:00'],
        'Airport-local wall time at 1-based stop N. Optional :00 seconds. Date-only links are accepted as incomplete; documents require a time. Arrival at origin and departure at destination are ignored.',
      ),
      t: parameter(
        'string',
        false,
        'ISO instant with Z or offset',
        ['2026-11-20T09:30Z'],
        'Simulation clock instant, independent of airport-local input times.',
      ),
      play: parameter('string', false, '0 or 1', ['1'], 'Start playback on open; reduced motion prevents autoplay.'),
      speed: parameter(
        'string or integer',
        false,
        'auto|1800|3600|7200',
        ['auto', 3600],
        'Simulation seconds per real second; auto covers the journey in about 15 seconds.',
      ),
      clock: parameter(
        'string',
        false,
        'local|utc|airport code',
        ['local', 'utc', 'JFK'],
        'Timeline display zone; airport code must belong to any compared journey.',
      ),
      units: parameter('string', false, 'km|mi', ['km', 'mi'], 'Distance display only.'),
      follow: parameter(
        'string',
        false,
        '0 or 1',
        ['1'],
        'Follow the aircraft with the camera; off by default. User camera input exits follow.',
      ),
      daynight: parameter('string', false, '0 or 1', ['0'], 'Day/night shading; on by default.'),
      lang: parameter(
        'string',
        false,
        'en|hu|sv',
        ['en', 'hu', 'sv'],
        'Language; generated URLs use locale paths /en/, /hu/, /sv/. Query lang is an alias on the unprefixed path. Explicit path takes precedence.',
      ),
      names: parameter(
        'string',
        false,
        '0 or 1',
        ['1'],
        'Place-name labels for this visit; overrides saved preference.',
      ),
      borders: parameter(
        'string',
        false,
        '0 or 1',
        ['0'],
        'Country borders for this visit; overrides saved preference.',
      ),
      leg: parameter(
        'integer',
        false,
        '1-based flight number',
        [1, 2],
        'Frames the selected flight; must exist in the route. Does not change the simulation instant.',
      ),
      itinerary: parameter(
        'string',
        false,
        'base64url UTF-8 JSON without padding',
        ['See agent/examples.json'],
        'ItineraryDocument v1 overrides readable parameters; structural schema linked below.',
      ),
    },
    comparison: {
      document: 'Version 1; exactly one of stops or journeys (1–4 labelled stop arrays).',
      alignment:
        'Entered schedules remain absolute. Undated journeys align to the earliest dated departure, else assumeDeparture; without either they have no timeline.',
      metrics:
        'Fastest is shortest total journey duration; arrives first is earliest final UTC arrival. Exact ties have no winner. Invalid or fewer-than-two-stop journeys are excluded; arrival comparison requires every valid journey to have an end.',
    },
    schema: ITINERARY_SCHEMA.$id,
    limits: {
      stops: MAX_STOPS,
      journeys: MAX_JOURNEYS,
      minimumDocumentStops: 1,
      urlCharacters: MAX_URL_LENGTH,
      itineraryParamCharacters: MAX_ITINERARY_PARAM_LENGTH,
      maximumLayoverMinutes: MAX_LAYOVER_MIN,
      years: [MIN_YEAR, MAX_YEAR],
      timelineSamples: [2, MAX_TIMELINE_SAMPLES],
      searchLimit: [1, 100],
    },
    airportIdentifiers: {
      accepted: ['IATA', 'ICAO', 'OurAirports ident', 'numeric OurAirports id string'],
      documentPattern: ITINERARY_SCHEMA.$defs.endpoint.properties.airport.pattern,
      semantics:
        'Case-insensitive resolution; unknown codes are reported and skipped. Idents containing hyphens use numeric IDs in readable routes; the document syntax accepts 4–8 alphanumeric idents.',
    },
    timeFormats: {
      local: 'YYYY-MM-DDTHH:MM (optional :00 seconds and ±HH:MM or Z)',
      instant: 'YYYY-MM-DDTHH:MM[:SS](Z|±HH:MM)',
      offsets:
        'An offset disambiguates airport-local time; it must match the zone at that wall time. Z means local UTC+0, not conversion from UTC.',
      rules: 'Runtime Intl IANA rules; DST gaps error, ambiguous times warn and choose earlier unless offset supplied.',
    },
    estimationModel: {
      ...DEFAULT_FLIGHT_TIME_MODEL,
      earthRadiusKm: EARTH_RADIUS_KM,
      defaultLayoverMinutes: DEFAULT_LAYOVER_MIN,
      notes:
        'Great circle on a sphere; no winds, airline schedules, aircraft type or actual flight tracking. Altitude is illustrative.',
    },
    visualisationOptions: [
      't',
      'play',
      'speed',
      'clock',
      'units',
      'daynight',
      'follow',
      'lang',
      'names',
      'borders',
      'leg',
    ],
    validation: {
      valid:
        'No error issues; warnings and info preserve validity. Structural validation precedes semantic resolution. Tolerant readable links keep usable values.',
      issues: Object.entries(SCHEDULE_ISSUES).map(([code, [severity, meaning]]) => ({ code, severity, meaning })),
      agentIssues: [
        ['use_compare_journeys', 'Multi-journey documents require compare_journeys for calculations and timelines.'],
        ['unknown_airport', 'Unrecognised airport skipped.'],
        ['no_airports', 'No known airport supplied.'],
        ['invalid_link', 'Readable route syntax or limits invalid.'],
        ['invalid_assumption', 'assumeDeparture is not an ISO instant.'],
        ['assume_departure_required', 'Undated timeline needs an explicit anchor.'],
        ['timeline_unavailable', 'No playable flight timeline.'],
        ['invalid_samples', 'Sample count or instant array exceeds bounds.'],
        ['invalid_instant', 'Requested instant malformed.'],
        ['invalid_clock', 'Clock must identify local, utc or an airport in this route.'],
        ['invalid_leg', 'Selected flight must exist in this route.'],
        ['link_too_large', 'Cannot encode within sharing limits.'],
      ].map(([code, meaning]) => ({ code, severity: 'error', meaning })),
      warnings: [
        {
          code: 'document_link_too_large',
          severity: 'warning',
          meaning: 'The complete document URL exceeds limits; use the available readable URL.',
        },
      ],
      structuralCodes: [
        'type',
        'const',
        'oneOf',
        'required',
        'items',
        'pattern',
        'range',
        'position',
        'enum',
        'additionalProperties',
      ],
    },
    versioning:
      'Additive compatible changes retain v1. Breaking changes require document version 2 and a v2 link parameter/version contract; existing v1 links remain readable.',
    dataset: {
      freshness: `${DEFAULT_BASE_URL}agent/dataset.json`,
      airports: 'OurAirports, public domain; checked daily, freshness is recorded rather than guaranteed.',
      timeZones:
        'timezone-boundary-builder 2026f, derived from OpenStreetMap; ODbL-1.0. Separate derivative database at src/data/generated/timezones.json.',
      repository: 'https://github.com/tmrk/globehops',
    },
    mcp: {
      transport: 'local stdio',
      run: 'node /absolute/path/to/globehops/mcp/server.ts',
      prerequisites: 'Node >=22.18; npm ci in the checkout.',
      baseUrlEnvironment: 'GLOBEHOPS_BASE_URL',
      tools: [
        'search_airports',
        'compare_journeys',
        'calculate_route',
        'validate_itinerary',
        'visualize_route',
        'get_journey_timeline',
      ],
      resources: [
        'globehops://agent/capabilities.json',
        'globehops://agent/itinerary.schema.json',
        'globehops://agent/examples.json',
        'globehops://agent/usage',
      ],
      prompts: ['plan_and_visualize'],
      documentation: 'https://github.com/tmrk/globehops/blob/main/docs/AGENT_INTEGRATION.md',
      remoteEndpoint: null,
    },
    webMcp: {
      experimental: true,
      api: 'document.modelContext (AbortSignal cleanup), legacy navigator.modelContext registerTool/unregisterTool or provideContext',
      tools: ['get_journey', 'set_route', 'compare_journeys', 'set_view', 'select_flight', 'get_share_link'],
      network: false,
    },
    locales: ['en', 'hu', 'sv'],
    licences: {
      code: 'MIT',
      airports: 'Public domain (OurAirports)',
      timeZones: 'ODbL-1.0; © OpenStreetMap contributors',
      earth: 'NASA public-use imagery; attribution in project notices',
      borders: 'Natural Earth public domain',
      notices: 'https://github.com/tmrk/globehops/blob/main/THIRD_PARTY_NOTICES.md',
    },
  };
  const examples = exampleSpecs.map((spec) => {
    if (spec.itinerary.journeys) {
      const plan = planComparison(context, spec.itinerary);
      return {
        ...spec,
        url: plan.url,
        itineraryParamUrl: plan.itineraryParamUrl,
        expected: {
          totals: plan.journeys[0].totals,
          comparison: plan.comparison,
          issues: plan.issues,
          valid: plan.valid,
        },
      };
    }
    const plan = planItinerary(context, spec.itinerary);
    return {
      ...spec,
      url: plan.url,
      itineraryParamUrl: plan.itineraryParamUrl,
      expected: { totals: plan.totals, issues: plan.issues, valid: plan.valid },
    };
  });
  return Object.fromEntries(
    await Promise.all(
      Object.entries({
        'capabilities.json': capabilities,
        'itinerary.schema.json': ITINERARY_SCHEMA,
        'examples.json': examples,
      }).map(async ([name, value]) => [
        name,
        await format(JSON.stringify(value), { parser: 'json', tabWidth: 2, printWidth: 120 }),
      ]),
    ),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(new URL('public/agent/', root), { recursive: true });
  for (const [name, content] of Object.entries(await generateAgentFiles()))
    writeFileSync(new URL(`public/agent/${name}`, root), content);
}
