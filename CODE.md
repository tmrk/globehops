# Code organisation

| Path                                                                  | Responsibility                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `index.html`                                                          | Document metadata and React mount.                                                                    |
| `src/main.tsx`                                                        | React entry, fonts and global CSS.                                                                    |
| `src/analytics.ts`, `src/hooks/useAnalyticsConsent.ts`                | Consent-gated GA4 loader/events, native History URL writes and the remembered decision.               |
| `src/App.tsx`                                                         | Airport/zone loading, route/journey/timeline orchestration, clock, persistence and layout insets.     |
| `src/components/LegSchedule.tsx`                                      | Leg-local date/time editor and schedule issues.                                                       |
| `src/components/DateTimeField.tsx`                                    | Native date/time input under a formatted face; estimates shown as suggestions.                        |
| `src/hooks/useBottomSheet.ts`, `src/lib/sheet.ts`                     | Mobile sheet drag-to-dismiss gesture and its tested release decision.                                 |
| `src/components/TimeBar.tsx`                                          | Clock, timeline, scrubbing and playback controls; floats on wide screens, docks in the phone sheet.   |
| `src/hooks/useClock.ts`                                               | External-store clock subscription and phase-only App subscription.                                    |
| `src/types.ts`                                                        | Shared dependency-free domain types.                                                                  |
| `src/components/AirportPicker.tsx`                                    | Inline/mobile combobox, suggestions and keyboard interaction.                                         |
| `src/components/StopList.tsx`                                         | Itinerary grid: stops, flights, layovers, route line; edit mode for insert/remove/reorder/reverse.    |
| `src/components/Summary.tsx`                                          | Justified totals (distance/flights, time/breakdown, dates), the Play action and the time explanation. |
| `src/components/GlobeHud.tsx`                                         | Flight stepper over the globe for wide routes and selected flights.                                   |
| `src/components/MapTools.tsx`                                         | Top-right display menu (borders, names, day/night, units, globe clock) and re-centre.                 |
| `src/components/AboutDialog.tsx`                                      | Method, credits, source links and the privacy/usage-statistics switch.                                |
| `src/components/CodeBadge.tsx`                                        | IATA/ICAO badges and the no-code plane glyph.                                                         |
| `src/components/ErrorBoundary.tsx`                                    | Lazy globe failure boundary.                                                                          |
| `src/components/Brand.tsx`                                            | Wordmark and SVG logo.                                                                                |
| `src/components/Icons.tsx`                                            | Small inline SVG icon set.                                                                            |
| `src/components/Toast.tsx`                                            | Live status messages and share fallback.                                                              |
| `src/components/ConsentNotice.tsx`                                    | One-time, non-blocking Google Analytics consent question.                                             |
| `src/hooks/`                                                          | Media-query, visual-viewport and toast hooks.                                                         |
| `src/state/route.ts`                                                  | Ten-stop reducer, stop-based local times/layovers and legacy derived geometry.                        |
| `src/state/clock.ts`                                                  | UTC simulation clock, live time and playback rates.                                                   |
| `src/state/link.ts`                                                   | Readable schedule/view links and itinerary-parameter parsing.                                         |
| `src/state/simulation.ts`                                             | Imperative clock-to-renderer feed derived from journey state and sun.                                 |
| `src/state/url.ts`                                                    | Tolerant route/layover tokens, code resolution and share URLs.                                        |
| `src/state/storage.ts`                                                | Defensive preferences and remembered journey, with legacy route fallback.                             |
| `src/data/airports.ts`                                                | Tuple validation/decoding and airport display helpers.                                                |
| `src/data/search.ts`                                                  | Normalised prefix index, ranking and code lookup.                                                     |
| `src/data/timezones.ts`                                               | Validates/loads the separate airport-ID → IANA-zone table.                                            |
| `src/data/generated/timezones.json`                                   | Generated ODbL derivative database, separate from airports.                                           |
| `src/data/rankHints.ts`                                               | Documented primary-airport ranking hints.                                                             |
| `src/data/generated/airports.json`                                    | Generated compact airport tuples and dictionaries.                                                    |
| `src/data/generated/country-labels.json`                              | Generated Natural Earth country names, label points, minimum zooms and ranks.                         |
| `src/data/generated/borders.json`                                     | Generated delta-encoded Natural Earth land borders.                                                   |
| `src/data/generated/coastlines.json`                                  | Generated, simplified, delta-encoded Natural Earth coastlines (same format).                          |
| `src/lib/timezone.ts`                                                 | Cached Intl conversion, wall-time resolution, offsets and formatting.                                 |
| `src/lib/sun.ts`                                                      | NOAA/Meeus subsolar point, geometric elevation and daylight classes.                                  |
| `src/lib/schedule.ts`                                                 | Journey model, propagation, provenance, totals and semantic issues.                                   |
| `src/lib/flightProgress.ts`                                           | Monotonic elapsed-time → great-circle distance progress.                                              |
| `src/lib/timeline.ts`                                                 | Absolute UTC flight/ground segments and state at an instant.                                          |
| `src/lib/journeyText.ts`                                              | Shared status text, leg time labels and clock-zone options.                                           |
| `src/agent/contract.ts`                                               | Single source for contract version, link vocabulary, limits and speeds.                               |
| `src/agent/itinerary.ts`                                              | Itinerary v1 types, structural validation, base64url and link conversion.                             |
| `src/agent/schema.ts`                                                 | Published JSON Schema derived from shared syntax and limits.                                          |
| `src/agent/plan.ts`                                                   | Shared airport search, planning, validation and timeline sampling for agents.                         |
| `mcp/server.ts`, `mcp/data.ts`                                        | Local stdio entry and module-relative dataset/context loading.                                        |
| `mcp/tools.ts`                                                        | Five bounded MCP tools, schemas and structured results.                                               |
| `mcp/document-corpus.ts`                                              | Shared document cases for schema/runtime/MCP parity tests.                                            |
| `mcp/*.test.ts`                                                       | Tool validation and real stdio handshake/integration tests.                                           |
| `src/lib/geo.ts`                                                      | Spherical geometry, great circles and enclosing caps.                                                 |
| `src/lib/flightTime.ts`                                               | Configurable estimates, duration formatting and totals.                                               |
| `src/lib/altitude.ts`                                                 | Climb/cruise/descent profile, arc sampling and vertical exaggeration.                                 |
| `src/lib/layover.ts`                                                  | Default layover, menu choices, validation and formatting.                                             |
| `src/lib/countryLabels.ts`, `src/lib/countryLabels.test.ts`           | Strict label decoding, map zoom/style calibration and collision placement with unit tests.            |
| `src/lib/borders.ts`                                                  | Border/coastline dataset decoding and lat/lng densification.                                          |
| `src/lib/analytics.ts`                                                | Analytics rules: host/GPC/DNT gate, consent parsing, query-free page address.                         |
| `src/lib/units.ts`                                                    | Distance conversion, rounding and formatting.                                                         |
| `src/lib/normalize.ts`                                                | Shared accent/special-letter search normalisation.                                                    |
| `src/lib/legColors.ts`                                                | Leg colour palette.                                                                                   |
| `src/lib/stopText.ts`                                                 | Stop labels, captions and placeholders.                                                               |
| `src/globe/GlobeView.tsx`                                             | Lazy React lifecycle, props and keyboard boundary.                                                    |
| `src/globe/countryLabels.ts`                                          | Lazy country-name DOM layer, projection, cached measurement and airport-aware placement.              |
| `src/globe/GlobeRenderer.ts`                                          | Scene, camera, controls, routes, labels, textures and animation.                                      |
| `src/globe/simFeed.ts`                                                | Renderer-neutral feed and air/ground aircraft frame types.                                            |
| `src/globe/sunAlignment.test.ts`                                      | Independent astronomical check of Earth-fixed scene alignment.                                        |
| `src/globe/math3d.ts`                                                 | ECEF/scene conversions and robust spherical interpolation.                                            |
| `src/styles/app.css`                                                  | Tokens, layout, component styles and reduced-motion rules.                                            |
| `src/assets/textures/`                                                | Generated NASA Earth WebP textures and Black Marble night-light masks.                                |
| `scripts/update-airports.ts`                                          | Downloads, caching and validated atomic output writes.                                                |
| `scripts/lib/dataset.ts`                                              | Pure dataset selection, cleaning, validation and hashing.                                             |
| `scripts/lib/csv.ts`                                                  | Strict RFC 4180 CSV parser.                                                                           |
| `scripts/build-country-labels.ts`                                     | Pinned country GeoJSON download/cache and validated atomic label writes.                              |
| `scripts/lib/countryLabels.ts`, `scripts/countryLabels.test.ts`       | Pure country label extraction/validation and synthetic/cache-backed tests.                            |
| `scripts/build-borders.ts`                                            | Natural Earth download/cache and validated border output writes.                                      |
| `scripts/lib/borders.ts`                                              | Pure border/coastline extraction, simplification, quantisation, encoding and validation.              |
| `scripts/lib/lights.ts`                                               | Pure Black Marble → night-light mask conversion.                                                      |
| `scripts/build-timezones.ts`                                          | Pinned ZIP download/cache, validation and atomic table/build-record writes.                           |
| `scripts/lib/timezones.ts`, `scripts/lib/zip.ts`                      | Polygon lookup/fallbacks/coverage and bounded ZIP extraction.                                         |
| `scripts/build-agent-files.ts`                                        | Deterministic capabilities, itinerary schema and worked examples.                                     |
| `scripts/agent-files.test.ts`                                         | Rejects discovery drift; checks schema and both link round-trips.                                     |
| `public/llms.txt`                                                     | External-agent discovery and links to the contract.                                                   |
| `public/agent/{capabilities,itinerary.schema,examples}.json`          | Generated static contract, schema and computed examples.                                              |
| `vite.config.ts`                                                      | Vite/Vitest configuration; emits/serves `agent/dataset.json` freshness metadata.                      |
| `data/{timezones-build,timezone-overrides}.json`, `data/TIMEZONES.md` | Zone provenance, exception report, sourced overrides and ODbL terms.                                  |
| `scripts/build-icons.ts`                                              | PNG icons from SVGs and optional globe social preview capture.                                        |
| `public/`                                                             | SVG/PNG icons, manifest and social preview.                                                           |
| `scripts/build-textures.ts`                                           | NASA day/night JPEG resampling, light-mask extraction and WebP generation.                            |
| `data/`                                                               | Aliases, their rationale and airport build provenance.                                                |
| `src/**/*.test.ts`, `scripts/*.test.ts`                               | Unit tests beside production logic.                                                                   |
| `e2e/fixtures.ts`                                                     | Shared page/console error audit and route helpers.                                                    |
| `e2e/journey.spec.ts`, `e2e/globe.spec.ts`, `e2e/time.spec.ts`        | Journey editing, schedules, playback, daylight, rendering, assets and layout tests.                   |
| `playwright.config.ts`                                                | Browser projects and Pages preview configuration.                                                     |
| `.github/workflows/`                                                  | Pages deployment and daily airport/time-zone refresh.                                                 |

