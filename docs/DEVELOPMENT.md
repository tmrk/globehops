# Development

## Setup and commands

Use Node 22.18+ (CI: Node 24). Run `npm install`, then `npm run dev` and open the printed URL under `/globehops/`. `npm run build` produces `dist/`; `npm run preview -- --port 4173 --strictPort` serves it at `http://localhost:4173/globehops/`. The stack is React 19, TypeScript, Three.js and Vite, with Vitest, Playwright, ESLint, Prettier and sharp for development.

| Command                   | Purpose                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `npm install`             | Install dependencies; use `npm ci` for the lockfile in CI.                       |
| `npm run dev`             | Start the Vite development server.                                               |
| `npm run build`           | Type-check and build `dist/`.                                                    |
| `npm run preview`         | Serve the production build.                                                      |
| `npm test`                | Run unit tests.                                                                  |
| `npm run test:e2e`        | Build and test the Pages path in all four browser projects.                      |
| `npm run lint`            | ESLint and TypeScript checks.                                                    |
| `npm run format`          | Apply Prettier formatting.                                                       |
| `npm run data:update`     | Download, validate and regenerate airport data if content changes.               |
| `npm run data:check`      | Validate a fresh download without writing files; report whether it would change. |
| `npm run labels:build`    | Build country names/label points from pinned Natural Earth countries.            |
| `npm run borders:build`   | Build the country-border dataset from the pinned Natural Earth GeoJSON.          |
| `npm run timezones:build` | Build the separate airport-to-zone table from pinned TBB boundaries.             |
| `npm run agent:build`     | Regenerate static agent capabilities, schema and worked examples.                |
| `npm run mcp`             | Run the local MCP stdio server (not an HTTP listener).                           |
| `npm run textures:build`  | Build WebP textures from a separately downloaded NASA source image.              |
| `npm run icons:build`     | Generate PNG app icons from the SVG sources in `public/`.                        |

Useful focused commands:

```sh
npm test -- src/data/search.test.ts
npm test -- src/lib/timezone.test.ts src/data/timezones.test.ts src/state/clock.test.ts
npm test -- src/lib/sun.test.ts src/globe/sunAlignment.test.ts
npm test -- src/lib/schedule.test.ts src/lib/flightProgress.test.ts src/lib/timeline.test.ts src/lib/journeyText.test.ts
npm test -- mcp/tools.test.ts mcp/server.test.ts
npm test -- scripts/timezones.test.ts scripts/agent-files.test.ts
npm run test:watch
npm run lint
npm run format:check
npx playwright install chromium webkit
npm run test:e2e -- --project=mobile-webkit
npm run test:e2e -- --grep 'autocomplete'
```

## Testing strategy

Unit tests cover pure geography, flight-time/units, route reducer, URL/storage, search/decoding and the CSV/data pipeline, time-zone conversion/coverage, solar accuracy/alignment, schedule propagation, provenance, progress, timeline and clock. MCP tests exercise schema parity, handlers and a real stdio child process. Tests use the checked-in airport dataset; ordinary builds/tests do not download source data.

Playwright builds with Vite and previews the production `/globehops/` path on port 4173. After an explicit `npm run build`, use `E2E_SKIP_BUILD=1 npm run test:e2e` to reuse build output. A running preview can be reused locally; stop stale servers when validating changed assets. CI always starts a fresh server and runs only the `@smoke` tests (`--grep @smoke`) on desktop Chromium; local `npm run test:e2e` also runs desktop/mobile WebKit. Firefox is not installed/configured here.

Fresh browser contexts isolate storage. Tests use roles/labels, auto-waiting assertions and a shared console/page-error audit. Only the test deliberately disabling WebGL allows its expected creation diagnostics. Clipboard testing is desktop Chromium only because WebKit lacks the required permission support and mobile can invoke native sharing. Chromium launches with SwiftShader flags for headless WebGL.

Rendering checks wait for `.stage.is-ready`, capture the canvas with Playwright and decode the PNG with the existing sharp dev dependency. Pixel variance plus comparison with an empty canvas reference detect missing globe output. Reading a WebGL canvas through a 2D canvas is unreliable without `preserveDrawingBuffer`.

Inspect saved `test-results/**/journey.png` and `layout-*.png` at mobile and desktop sizes; also review the picker and an edited route after UI changes. Review focus, clipping, scroll, label visibility and space left for the globe. Captures are review artifacts, not cross-platform golden snapshots. Failures retain screenshots/traces and an HTML report:

```sh
npx playwright show-report
npx playwright show-trace test-results/<test-directory>/trace.zip
```

Before finishing: lint, unit tests, build, the E2E specs the change affects (e.g. `npx playwright test e2e/time.spec.ts -g "flight times" --project=desktop-chromium --project=mobile-chromium`), screenshot review and relevant docs/`RECENT_CHANGES.md` updates. Run all four projects only for broad UI changes or on request; CI runs only the smoke tests before deploying.

## Regeneration

Airports:

```sh
npm run data:check
npm run data:update
npm run data:check -- --offline
```

The last command needs `.cache/ourairports/{airports,countries,regions}.csv`. `data:check` reports differences without writing and does not fail simply because data changed. Review changed counts, aliases and the build record, then run tests/build. Generated JSON and its build record belong together. Selection, validation and licence details are in [data sources](DATA_SOURCES.md).

Time zones:

```sh
npm run timezones:build
npm run timezones:build -- --offline
npm run timezones:build -- --refresh
```

