# Development

## Setup and commands

Use Node 22.18+ (CI: Node 24). Run `npm install`, then `npm run dev` and open the printed URL under `/globehops/`. `npm run build` produces `dist/`; `npm run preview -- --port 4173 --strictPort` serves it at `http://localhost:4173/globehops/`. The stack is React 19, TypeScript, Three.js and Vite, with Vitest, Playwright, ESLint, Prettier and sharp for development.

| Command                   | Purpose                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `npm install`             | Install dependencies; use `npm ci` for the lockfile in CI.                              |
| `npm run dev`             | Start the Vite development server.                                                      |
| `npm run build`           | Type-check and build `dist/`.                                                           |
| `npm run preview`         | Serve the production build.                                                             |
| `npm test`                | Run unit tests.                                                                         |
| `npm run test:e2e`        | Build and test the Pages path in all four browser projects.                             |
| `npm run lint`            | ESLint and TypeScript checks.                                                           |
| `npm run format`          | Apply Prettier formatting.                                                              |
| `npm run data:update`     | Download, validate and regenerate airport data if content changes.                      |
| `npm run data:check`      | Validate a fresh download without writing files; report whether it would change.        |
| `npm run labels:build`    | Build EN/HU/SV country/ocean/sea labels from pinned Natural Earth sources.              |
| `npm run places:build`    | Build optional Hungarian/Swedish airport-city exonyms from pinned Natural Earth places. |
| `npm run borders:build`   | Build country borders and coastlines from the pinned Natural Earth GeoJSON.             |
| `npm run airspace:build`  | Build restricted-airspace zones from `data/airspace-advisories.json` and Natural Earth. |
| `npm run timezones:build` | Build the separate airport-to-zone table from pinned TBB boundaries.                    |
| `npm run agent:build`     | Regenerate static agent capabilities, schema and worked examples.                       |
| `npm run mcp`             | Run the local MCP stdio server (not an HTTP listener).                                  |
| `npm run textures:build`  | Build day and night-light WebP textures from downloaded NASA source images.             |
| `npm run icons:build`     | Render stylised app icons, iOS splash screens and manifest screenshots.                 |

Useful focused commands:

```sh
npm test -- src/data/search.test.ts
npm test -- src/lib/timezone.test.ts src/data/timezones.test.ts src/state/clock.test.ts
npm test -- src/lib/sun.test.ts src/globe/sunAlignment.test.ts
npm test -- src/lib/schedule.test.ts src/lib/flightProgress.test.ts src/lib/timeline.test.ts src/lib/journeyText.test.ts
npm test -- src/i18n src/data/placeNames.test.ts scripts/lib/placeNames.test.ts
npm test -- src/globe/followCamera.test.ts src/agent/webTools.test.ts
npm test -- mcp/tools.test.ts mcp/server.test.ts
npm test -- scripts/timezones.test.ts scripts/agent-files.test.ts
npm run test:watch
npm run lint
npm run format:check
npx playwright install chromium webkit
npm run test:e2e -- --project=mobile-webkit
E2E_PORT=4180 npx playwright test --project=desktop-chromium -g 'autocomplete'
E2E_PORT=4180 npx playwright test --project=desktop-chromium -g @smoke
E2E_PORT=4180 npx playwright test e2e/i18n.spec.ts e2e/follow.spec.ts e2e/place-labels.spec.ts e2e/agent.spec.ts --project=desktop-chromium
```

## Testing strategy

Unit tests cover pure geography, flight-time/units, route reducer, URL/storage, search/decoding and the CSV/data pipeline, time-zone conversion/coverage, solar accuracy/alignment, schedule propagation, provenance, progress, timeline and clock. Catalogue/detection/formatter tests check all three locales and metadata; place-name tests cover decoding, conservative matching and overrides. Follow tests cover camera composition, predictive lead and smoothing across frame rates. MCP tests exercise schema parity, handlers, resources/prompts and a real stdio child process; browser command tests validate live-tool inputs. Tests use the checked-in airport dataset; ordinary builds/tests do not download source data.

Playwright builds with Vite and previews the production `/globehops/` path on port 4173 by default. Use a unique `E2E_PORT` for each concurrent worktree (this release uses 4180); the config passes it to the preview and base URL. After an explicit `npm run build`, use `E2E_SKIP_BUILD=1 npm run test:e2e` to reuse build output. A running preview can be reused locally; stop stale servers when validating changed assets. CI always starts a fresh server and runs only the `@smoke` tests (`--grep @smoke`) on desktop Chromium; local `npm run test:e2e` also runs desktop/mobile WebKit. Firefox is not installed/configured here.