## Conventions

Strict TypeScript; pure calculations separate from React/Three.js effects. Prettier uses single quotes and a 120-column width. CSS stays in the existing token-based stylesheet. Node scripts, the local MCP adapter and all modules they import use erasable TypeScript with `.ts` imports; keep Vite asset imports and module-scope DOM effects out of shared modules. See [AGENTS.md](AGENTS.md) for verification and contribution rules.

## Decisions

**Design language.** Corners come from five tokens in `app.css`: `--radius-full` for every button/control and dot, `--radius-xs` for tags, `--radius-sm` for rows, fields and options, `--radius-md` for menus and toasts, `--radius-lg` for panels and dialogs; nested corners stay concentric (sm + 10px panel padding = lg). Compact panel controls share `--control-h`, floating globe controls `--float-h` with `--surface-float`/`--shadow-float` (`.float-btn`, or `.float-group` for a capsule of buttons). Don't add literal radii.

**Layout and alignment.** Every itinerary row (stop, flight, layover, action) is the same four-column grid: route line (`--col-rail`), airport code (`--col-code`), text, trailing tools, separated by `--col-gap` inside `--pad`. Small icons sit centred in the code column, so codes, icons, names and figures each form one vertical line. Each row draws its own half of the route line (`Rail`), so the line never breaks around editors. Hover and selection backgrounds extend 8px beyond the columns without moving content. Everyday rows carry no management icons: Edit mode reveals reorder, remove and insert, plus Reverse and Clear. The panel has one primary action (amber Play beside the totals); map settings live in one display menu; on phones the timeline docks into the sheet instead of floating as a second card. Airport codes are split-flap tiles, the clearest nod to a departure board.

