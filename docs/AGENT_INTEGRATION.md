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
- [Eight complete worked examples](https://tmrk.github.io/globehops/agent/examples.json)
- [Dataset freshness](https://tmrk.github.io/globehops/agent/dataset.json)

The guide is at the project path `/globehops/llms.txt`, not the domain-root `/llms.txt`. HTML discovery links and WebApplication JSON-LD point to the same contract. These are project discovery conventions, with no claim of conformance to a formal agent standard.

## Link reference (v1)

| Parameter      | Meaning                                                                | Example                        |
| -------------- | ---------------------------------------------------------------------- | ------------------------------ |
| `route`        | Airport tokens separated by hyphens; custom transfer minutes after `_` | `CPH-LHR_180-JFK`              |
| `depN`, `arrN` | Local departure/arrival at 1-based stop N                              | `dep1=2026-11-20T08:15`        |
| `t`            | Simulation instant, with Z or explicit offset                          | `2026-11-20T09:30Z`            |
| `play`         | Start playback on open; reduced motion prevents autoplay               | `1`                            |
| `speed`        | Auto or simulation seconds per real second                             | `auto`, `1800`, `3600`, `7200` |
| `clock`        | Timeline display zone; airport code must be on the route               | `local`, `utc`, `JFK`          |
| `units`        | Distance display override                                              | `km`, `mi`                     |
| `follow`       | Aircraft camera; off by default, user camera input exits               | `1` to enable                  |
| `daynight`     | Day/night shading, enabled by default                                  | `0` to disable                 |
| `itinerary`    | Alternative complete base64url UTF-8 JSON document                     | See examples file              |

The itinerary parameter takes precedence over readable parameters. URL input takes precedence over remembered browser state; absent both, the app opens an example. Explicit `?route=` clears the route. Canonical empty links omit `route`.

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

Validate with the [draft 2020-12 schema](https://tmrk.github.io/globehops/agent/itinerary.schema.json). `version` and `stops` are required. Each stop requires `airport`; optional fields are `arrival`, `departure`, `layoverMinutes`. Layovers are integers 0–10080 and apply only to transfer stops. All view fields are optional: `time`, `play` (boolean), `speed` (`"auto"` or numeric 1800/3600/7200), `clock`, `units`, `dayNight` (boolean), `follow` (boolean, default false). Unknown properties are rejected at every level; a top-level string `$schema` is allowed.

Encode compact JSON as base64url UTF-8 without padding, then append `?itinerary=<encoded>`. JSON documents must contain 1–10 stops; one stop shows a single airport. Do not encode private information into links you share.

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

## Validation, limits and estimates

Structural checks enforce types, patterns, required fields, additional-property rules, stop counts and transfer-only layovers. They intentionally do not validate calendar dates, zone offsets, airport existence or chronology. `validateItinerary` adds shared semantic issues to structural issues. MCP argument validation also rejects malformed tool envelopes and documents; these failures are returned as `isError` results with clear messages.

Semantic issue codes, severities and meanings are published in `capabilities.json`. Calendar errors, unsupported/missing zones, DST gaps, invalid offsets, negative flight durations and overlapping connections are errors. Ambiguous repeated hours warn and choose the earlier instant unless an offset is supplied. Short connections (<20 minutes), unusual flight durations, ignored endpoint times and layovers over seven days warn; future-rule uncertainty is informational. Issue paths refer to document stops/fields or legs. `valid` means there are no errors, not that an airline operates the route or a connection is feasible.

Limits are 10 stops, 8000 URL characters, 6000 itinerary-parameter characters, layover settings up to 10080 minutes and calendar years 1900–2100. Search returns 8 matches by default, at most 100. Timelines accept up to 1000 explicit instants or 2–1000 evenly spaced samples (default 10). A single airport has no flight timeline.

Distances use great circles on a spherical Earth, radius 6371.0088 km. Flight estimates use 850 km/h plus 30 minutes, rounded to five minutes. Distance results round to 0.1 km/mi; durations round to integer minutes. Totals are rounded from unrounded shared calculations, so rounded leg distances may differ from totals by 0.1.

Entered timepoints carry `provenance: "entered"`; propagated endpoints carry `"estimated"`; explicitly anchored undated journeys carry `"assumed"`. Legs report `durationSource`; transfers report their shared `source` (`setting` or `times`) and provenance; totals distinguish entered, estimated and mixed durations. An unanchored undated route returns null timepoints and estimated durations. A timeline requires `assumeDeparture` for such a route; the server never silently assumes “now.” Timeline instants distinguish entered requests from estimated samples and identify whether their journey anchor was entered or assumed.

Positions use the shared flight-progress model along a great circle. Altitude is illustrative. These are not live aircraft locations. Daylight uses the shared solar model, with civil twilight, at the requested position and instant. Actual routes, winds, aircraft and airline schedules are not modelled. Time conversion uses the runtime's Intl IANA database; its vintage may differ between machines, and future rules can change.

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

## Why there is no remote MCP endpoint

GitHub Pages serves static HTML, JavaScript and JSON. It cannot execute an MCP server process or handle protocol requests. The discovery files are ordinary fetchable resources; `npm run mcp` is a local stdio adapter, not a hosted endpoint.

A hosted MCP service would need a separate runtime and a Streamable HTTP transport around the same handlers/context, HTTPS, deployment and dataset-refresh operations, bounded request handling and an explicit access/rate policy. Add authentication if the hosting environment requires it. No such service is deployed by this project.

## Rebuilding and verifying discovery files

`npm run agent:build` deterministically regenerates capabilities, schema and worked examples. It uses the real datasets and `planItinerary`; it adds no generation timestamp. Example diagnostics use a fixed reference clock of 2026-01-01 so future-rule information does not drift with the day a contributor runs the command. `scripts/agent-files.test.ts` checks committed bytes, schema validity and both URL round-trips. The production build separately emits the current dataset freshness record.
