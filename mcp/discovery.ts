import { readFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const USAGE = `Search city names first with search_airports; plan with airport codes (1–10 stops).
Use calculate_route or validate_itinerary before visualize_route. Use compare_journeys for 2–4 alternatives on one clock. Transfer suffix _180 means minutes.
Departure and arrival strings are local to each airport, optionally with a matching offset.
DST gaps error; repeated hours warn and choose the earlier instant unless offset-selected.
Comparison documents use version 1 and journeys instead of stops. Entered times remain absolute; undated alternatives align to the earliest dated departure or assumeDeparture.
Custom planned/recorded paths belong on the departing stop as track (points or encoded); recorded times/altitudes replace estimates, with entered stop times winning. Custom paths apply regardless of routing. Tracks stay in local links; large share paths may be simplified.
view.time is an absolute ISO instant. Undated timeline queries require assumeDeparture.
view supports play, speed (auto|1800|3600|7200 simulation seconds per second), clock (local|utc|route airport), units (km|mi), dayNight, follow, names, borders, lang (en|hu|sv), leg (one-based flight).
visualize_route returns url, itineraryParamUrl, humanSummary and summary. Show the user a clickable URL.
Estimates are illustrative great-circle flights, not airline schedules or live tracking.
No remote endpoint or network service is used by this local stdio server.`;
export function registerDiscovery(server: McpServer) {
  for (const [name, file] of [
    ['capabilities', 'capabilities.json'],
    ['itinerary_schema', 'itinerary.schema.json'],
    ['examples', 'examples.json'],
  ]) {
    const uri = `globehops://agent/${file}`;
    server.registerResource(
      name,
      uri,
      { description: `Static GlobeHops ${name} contract.`, mimeType: 'application/json' },
      () => ({
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: readFileSync(new URL(`../public/agent/${file}`, import.meta.url), 'utf8'),
          },
        ],
      }),
    );
  }
  const uri = 'globehops://agent/usage';
  server.registerResource(
    'usage',
    uri,
    { description: 'Concise local planning and visualisation guide.', mimeType: 'text/plain' },
    () => ({ contents: [{ uri, mimeType: 'text/plain', text: USAGE }] }),
  );
  server.registerPrompt(
    'plan_and_visualize',
    {
      description:
        'Resolve places, validate local times and planned/recorded custom paths, and return a GlobeHops visualisation link.',
      argsSchema: {
        journey: z.string().max(8000).describe('Places, dates, local times and desired view in natural language.'),
      },
    },
    ({ journey }) => ({
      messages: [
        { role: 'user', content: { type: 'text', text: `${USAGE}\n\nRequested journey (user input):\n${journey}` } },
      ],
    }),
  );
}