Fresh browser contexts isolate storage. Playwright sets `locale: en-GB`; the shared `e2e/fixtures.ts` auto-fixture seeds `globehops:locale=en` before navigation so host time zones cannot change English assertions. Locale-detection tests use `test.use({ localeChoice: null })` to disable that seed; explicit `/hu/` or `/sv/` paths override it. Tests use roles/labels, auto-waiting assertions and a shared console/page-error audit. Only the test deliberately disabling WebGL allows its expected creation diagnostics. Clipboard testing is desktop Chromium only because WebKit lacks the required permission support and mobile can invoke native sharing. Chromium launches with SwiftShader flags for headless WebGL.

Rendering checks wait for `.stage.is-ready`, capture the canvas with Playwright and decode the PNG with the existing sharp dev dependency. Pixel variance plus comparison with an empty canvas reference detect missing globe output. Reading a WebGL canvas through a 2D canvas is unreliable without `preserveDrawingBuffer`.

Inspect saved `test-results/**/journey.png` and `layout-*.png` at mobile and desktop sizes; also review the picker and an edited route after UI changes. Review focus, clipping, scroll, label visibility and space left for the globe. Captures are review artifacts, not cross-platform golden snapshots. The existing Ireland/LHR label-overlap assertion after keyboard zoom is intermittently flaky on desktop Chromium and was reproduced before 1.8.0; record that specific failure rather than treating unrelated failures as expected. Failures retain screenshots/traces and an HTML report:

```sh
npx playwright show-report
npx playwright show-trace test-results/<test-directory>/trace.zip
```

Before finishing: lint, unit tests, build, the E2E specs the change affects (e.g. `npx playwright test e2e/time.spec.ts -g "flight times" --project=desktop-chromium --project=mobile-chromium`), screenshot review and relevant docs/`RECENT_CHANGES.md` updates. Run all four projects only for broad UI changes or on request; CI runs only the smoke tests before deploying.

## README screenshots

Use Playwright compositor screenshots from a production preview, as for the rendering checks above; do not extract the WebGL drawing buffer or alter the UI with screenshot-only CSS. The 1.8.0 captures keep the previous Copenhagen–London–New York route and paused moment, with place names off for a clear route. Desktop is 1440×900; phone uses the Pixel 7 device preset (including its device scale). After `npm run build`, start `npm run preview -- --port 4180 --strictPort` in a separate terminal, then run from the checkout:

```sh
node --input-type=module <<'JS'
import { chromium, devices, expect } from '@playwright/test';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const route = '?route=CPH-LHR-JFK&dep1=2026-11-20T08:15&arr2=2026-11-20T09:05'
  + '&dep2=2026-11-20T11:00&arr3=2026-11-20T13:50&t=2026-11-20T16:10Z'
  + '&clock=utc&names=0&follow=0';
for (const [path, device] of [
  ['docs/screenshot.png', { viewport: { width: 1440, height: 900 } }],
  ['docs/screenshot-mobile.png', devices['Pixel 7']],
]) {
  const context = await browser.newContext({
    ...device, locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce',
  });
  await context.addInitScript(() => localStorage.setItem('globehops:locale', 'en'));
  const page = await context.newPage();
  await page.goto('http://localhost:4180/globehops/' + route);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await expect(page.getByRole('application')).toHaveAttribute('data-camera-motion', 'settled');
  await expect(page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('slider'))
    .toHaveValue(String(Date.parse('2026-11-20T16:10Z')));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await context.close();
}
await browser.close();
JS
```

Inspect both PNGs before committing them. Keep additional picker, edited-route and optional place-name captures under `test-results/`, never in the commit. Local previews do not show the production-only analytics question.

## Releases and versions

Each change that reaches users is a release (see “Versioning” in [AGENTS.md](../AGENTS.md)):

```sh
npm version minor --no-git-tag-version   # or patch / major; updates package.json and package-lock.json
# add “## 1.8.0 — 2026-11-06 — Title” at the top of RECENT_CHANGES.md
npm test -- scripts/version.test.ts      # version, lockfile and changelog agree
```

Commit and push to `main`. After Deploy succeeds, the Tag release workflow creates `v<version>` on that commit if it does not exist yet. The running build shows its version in the bottom-left corner on desktop (hover for commit and date), in About (the only place on phones), and in `agent/dataset.json` (`app.version`, `app.commit`, `app.date`).

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