**Typography.** Two OFL families with distinct jobs, set up as tokens in `app.css`. Barlow, a grotesque drawn from public signage, sets the interface; Martian Mono, narrowed to 78 % of its width (`--mono-stretch`, re-applied after every mono `font` shorthand, which resets it), sets what a departure board would show: airport codes, clock times, dates, distances and totals. Sizes come only from the `--text-*` scale; caps labels use `--track-caps`, codes `--track-code`; mono runs tighten word spacing (`--mono-space`) so “979 km” doesn't gap. The mark is a globe with one great-circle hop using the globe's own origin/destination markers (`public/logo.svg`, a bolder `favicon.svg`, `Brand.tsx`).

**Direct Three.js.** The renderer needs true spherical interpolation and render-on-demand control. The globe.gl/three-globe approach brings h3-js and unused layers, a continuous rendering model and Bezier arcs that can exaggerate height or pass through Earth near antipodes. Direct Three.js keeps these choices explicit; those alternative packages are not dependencies of this project.

**Route geometry and labels.** Unit-vector slerp determines the ground track. The airborne arc follows a simplified climb–cruise–descent profile with one cruising altitude for every flight; height is exaggerated 12× because true altitude is under a pixel at globe scale, while horizontal climb/descent distances stay true. `LineMaterial` keeps screen-space line widths, with `geometry.instanceCount` revealing segments and the last visible segment shortened to the exact progress. Translucent lines use one stencil value each so overlapping segment joints never bead; there is no dashed ground track. HTML labels remain crisp and easy to position; projection hides far-side markers and tries alternate offsets to reduce collisions.

