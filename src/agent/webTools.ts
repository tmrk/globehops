import { MAX_JOURNEYS, MAX_URL_LENGTH } from './contract.ts';
import { comparisonDocument } from './comparisonInput.ts';
import { ITINERARY_SCHEMA, COMPARISON_INPUT_SCHEMA } from './schema.ts';
import { documentToLinkState, validateItineraryDocument, encodeItineraryParam } from './itinerary.ts';
import { parseLink, type LinkState, type LinkView } from '../state/link.ts';

export const WEB_TOOL_NAMES = [
  'get_journey',
  'set_route',
  'compare_journeys',
  'set_view',
  'select_flight',
  'get_share_link',
] as const;
export type WebToolName = (typeof WEB_TOOL_NAMES)[number];
export type WebCommand =
  | { type: 'get_journey' }
  | { type: 'get_share_link' }
  | { type: 'set_route'; link: LinkState; search: string }
  | { type: 'set_view'; view: Partial<LinkView> }
  | { type: 'select_flight'; leg: number | null };
const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const { time: instantSchema, ...viewProperties } = ITINERARY_SCHEMA.properties.view.properties;
export const WEB_TOOL_DEFINITIONS = [
  {
    name: 'get_journey',
    description:
      'Read the live journey, km/mi totals, airport-local and UTC times, issues, view and share link. In compare mode also returns comparison.',
    inputSchema: emptySchema,
  },
  {
    name: 'set_route',
    description:
      'Replace the route with 1–10 airport codes (transfer suffix _minutes), or an itinerary v1 document (sections for a round trip or multi-stage trip with explicit stays). Local times belong to each airport. Supply exactly one input; an empty route clears the journey.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { route: { type: 'string', maxLength: MAX_URL_LENGTH }, itinerary: ITINERARY_SCHEMA },
      oneOf: [{ required: ['route'] }, { required: ['itinerary'] }],
    },
  },
  {
    name: 'compare_journeys',
    description:
      'Compare 2–4 alternative journeys or round trips on one shared clock. Use airport-local timetable times; undated alternatives align to the earliest dated departure. Replaces the route for this visit.',
    inputSchema: COMPARISON_INPUT_SCHEMA,
  },
  {
    name: 'set_view',
    description:
      'Patch the view for this visit. t is an ISO instant with offset; speed is simulation seconds per second (auto ≈15s journey). airspace/diversion switch restricted-airspace avoidance and diversion-aware routing for the visit. In a trip, leg counts flights across its journeys. Explicit play is a user-requested action. No preferences are saved.',
    inputSchema: {
      ...ITINERARY_SCHEMA.properties.view,
      properties: {
        ...viewProperties,
        t: instantSchema,
      },
    },
  },
  {
    name: 'select_flight',
    description: 'Frame a one-based flight number; null restores the route overview.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['leg'],
      properties: { leg: { type: ['integer', 'null'], minimum: 1, maximum: 9 } },
    },
  },
  {
    name: 'get_share_link',
    description:
      'Return a share URL with the current view and open timeline instant/play state; a live globe remains live. Never writes playback frames to history.',
    inputSchema: emptySchema,
  },
] as const;
const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);
/** Validate everything before a live app mutation; no DOM, storage or network access. */
export function parseWebCommand(name: WebToolName, raw: unknown, flights: number): WebCommand {
  if (!isObject(raw)) throw new TypeError('Arguments must be an object.');
  const keys = (allowed: string[]) => {
    for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new TypeError(`Unknown argument ${key}.`);
  };
  if (name === 'get_journey' || name === 'get_share_link') {
    keys([]);
    return { type: name };
  }
  if (name === 'select_flight') {
    keys(['leg']);
    if (
      raw.leg !== null &&
      (typeof raw.leg !== 'number' || !Number.isInteger(raw.leg) || raw.leg < 1 || raw.leg > flights)
    )
      throw new TypeError(`leg must be null or a flight number from 1 to ${flights}.`);
    return { type: name, leg: raw.leg as number | null };
  }
  if (name === 'compare_journeys') {
    keys(['journeys', 'view']);
    if (!Array.isArray(raw.journeys) || raw.journeys.length < 2 || raw.journeys.length > MAX_JOURNEYS)
      throw new TypeError('Supply 2–4 journeys.');
    const checked = comparisonDocument(raw);
    if (!checked.ok) throw new TypeError(checked.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' '));
    const link = documentToLinkState(checked.doc);
    if (link.issues.length) throw new TypeError(link.issues.join(' '));
    return { type: 'set_route', link, search: `?itinerary=${encodeItineraryParam(checked.doc)}` };
  }
  if (name === 'set_route') {
    keys(['route', 'itinerary']);
    if ((raw.route !== undefined) === (raw.itinerary !== undefined))
      throw new TypeError('Supply exactly one of route or itinerary.');
    let link: LinkState;
    let search: string;
    if (raw.route !== undefined) {
      if (typeof raw.route !== 'string' || raw.route.length > MAX_URL_LENGTH)
        throw new TypeError(`route must be a string of at most ${MAX_URL_LENGTH} characters.`);
      search = `?route=${encodeURIComponent(raw.route)}`;
      link = parseLink(search);
    } else {
      const checked = validateItineraryDocument(raw.itinerary);
      if (!checked.ok) throw new TypeError(checked.issues.map((i) => `${i.path}: ${i.message}`).join(' '));
      search = `?itinerary=${encodeItineraryParam(checked.doc)}`;
      link = documentToLinkState(checked.doc);
    }
    if (link.issues.length) throw new TypeError(link.issues.join(' '));
    return { type: name, link, search };
  }
  keys([
    't',
    'play',
    'speed',
    'clock',
    'units',
    'dayNight',
    'follow',
    'lang',
    'names',
    'borders',
    'airspace',
    'diversion',
    'leg',
  ]);
  if (raw.leg !== undefined && (typeof raw.leg !== 'number' || raw.leg > flights))
    throw new TypeError(`leg must be a flight number from 1 to ${flights}.`);
  const { t, ...view } = raw;
  const checked = validateItineraryDocument({
    version: 1,
    stops: Array.from({ length: Math.max(1, flights + 1) }, () => ({ airport: 'CPH' })),
    view: { ...view, ...(t !== undefined ? { time: t } : {}) },
  });
  if (!checked.ok) throw new TypeError(checked.issues.map((i) => `${i.path}: ${i.message}`).join(' '));
  const parsed = documentToLinkState(checked.doc);
  if (parsed.issues.length) throw new TypeError(parsed.issues.join(' '));
  const patch: Partial<LinkView> = {};
  for (const key of Object.keys(raw)) {
    const field = key === 't' ? 'time' : (key as keyof LinkView);
    Object.assign(patch, { [field]: parsed.view[field] });
  }
  return { type: name, view: patch };
}