Country borders and coastlines: `npm run borders:build` reads `.cache/naturalearth/ne_50m_admin_0_boundary_lines_land.geojson` and `.cache/naturalearth/ne_50m_coastline.geojson`, downloading the pinned Natural Earth v5.1.2 files first if the cache is missing. `-- --refresh` always downloads, `-- --offline` requires the cache, and a positional path replaces the border source only. The build simplifies coastlines to 0.02°, quantises coordinates to 0.01°, delta-encodes each line, validates ranges and minimum line/point counts for both layers, then atomically writes `src/data/generated/borders.json` and `coastlines.json`. Never hand-edit either. To move to a newer Natural Earth release, change the pinned URL in `scripts/lib/borders.ts`, rebuild and review the line/point counts it prints.

Restricted airspace: `npm run airspace:build` validates `data/airspace-advisories.json` and builds zone outlines from the same cached Natural Earth country and marine files as the label build (`-- --offline` requires them; `-- --refresh` downloads the pinned files again), then atomically writes `src/data/generated/airspace.json`. `scripts/airspace.test.ts` fails if the generated metadata drifts from the list. Review procedure and zone table: [data/AIRSPACE.md](../data/AIRSPACE.md). Focused tests: `npm test -- scripts/airspace.test.ts src/lib/airspace.test.ts`; E2E: `e2e/airspace.spec.ts`.

Place labels: `npm run labels:build` reads `.cache/naturalearth/ne_50m_admin_0_countries.geojson` and `ne_50m_geography_marine_polys.geojson`, downloading pinned Natural Earth v5.1.2 sources if absent. `-- --offline` requires caches, `-- --refresh` downloads again, and optional positional paths replace country then marine inputs. Extraction applies `data/place-names.json` overrides, computes polygon-interior marine points, validates the complete EN/HU/SV table and atomically writes `src/data/generated/country-labels.json`. Never hand-edit it. Focused tests: `npm test -- scripts/countryLabels.test.ts src/lib/countryLabels.test.ts`.

City names: `npm run places:build` reads `.cache/naturalearth/ne_10m_populated_places.geojson` (same pinned version, cache/`--offline`/`--refresh` conventions; one optional source path). It matches the current airport dataset and applies justified `data/place-names.json` overrides before writing `src/data/generated/city-names.json`. Never hand-edit either generated place table; maintain reasons and matching/coverage notes in [PLACE_NAMES.md](../data/PLACE_NAMES.md). Rebuild city names after airport changes that affect matching. Focused tests: `npm test -- scripts/lib/placeNames.test.ts src/data/placeNames.test.ts`.

UI catalogues: add every UI key to `src/i18n/messages/{en,hu,sv}.ts`; missing keys fail compilation. Use `useI18n()` and `fmt.city()`, preserving the English shared agent outputs. Locale pages are generated by `scripts/localized-pages.ts` during build; never edit `dist/{en,hu,sv}/index.html`. Test them under `/globehops/` (or an explicit `BASE_PATH` override), including a direct reload. No translation service is contacted at runtime.

Textures: download the [NASA Blue Marble JPEG](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg) to `.cache/bmng/world.topo.bathy.200407.3x21600x10800.jpg` and the [Black Marble 2016 3 km JPEG](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg) to `.cache/blackmarble/BlackMarble_2016_3km.jpg` (create the directories first), then run `npm run textures:build`. `-- --day-only` or `-- --night-only` builds one set; explicit inputs work with `npm run textures:build -- /path/to/day.jpg /path/to/night.jpg`. Sources must be 2:1 images; a missing source is reported and the other set still builds. The night build writes single-channel light masks (`lights-2k.webp`, `lights-4k.webp`; rules in `scripts/lib/lights.ts`). Commit generated WebP outputs, never the sources/cache.

Icons: `npm run icons:build` renders Apple touch, standard app and maskable PNG icons from the NASA Earth texture with an original GRU–LHR route, using Canvas 2D in installed Playwright Chromium. It also renders portrait/landscape iOS launch screens on the app backdrop and converts `docs/screenshot{,-mobile}.png` to manifest WebP screenshots. `scripts/pwa-assets.ts` exports their shared catalogue and startup-image link tags. The favicon and logo remain the original vector artwork; this command leaves them and `favicon-32.png` unchanged. The UI SVGs live in `src/components/Icons.tsx` and `Brand.tsx`. To regenerate `public/og-image.png` too, first build and start preview, then run:

```sh
npm run icons:build -- --og http://localhost:4173/globehops/
```

Analytics: Google Analytics runs only on `tmrk.github.io` production builds after consent, so `npm run dev`, `npm run preview` and E2E runs never show the notice or contact Google. To review the notice locally, serve the production build and route `https://tmrk.github.io/globehops/**` to the preview in a Playwright script (abort `googletagmanager.com` requests so tests never reach the real property). Never pass airports, dates, times or URLs to `trackEvent`.

## Local MCP development