**Framing.** A deterministic enclosing spherical cap includes sampled ground tracks. The camera uses the available field of view after UI insets, label/arc margins and an overview distance limit. Routes that cannot fit show a “Step through flights” stepper instead of implying the entire route is visible. Framing views a route from slightly nearer the equator so great circles show their poleward bow rather than collapsing into a straight line. A view offset centres the scene in the unobstructed area.

**Time and distance.** Spherical Earth radius is 6,371.0088 km. Estimated minutes are distance / 850 km/h × 60 + 30, rounded to five minutes per leg; distances below 1 km have no estimate. Each transfer adds a layover (default 90 minutes, changeable per stop from a menu of 30 minutes to three days; links may carry any whole minute up to a week). Totals show flying time, layover time and their sum. Winds, aircraft, actual routing and schedules are outside the model.

**Borders.** Natural Earth 1:50m land boundaries are a public-domain, de facto reference that is small enough (35 KB gzipped) to fetch lazily. They are drawn as screen-space `LineSegments2` with stencil-based single blending; coastlines come from the imagery.

**Search.** Match quality plus importance ranks suggestions. Exact ICAO/IATA, city and name prefixes, keywords and token prefixes have different weights; scheduled service, airport size and IATA presence add importance. A short primary-airport hint set breaks major-city ties; its comments explain the policy. It is not a traffic dataset or a guarantee that every city query ranks airports by passenger count.