The generator verifies the pinned TBB 2026f ZIP SHA-256, performs polygon/nearest-edge/override assignment and requires complete airport coverage, supported Node zones and passing sentinels before writing. Cache: `.cache/timezones/2026f/timezones.geojson.zip`. After airport regeneration, rebuild zones and commit `src/data/generated/timezones.json` with `data/timezones-build.json`. Never hand-edit the generated table; maintain sourced exceptions in `data/timezone-overrides.json` and [TIMEZONES.md](../data/TIMEZONES.md). The derivative database remains separate under ODbL.

Agent files: `npm run agent:build` writes `public/agent/capabilities.json`, `itinerary.schema.json` and `examples.json` from the shared contract/schema and real planning functions. Run it after contract, calculation or dataset changes; never hand-edit those JSON files. `npm test -- scripts/agent-files.test.ts` fails on byte drift and checks schema validity and URL round-trips. Example issues use a fixed reference clock for reproducibility. Vite separately serves/emits `agent/dataset.json` from current airport/time-zone metadata; no checked-in freshness file needs updating. `public/llms.txt` is maintained prose, not generator output.

Country borders: `npm run borders:build` reads `.cache/naturalearth/ne_50m_admin_0_boundary_lines_land.geojson`, downloading the pinned Natural Earth v5.1.2 file first if the cache is missing. `-- --refresh` always downloads, `-- --offline` requires the cache, and a positional path reads another GeoJSON file. The build quantises coordinates to 0.01°, delta-encodes each line, validates ranges and minimum line/point counts, then atomically writes `src/data/generated/borders.json`. To move to a newer Natural Earth release, change the pinned URL in `scripts/lib/borders.ts`, rebuild and review the line/point counts it prints.

Country names: `npm run labels:build` reads `.cache/naturalearth/ne_50m_admin_0_countries.geojson`, downloading the pinned Natural Earth v5.1.2 source if absent. `-- --offline` requires the cache, `-- --refresh` downloads again, and an optional positional path reads a local source. Extraction keeps short names, label points, minimum zooms and ranks, validates the complete dataset, then atomically writes `src/data/generated/country-labels.json`. Never hand-edit that generated file. Change the pinned URL/version in `scripts/lib/countryLabels.ts` and rebuild to update the source. Focused tests: `npm test -- scripts/countryLabels.test.ts src/lib/countryLabels.test.ts`.

Textures: download the [NASA source JPEG](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg) to `.cache/bmng/world.topo.bathy.200407.3x21600x10800.jpg` (create the directory first), then run `npm run textures:build`. An explicit input works with `npm run textures:build -- /path/to/source.jpg`. The source must be a 2:1 image; commit generated WebP outputs, never the source/cache.

Icons: `npm run icons:build` renders favicon, Apple touch, standard app and maskable PNG icons from `public/favicon.svg` and `public/logo.svg`, using installed Playwright Chromium. The UI SVGs live in `src/components/Icons.tsx` and `Brand.tsx`. To regenerate `public/og-image.png` too, first build and start preview, then run:

```sh
npm run icons:build -- --og http://localhost:4173/globehops/
```

## Local MCP development

After `npm ci` with Node 22.18+, run `npm run mcp` from the checkout, or `node /absolute/path/to/globehops/mcp/server.ts` from any directory. It reads checked-in datasets and exchanges newline-delimited JSON-RPC on stdin/stdout. Use the direct `node` command in client configuration so npm's banner cannot contaminate protocol output. Diagnostics belong on stderr. `GLOBEHOPS_BASE_URL=http://localhost:4173/globehops/` overrides generated links; it does not start a web server.

`npm test -- mcp/server.test.ts` launches a real child process from another working directory, negotiates, lists tools and calls all five. `mcp/tools.test.ts` tests validation/handlers without transport. For a manual handshake, run `node mcp/server.ts` and send these lines in order, waiting for the initialise response before the notification and requests:

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-check","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"visualize_route","arguments":{"route":"CPH-LHR_180-JFK"}}}
```

Expect server name `globehops`, five tools, and a canonical URL plus summary from the call; successful results include matching JSON text and `structuredContent`. Close stdin to stop. There is no remote MCP endpoint. [AGENT_INTEGRATION.md](AGENT_INTEGRATION.md) covers external-client configuration, tool contracts and examples.

## Debugging

- Missing assets: confirm the preview URL contains `/globehops/` and inspect network responses. `BASE_PATH=/` is an explicit build override for other hosts, not the Pages configuration.
- Blank globe: check WebGL availability, texture responses, console errors and `requestRender()` after changes. Keep Three.js resource disposal intact.
- Mobile keyboard/picker: preserve synchronous `flushSync` mounting and focus in the tap handler; inspect visual viewport bounds. Emulation does not prove real-device keyboard behaviour.
- Stale route/unit: inspect `globehops:lastJourney`, legacy `globehops:lastRoute` and `globehops:unit`. An explicit URL route overrides storage; `?route=` starts empty.
- Native Node scripts/MCP: keep `.ts` import extensions and erasable syntax throughout their import graph; avoid Vite asset imports and module-scope DOM globals. TypeScript compilation does not execute them for you.
- Time conversion: inspect the airport zone and runtime `Intl` support. Node and browsers may ship different tzdb releases; the TBB mapping does not contain offset rules.
- Playback: App must not subscribe to every frame. Derive renderer state from the single UTC clock, keep geometry precomputed and never write `t` to history during playback (Safari throttling).