After `npm ci` with Node 22.18+, run `npm run mcp` from the checkout, or `node /absolute/path/to/globehops/mcp/server.ts` from any directory. It reads checked-in datasets and exchanges newline-delimited JSON-RPC on stdin/stdout. Use the direct `node` command in client configuration so npm's banner cannot contaminate protocol output. Diagnostics belong on stderr. `GLOBEHOPS_BASE_URL=http://localhost:4173/globehops/` overrides generated links; it does not start a web server.

`npm test -- mcp/server.test.ts` launches a real child process from another working directory, negotiates, lists/calls all five tools, reads four resources and retrieves the planning prompt. `mcp/tools.test.ts` tests validation/handlers without transport. For a manual handshake, run `node mcp/server.ts` and send these lines in order, waiting for the initialise response before the notification and requests:

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-check","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"visualize_route","arguments":{"route":"CPH-LHR_180-JFK"}}}
```

Expect server name `globehops`, five tools, four resources, the `plan_and_visualize` prompt, and readable/document URLs plus a human summary from the visualisation call; successful results include matching JSON text and `structuredContent`. Close stdin to stop. There is no remote MCP endpoint. [AGENT_INTEGRATION.md](AGENT_INTEGRATION.md) covers external-client configuration, tool contracts and examples.

`e2e/agent.spec.ts` mocks modern and legacy experimental WebMCP APIs in a production browser, checking registration, cleanup, validation and live commands. These mocks do not establish compatibility with every browser implementation. No WebMCP polyfill or hosted endpoint is installed. Link/tool overrides must stay temporary; explicit UI choices may persist.

## Debugging

- Missing assets: confirm the preview URL contains `/globehops/` and inspect network responses. `BASE_PATH=/` is an explicit build override for other hosts, not the Pages configuration.
- Blank globe: check WebGL availability, texture responses, console errors and `requestRender()` after changes. Keep Three.js resource disposal intact.
- Mobile keyboard/picker: preserve synchronous `flushSync` mounting and focus in the tap handler; inspect visual viewport bounds. Emulation does not prove real-device keyboard behaviour.
- Stale route/unit: inspect `globehops:lastJourney`, legacy `globehops:lastRoute` and `globehops:unit`. An explicit URL route overrides storage; `?route=` starts empty.
- Native Node scripts/MCP: keep `.ts` import extensions and erasable syntax throughout their import graph; avoid Vite asset imports and module-scope DOM globals. TypeScript compilation does not execute them for you.
- Time conversion: inspect the airport zone and runtime `Intl` support. Node and browsers may ship different tzdb releases; the TBB mapping does not contain offset rules.
- Language: inspect the explicit locale path and `globehops:locale` before browser settings; the Budapest/Stockholm time-zone proxy precedes browser languages. English should not request city-names; failed optional exonym loading must retain usable original names.
- Aircraft follow: keep camera north-up and the OrbitControls target at the origin; inspect feed velocity and manual-input exits separately from automatic leg framing. Reduced motion should re-centre only as needed.
- Solar shading: change CPU stops and generated GLSL together in `sun.ts`, shared by Earth and atmosphere; do not duplicate thresholds in renderer code.
- Playback: App must not subscribe to every frame. Derive renderer state from the single UTC clock, keep geometry precomputed and never write `t` to history during playback (Safari throttling).

## Testing the offline PWA

The worker and registration run only in production builds. Use `npm run build`, then `npx vite preview --port 4191` and open `http://localhost:4191/globehops/`. In browser developer tools, wait for the worker to control the page, inspect Cache Storage and verify the initial `?__rev=` requests. Disable the network, reload, open a route query and `/globehops/hu/`, and search for an airport. Lazy locales, city names, data, fonts and globe textures must all work offline. Dev-server modules are never cached by this implementation. Clear/unregister a previously installed production worker when switching that origin to a dev server.

Playwright's shared configuration blocks service workers so existing tests cannot acquire control mid-test. `e2e/pwa.spec.ts` opts in with `test.use({ serviceWorkers: 'allow' })` and uses the shared console audit. Chromium may bypass `context.route` for worker main-script update checks; in that case the update interception test explicitly skips with an annotation, and injected updater unit tests cover that lifecycle. Run a prebuilt preview with `E2E_PORT=4181 E2E_SKIP_BUILD=1 npx playwright test e2e/pwa.spec.ts --project=desktop-chromium`.

`src/pwa/swRouting.ts` has no browser-specific types; `tsconfig.sw.json` checks worker code against WebWorker rather than DOM globals. `scripts/pwa.test.ts` checks manifest assembly, byte revisions, head insertion and install metadata without depending on generated promotional images. Gesture suppression must never stop event propagation: verify globe wheel/pinch/button zoom and follow exit whenever changing it.