**URLs and storage.** `?route=CPH-LHR-JFK` uses IATA, then ICAO/ident, with a numeric OurAirports ID for identifiers unsafe in the URL format. A custom layover follows its transfer airport in minutes (`LHR_180`); default layovers and layovers at the first/last stop are omitted. Tokens travel with their stop, so reversing or reordering keeps layovers with the airport, and unknown codes cannot misalign them. Parsing accepts several separators and caps at ten stops. Unknown codes produce a toast while valid stops survive. URL > remembered route > CPH–LHR–JFK example determines startup. Explicit `?route=` loads an empty route; canonical empty URLs omit the parameter. Route edits use `history.replaceState`; the mobile picker adds a temporary history entry so Back dismisses it. Navigation between shared URLs loads their routes. Preferences and remembered journey keys are prefixed `globehops:`; `lastJourney` stores a canonical query without `t`, `play` or `units`, with `lastRoute` as a legacy fallback.

**Time zones.** Build-time point-in-polygon lookup against pinned timezone-boundary-builder data produces a small airport-to-IANA table. Runtime `Intl.DateTimeFormat` supplies historical offsets and DST rules; there is no Temporal polyfill or shipped polygon database. Formatter caching keeps repeated conversion cheap. Runtime tzdb versions may differ; mapping a zone does not freeze its rules. The ODbL table remains separate from public-domain airport data.

**Schedule storage and propagation.** Facts belong to stops: each arrival, departure and fallback layover has one home, while the editor presents a flight's departure and arrival together. Insertion/reordering carries times with stops; reversing clears times. `computeJourney` preserves resolved entered anchors, propagates forward with flight estimates and layovers, then fills unknowns backwards. An explicit assumed start can anchor an undated journey. Derived points carry `estimated` or `assumed` provenance; independently anchored endpoints can produce `mixed` durations. Chronology errors prevent playback. See [time and simulation](docs/TIME_AND_SIMULATION.md) for rules and issue codes.

**Flight progress.** Elapsed time maps piecewise linearly to climb, cruise and descent distance using the altitude model's average speeds. Short flights scale climb/descent to fit; longer flights reserve at least 20% of duration for cruise if those phases need compression. Great-circle distance progress is monotonic. The entire departure-to-arrival interval is treated as flight, without separate taxi phases; altitude and track are illustrative.

**Solar model and alignment.** NOAA/Meeus equations compute declination and equation of time from UTC, giving an Earth-fixed subsolar point. `sunDirectionScene` uses the same Y-north, +X-Greenwich, −Z-east conversion as airport markers and the texture. Independent astronomy-engine tests check geographic solar position and scene dot products; astronomy-engine is absent from production calculations.

**Day/night shading.** Existing Lambert Earth shading is extended through `onBeforeCompile` with shared sun-direction and blend uniforms. A smooth surface-normal dot-product transition darkens/cools the night, adds restrained twilight and dims the atmospheric rim. There is no second texture or rebuilt terminator mesh. Null illumination restores camera-relative lighting; toggling blends over 360 ms unless reduced motion is active.

**Links and itinerary documents.** Share-link v1 extends legacy route tokens with airport-local `depN`/`arrN` and UTC view time, speed, clock, units and shading. A v1 itinerary document offers a strict JSON representation, encoded as base64url in `itinerary`; a valid document takes precedence over readable parameters. Structural checks are separate from airport/time/chronology validation. Preserve existing links when adding fields; incompatible document changes need a new version. App debounces paused `t` updates and never writes playback frames to history (Safari throttles `replaceState`).

**Shared agent contract.** `src/agent/contract.ts`, itinerary syntax and `schema.ts` supply the vocabulary and schema consumed by links, discovery and MCP. `plan.ts` reuses the browser's decoding, search, schedule, timeline and sun modules. Generate `public/agent/*.json` with `agent:build`; drift is a test failure. Vite emits current freshness metadata separately as `agent/dataset.json`.

**Local MCP only.** `mcp/` loads checked-in datasets and exposes five tools over stdio, using the same planning functions. Its SDK and Zod dependencies are tooling dependencies outside the web bundle. GitHub Pages hosts static discovery files, not a server endpoint. [Agent integration](docs/AGENT_INTEGRATION.md) is the external consumer guide.
