# Using GlobeHops from an agent

This guide is for external agents that construct links or use GlobeHops calculations. Contributor instructions live in `AGENTS.md`.

GlobeHops is a free static browser application. Give the user a link to open the full interactive globe:

```text
https://tmrk.github.io/globehops/?route=CPH-JFK
https://tmrk.github.io/globehops/?route=CPH-LHR_180-JFK
https://tmrk.github.io/globehops/?route=CPH-LHR-JFK&dep1=2026-11-20T08:15&arr2=2026-11-20T09:05&dep2=2026-11-20T11:00&arr3=2026-11-20T13:50
```

The last example uses airport-local wall times, so 08:15 in Copenhagen and 09:05 at Heathrow are in different zones. GlobeHops is an illustrative planner, not an airline schedule, booking service or flight tracker.

## Discovery

- [Agent guide (llms.txt)](https://tmrk.github.io/globehops/llms.txt)
- [Capabilities and limits](https://tmrk.github.io/globehops/agent/capabilities.json)
- [Itinerary document JSON Schema](https://tmrk.github.io/globehops/agent/itinerary.schema.json)
- [Worked examples](https://tmrk.github.io/globehops/agent/examples.json)
- [Dataset freshness](https://tmrk.github.io/globehops/agent/dataset.json)

The guide is at the project path `/globehops/llms.txt`, not the domain-root `/llms.txt`. HTML discovery links and WebApplication JSON-LD point to the same contract. These are project discovery conventions, with no claim of conformance to a formal agent standard.

## Link reference (v1)

| Parameter           | Meaning                                                                | Example                        |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| `route`             | Airport tokens separated by hyphens; custom transfer minutes after `_` | `CPH-LHR_180-JFK`              |
| `label`             | Journey A label, trimmed, 1–40 characters without controls             | `Via%20London`                 |
| `b.*`, `c.*`, `d.*` | Additional journeys: route, depN, arrN and label                       | `b.route=BUD-JFK`              |
| `depN`, `arrN`      | Local departure/arrival at 1-based stop N                              | `dep1=2026-11-20T08:15`        |
| `t`                 | Simulation instant, with Z or explicit offset                          | `2026-11-20T09:30Z`            |
| `play`              | Start playback on open; reduced motion prevents autoplay               | `1`                            |
| `live`              | Follow the real current time (the timeline's Live); replaces `t`       | `1`                            |
| `speed`             | Auto or simulation seconds per real second                             | `auto`, `1800`, `3600`, `7200` |
| `clock`             | Timeline display zone; airport code may be on any compared journey     | `local`, `utc`, `JFK`          |
| `units`             | Distance display override                                              | `km`, `mi`                     |
| `follow`            | Aircraft camera; off by default, user camera input exits               | `1` to enable                  |
| `daynight`          | Day/night shading, enabled by default                                  | `0` to disable                 |
| `lang`              | `en`, `hu`, `sv`; generated links use `/en/`, `/hu/`, `/sv/` paths     | `lang=hu` alias on root path   |
| `names`             | Place-name labels for this visit                                       | `1` on, `0` off                |
| `borders`           | Country borders for this visit                                         | `0` off, `1` on                |
| `leg`               | One-based selected flight; frames that flight without seeking time     | `2`                            |
| `itinerary`         | Alternative complete base64url UTF-8 JSON document                     | See examples file              |

The itinerary parameter takes precedence over readable parameters. An explicit locale path takes precedence over `lang`; otherwise document `view.lang` or the `?lang=` alias selects the language. `buildLinkUrl` and MCP generate locale paths, for example `/globehops/hu/?route=CPH-JFK&names=1&borders=0&leg=1`. Link and browser-tool view overrides do not save user preferences; later manual control changes may save them. When `follow` and `leg` are both supplied, the flight is selected while the aircraft camera takes priority; `select_flight` exits follow to frame its flight. URL input takes precedence over remembered browser state; absent both, the app opens an example. Explicit `?route=` clears the route. Canonical empty links omit `route`.

Unknown parameters are ignored. Readable parsing is tolerant: malformed values produce issues while usable values survive; parameter names are case-insensitive. Unknown airports are reported and skipped. Agent calculations mark unknown-airport issues as errors even though they return the surviving route. Warnings do not make an itinerary invalid.

Use IATA codes, ICAO codes, alphanumeric OurAirports identifiers or numeric OurAirports record IDs as strings. Numeric IDs also work for airports whose identifiers contain hyphens; readable route tokens cannot contain a hyphen inside an identifier. The document's identifier grammar is exactly the schema pattern: three letters, 4–8 alphanumeric characters, or an arbitrary-length numeric ID string. Existence is checked against the bundled dataset.

Local times use `YYYY-MM-DDTHH:MM`, with optional `:00` seconds and `±HH:MM` or `Z`. Escape literal plus signs as `%2B` in URLs (URLSearchParams does this). An explicit offset selects the valid airport-zone offset at that wall time. `Z` means a local UTC+0 offset; it does not mean “convert this UTC time into local time.” For example, New York `2026-11-01T01:30-04:00` chooses the earlier repeated 01:30; `-05:00` chooses the later one.

Instants (`t`, timeline `at`, `assumeDeparture`) use ISO date/time with `Z` or `±HH:MM`, with optional seconds. Date-only readable times are retained as incomplete inputs with a `time_missing` warning; itinerary documents require a time. Arrival at the origin and departure at the destination are ignored and omitted from canonical readable links. Default 90-minute layovers are omitted from canonical readable routes. Flight durations and connections come from the shared schedule model, not the presence of a layover suffix alone.

## Itinerary documents

```json
{
  "version": 1,
  "stops": [
    { "airport": "CPH", "departure": "2026-11-20T08:15" },
    { "airport": "LHR", "arrival": "2026-11-20T09:05", "departure": "2026-11-20T11:00" },
    { "airport": "JFK", "arrival": "2026-11-20T13:50" }
  ],
  "view": { "time": "2026-11-20T09:30Z", "speed": 3600, "clock": "utc", "units": "mi", "dayNight": true }
}
```

Validate with the [draft 2020-12 schema](https://tmrk.github.io/globehops/agent/itinerary.schema.json). `version: 1` and exactly one of `stops` or `journeys` are required. Each stop requires `airport`; optional fields are `arrival`, `departure`, `layoverMinutes`. Layovers are integers 0–10080 and apply only to transfer stops. All view fields are optional: `time`, `play` (boolean), `speed` (`"auto"` or numeric 1800/3600/7200), `clock`, `units`, `dayNight` (boolean), `follow` (boolean, default false), `lang` (`en`/`hu`/`sv`), `names` and `borders` (booleans), `leg` (integer 1–9, must identify a flight in this route). Unknown properties are rejected at every level; a top-level string `$schema` is allowed.

Encode compact JSON as base64url UTF-8 without padding, then append `?itinerary=<encoded>`. Each journey must contain 1–10 stops; one stop shows a single airport. Do not encode private information into links you share.

JavaScript (Node 22.18+, with a document in `doc`):

```js
const encoded = Buffer.from(JSON.stringify(doc), 'utf8').toString('base64url');
const url = 'https://tmrk.github.io/globehops/?itinerary=' + encoded;
```

Browser JavaScript:

```js
const encoded = btoa(Array.from(new TextEncoder().encode(JSON.stringify(doc)), (b) => String.fromCharCode(b)).join(''))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
```

Python (a document in `doc`):

```python
encoded = __import__('base64').urlsafe_b64encode(__import__('json').dumps(doc, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).decode('ascii').rstrip('=')
```

In a checkout, prefer `encodeItineraryParam`, `parseLink`, `serializeLink` and `buildLinkUrl`. They are the same utilities used by the app, generator and local server. Defaults, code case, optional seconds and omitted endpoint fields may be normalised when round-tripping a readable link; compare resolved itinerary state rather than byte-identical JSON.

## Compare alternative journeys

Journey IDs A–D follow array order. Readable links keep A unprefixed and use `b.`, `c.`, `d.` for the other routes, times and labels:

```text
https://tmrk.github.io/globehops/?route=BUD-LHR-JFK&dep1=2026-12-01T07:10&label=Via%20London&b.route=BUD-JFK&b.label=Direct
```

Keys are case-insensitive; gaps compact in letter order. Every prefixed group needs `route`. URL-encode label spaces, Unicode, `&` and `=`. Shared view parameters stay unprefixed; `leg` selects a flight in A, and `clock` may identify an airport in any journey. Older clients display A.

The same comparison fits the existing v1 document and `?itinerary=` encoding:

```json
{
  "version": 1,
  "journeys": [
    {
      "label": "Via London",
      "stops": [{ "airport": "BUD", "departure": "2026-12-01T07:10" }, { "airport": "LHR" }, { "airport": "JFK" }]
    },
    { "label": "Direct", "stops": [{ "airport": "BUD" }, { "airport": "JFK" }] }
  ],
  "view": { "play": true }
}
```

Documents accept 1–4 journeys, each with optional `label` (1–40 characters, no controls) and the usual stop array. Entered schedules stay at their absolute UTC instants. Undated alternatives align to the earliest dated departure; with no dated journey, MCP `assumeDeparture` supplies the shared anchor. Without either, totals are still available but times are null. All timelines use one clock.

Call local MCP `compare_journeys` with 2–4 alternatives, each containing exactly one of `route` or `stops`:

```json
{
  "journeys": [
    { "label": "Direct", "route": "BUD-JFK" },
    { "label": "Via London", "route": "BUD-LHR_180-JFK" }
  ],
  "assumeDeparture": "2026-12-01T07:00Z",
  "view": { "play": true }
}
```

It returns both URLs, `humanSummary`, per-journey airports/legs/transfers/totals, start/end times, colours and anchors, plus `comparison.fastest`, `firstArrival` and duration-sorted `ranking` with deltas in minutes. Fastest measures total elapsed journey time; first arrival measures final UTC arrival. Exact ties have no winner. Invalid/empty journeys are excluded, and arrival comparison requires an end for every valid journey. Estimates remain illustrative.

`visualize_route` and `validate_itinerary` also accept journeys documents. Visualization adds `comparison` and uses A for `summary.totals`. `calculate_route` and `get_journey_timeline` direct multi-journey documents to `compare_journeys`; a one-journey document works with either single-journey tool. See [comparison model and policy](ROUTE_COMPARISON.md).

## Validation, limits and estimates

Structural checks enforce types, patterns, required fields, additional-property rules, stop counts and transfer-only layovers. They intentionally do not validate calendar dates, zone offsets, airport existence or chronology. `validateItinerary` adds shared semantic issues to structural issues. MCP argument validation also rejects malformed tool envelopes and documents; these failures are returned as `isError` results with clear messages.

Semantic issue codes, severities and meanings are published in `capabilities.json`. Calendar errors, unsupported/missing zones, DST gaps, invalid offsets, negative flight durations and overlapping connections are errors. Ambiguous repeated hours warn and choose the earlier instant unless an offset is supplied. Short connections (<20 minutes), unusual flight durations, ignored endpoint times and layovers over seven days warn; future-rule uncertainty is informational. Issue paths refer to document stops/fields or legs, prefixed with `/journeys/i` for comparisons. `valid` means there are no errors, not that an airline operates the route or a connection is feasible.

Limits are 1–4 document journeys, 10 stops per journey, 8000 URL characters, 6000 itinerary-parameter characters, layover settings up to 10080 minutes and calendar years 1900–2100. Search returns 8 matches by default, at most 100. Timelines accept up to 1000 explicit instants or 2–1000 evenly spaced samples (default 10). A single airport has no flight timeline.

Distances use great circles on a spherical Earth, radius 6371.0088 km. Flight estimates use 850 km/h plus 30 minutes, rounded to five minutes. Distance results round to 0.1 km/mi; durations round to integer minutes. Totals are rounded from unrounded shared calculations, so rounded leg distances may differ from totals by 0.1.

Entered timepoints carry `provenance: "entered"`; propagated endpoints carry `"estimated"`; explicitly anchored undated journeys carry `"assumed"`. Legs report `durationSource`; transfers report their shared `source` (`setting` or `times`) and provenance; totals distinguish entered, estimated and mixed durations. An unanchored undated route returns null timepoints and estimated durations. A timeline requires `assumeDeparture` for such a route; the server never silently assumes “now.” Timeline instants distinguish entered requests from estimated samples and identify whether their journey anchor was entered or assumed.

Positions use the shared flight-progress model along a great circle. The website can optionally route flights around restricted airspace for people viewing a link (on by default in the display menu); agent tools, MCP results and their numbers always use great circles, so the page may show longer distances and times for such flights. Altitude is illustrative. These are not live aircraft locations. Daylight uses the shared solar model, with civil twilight, at the requested position and instant. Actual routes, winds, aircraft and airline schedules are not modelled. Time conversion uses the runtime's Intl IANA database; its vintage may differ between machines, and future rules can change.

## Dataset freshness and licences

Fetch [agent/dataset.json](https://tmrk.github.io/globehops/agent/dataset.json) for the airport build's `generatedAt`, upstream commit and counts, plus zone release, licence, attribution and build metadata, and `app` with the deployed GlobeHops release (`version`, `commit`, `date`). Vite emits this record from the current build inputs and serves it in development; it is not a separately hand-maintained snapshot. Airport updates are checked daily, but the record is the authority on the currently deployed dataset.

OurAirports data is public domain. Airport time zones are a separate ODbL-1.0 derivative database from timezone-boundary-builder 2026f/OpenStreetMap. The freshness record links to its machine-readable source. Code is MIT; imagery, borders and fonts retain their own terms. See [data sources](DATA_SOURCES.md), [time-zone processing](../data/TIMEZONES.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

Additive compatible contract changes retain v1. Breaking changes require document version 2 and an explicitly versioned v2 link parameter/contract; v1 links must remain readable.

## Local stdio MCP setup

Clone the repository and run `npm ci` using Node 22.18 or newer. The server uses the checked-out generated datasets and no network API. It loads files relative to its module, so it works from any working directory. Use an absolute path to Node if the MCP host does not inherit your shell PATH.

```sh
npm run mcp
# Equivalent direct process, preferred in MCP client configuration:
node /absolute/path/to/globehops/mcp/server.ts
```

Configure Claude Code:

```sh
claude mcp add globehops -- node /absolute/path/to/globehops/mcp/server.ts
```

Configure Codex in `~/.codex/config.toml`:

```toml
[mcp_servers.globehops]
command = "node"
args = ["/absolute/path/to/globehops/mcp/server.ts"]

# Optional for a different GlobeHops deployment:
[mcp_servers.globehops.env]
GLOBEHOPS_BASE_URL = "https://tmrk.github.io/globehops/"
```

The `command`/`args` configuration follows [official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Restart/reconnect the client after changing its configuration.

Generic clients supporting the `mcpServers` JSON convention can use:

```json
{
  "mcpServers": {
    "globehops": {
      "command": "node",
      "args": ["/absolute/path/to/globehops/mcp/server.ts"],
      "env": { "GLOBEHOPS_BASE_URL": "https://tmrk.github.io/globehops/" }
    }
  }
}
```

Server identity is `globehops`; server version comes from `package.json`. The installed SDK's latest negotiated MCP protocol is `2025-11-25`; older supported clients negotiate their supported version. All tools are read-only. Successful responses include both `structuredContent` and the same compact JSON in a text content block, plus an output schema. Errors use `isError: true`; warnings alone do not. Logs use stderr; stdout is reserved for newline-delimited JSON-RPC.

## Tools and example results

Use `tools/list` for the full machine-readable schemas. `JourneyArgs` below means exactly one of `{ "itinerary": <ItineraryDocument v1> }` or `{ "route": "CPH-LHR_180-JFK" }`; both together are rejected. All envelopes reject extra properties. Results below show selected fields; actual calculation and timeline responses include the complete documented fields.

| Tool                   | Input schema                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_airports`      | `{query: string (≤500 chars), limit?: integer (1–100, default 8)}`                                                                                         |
| `compare_journeys`     | `{journeys: [{label?, route? OR stops?}] (2–4), view?, assumeDeparture?: ISO instant}`                                                                     |
| `calculate_route`      | `JourneyArgs`                                                                                                                                              |
| `validate_itinerary`   | `JourneyArgs`                                                                                                                                              |
| `visualize_route`      | `JourneyArgs & {view?: ItineraryDocument["view"]}`; view overrides document view fields                                                                    |
| `get_journey_timeline` | `JourneyArgs & {at?: string[] (≤1000 ISO instants), samples?: integer (2–1000), assumeDeparture?: string (ISO instant)}`; `at` and `samples` are exclusive |

`search_airports`:

```json
{ "query": "CPH", "limit": 1 }
```

```json
{
  "airports": [
    {
      "code": "CPH",
      "iata": "CPH",
      "icao": "EKCH",
      "name": "Copenhagen Kastrup Airport",
      "city": "Copenhagen",
      "region": "",
      "country": "Denmark",
      "countryCode": "DK",
      "lat": 55.6179,
      "lng": 12.656,
      "type": "large",
      "scheduled": true,
      "timeZone": "Europe/Copenhagen"
    }
  ]
}
```

`calculate_route`:

```json
{ "route": "CPH-JFK" }
```

```json
{
  "contractVersion": 1,
  "totals": {
    "distanceKm": 6188.7,
    "distanceMi": 3845.5,
    "flightMinutes": 465,
    "layoverMinutes": 0,
    "journeyMinutes": 465,
    "flights": 1,
    "transfers": 0,
    "provenance": "estimated"
  },
  "valid": true,
  "issues": []
}
```

The full response also echoes input, includes canonical `url` and `itineraryParamUrl`, airport stops with zones, legs L1… with entered/estimated local/UTC timepoints or null, transfers T1… and fixed estimate notes.

`validate_itinerary`:

```json
{ "route": "CPH-JFK" }
```

```json
{ "valid": true, "issues": [] }
```

`visualize_route`:

```json
{ "route": "CPH-JFK", "view": { "units": "mi", "clock": "utc" } }
```

```json
{
  "url": "https://tmrk.github.io/globehops/?route=CPH-JFK&clock=utc&units=mi",
  "summary": {
    "totals": {
      "distanceKm": 6188.7,
      "distanceMi": 3845.5,
      "flightMinutes": 465,
      "layoverMinutes": 0,
      "journeyMinutes": 465,
      "flights": 1,
      "transfers": 0,
      "provenance": "estimated"
    },
    "issues": [],
    "valid": true
  }
}
```

`visualize_route` additionally returns `itineraryParamUrl` (the complete document link) and a one-line `humanSummary`. The existing structured `summary` is preserved. Both links are available when within sharing limits. If only the document URL exceeds the limit, `itineraryParamUrl` is null with a `document_link_too_large` warning; the readable URL remains usable and the plan remains valid.

`get_journey_timeline`:

```json
{ "route": "CPH-JFK", "samples": 3, "assumeDeparture": "2026-11-20T08:00Z" }
```

The response contains three instants, including departure and arrival. Its middle sample is:

```json
{
  "time": "2026-11-20T11:52:30Z",
  "phase": "flight",
  "legId": "L1",
  "distanceFraction": 0.5031831757711515,
  "altitudeKmIllustrative": 11,
  "position": {
    "lat": 56.53906874527615,
    "lng": -38.71059295185643,
    "provenance": "estimated",
    "model": "great_circle"
  },
  "status": { "title": "Flight 1 of 1 · En route to New York JFK", "detail": "50% of flight · ≈ 3h 53m to arrival" },
  "daylight": "day",
  "subsolarPoint": { "lat": -19.751153505430565, "lng": -1.7271684630565005 },
  "timeProvenance": "estimated",
  "anchorProvenance": "assumed"
}
```

Phases are `before`, `flight`, `transfer`, `after`. Ground states include `stopCode`; in-flight states include `distanceFraction` and illustrative altitude. For dated journeys use `at`, for example `["2026-11-20T09:30Z"]`, to request particular instants. Generated sample instants include the final arrival, whose phase is `after`.

## MCP resources and prompt

`resources/list` exposes `globehops://agent/capabilities.json`, `globehops://agent/itinerary.schema.json`, `globehops://agent/examples.json` and `globehops://agent/usage`. Read them with `resources/read`; they are module-relative local files, with no network request. Generated resource contents match static discovery. `prompts/get` with name `plan_and_visualize` and a string `journey` argument gives concise instructions to search places, validate local times and produce a clickable visualisation link.

## Experimental in-page browser tools (WebMCP)

When supported, the live app registers `get_journey`, `set_route`, `set_view`, `select_flight` and `get_share_link` once its airport and time-zone loading has settled. All execution is local; these tools introduce no network service or data transmission. With no supported API, the normal accessible UI remains available. Tool descriptions and JSON input schemas are discoverable through the browser's model-context API; errors return `isError: true` and a text block containing JSON with an actionable `error`.

| Tool             | Arguments and result                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_journey`    | `{}` → stops, legs, transfers, km/mi totals, airport-local and UTC times, validation issues, current `view` and `url`. View time is read from the live simulation clock, even during playback.                                                                                                                                                                  |
| `set_route`      | Exactly one of `{route: "CPH-LHR_180-JFK"}` or `{itinerary: <v1 document>}`. Uses shared parsing and semantic checks; errors leave the journey unchanged. Empty route clears it. Returns `applied` and issues.                                                                                                                                                  |
| `set_view`       | A partial object: `t` (absolute ISO instant), `play`, `speed`, `clock`, `units`, `dayNight`, `follow`, `names`, `borders`, `lang`, `leg`. Uses `t` here, versus `view.time` in documents. Only supplied fields change. Explicit `play: true` may start playback with reduced motion enabled, like the Play button; link autoplay still respects reduced motion. |
| `select_flight`  | `{leg: 1}` uses a one-based flight number; `{leg: null}` restores the overview. Frames without seeking the clock and exits follow.                                                                                                                                                                                                                              |
| `get_share_link` | `{}` → `{url}` with the open timeline’s instant and play state, locale path and view; a live globe remains live. Does not write playback frames to browser history. Explicit empty route is retained.                                                                                                                                                           |

The browser comparison parser accepts `compare_journeys` with the same `journeys`/`view` input as MCP, excluding `assumeDeparture`, and produces the existing `set_route` command with a journeys-document search string. `set_route.itinerary` also accepts journeys documents. `get_journey` describes an additional `comparison` result in compare mode. Comparison rendering and App integration use these shared APIs; see [implementation scope](ROUTE_COMPARISON.md).

Registration supports the current draft's `document.modelContext.registerTool(tool, {signal})` and the requested legacy `navigator.modelContext.registerTool`/`unregisterTool` or `provideContext` shape. Cleanup aborts modern registrations or unregisters legacy tools when the app unmounts, including partial-registration failures. The `provideContext` fallback owns and replaces the page's tool context. This API is experimental and may change; see the [WebMCP specification](https://webmachinelearning.github.io/webmcp/) and [original proposal](https://webmachinelearning.github.io/webmcp/docs/proposal.html).

Browser agents using the DOM can use named buttons, airport comboboxes, flight buttons, the journey list and the timeline slider. Names are localised in English, Hungarian and Swedish; native layover selects also have the combobox role, so select airport inputs by accessible name rather than by role alone. `get_journey` is the locale-independent state interface.

## Why there is no remote MCP endpoint

GitHub Pages serves static HTML, JavaScript and JSON. It cannot execute an MCP server process or handle protocol requests. The discovery files are ordinary fetchable resources; `npm run mcp` is a local stdio adapter, not a hosted endpoint.

A hosted MCP service would need a separate runtime and a Streamable HTTP transport around the same handlers/context, HTTPS, deployment and dataset-refresh operations, bounded request handling and an explicit access/rate policy. Add authentication if the hosting environment requires it. No such service is deployed by this project.

## Rebuilding and verifying discovery files

`npm run agent:build` deterministically regenerates capabilities, schema and worked examples. It uses the real datasets and `planItinerary`; it adds no generation timestamp. Example diagnostics use a fixed reference clock of 2026-01-01 so future-rule information does not drift with the day a contributor runs the command. `scripts/agent-files.test.ts` checks committed bytes, schema validity and both URL round-trips. The production build separately emits the current dataset freshness record.
