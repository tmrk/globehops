# Code organisation

| Path                                       | Responsibility                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `index.html`                               | Document metadata and React mount.                                         |
| `src/main.tsx`                             | React entry, fonts and global CSS.                                         |
| `src/App.tsx`                              | Data loading, route orchestration, persistence, editing and layout insets. |
| `src/types.ts`                             | Shared dependency-free domain types.                                       |
| `src/components/AirportPicker.tsx`         | Inline/mobile combobox, suggestions and keyboard interaction.              |
| `src/components/StopList.tsx`              | Stops, leg rows, layover menus, insertion/removal and reordering.          |
| `src/components/Summary.tsx`               | Totals incl. layovers, unit controls and time explanation.                 |
| `src/components/GlobeHud.tsx`              | Flight stepping, border toggle and camera framing controls.                |
| `src/components/AboutDialog.tsx`           | Method, credits and source links.                                          |
| `src/components/CodeBadge.tsx`             | IATA/ICAO badges and the no-code plane glyph.                              |
| `src/components/ErrorBoundary.tsx`         | Lazy globe failure boundary.                                               |
| `src/components/Brand.tsx`                 | Wordmark and SVG logo.                                                     |
| `src/components/Icons.tsx`                 | Small inline SVG icon set.                                                 |
| `src/components/Toast.tsx`                 | Live status messages and share fallback.                                   |
| `src/hooks/`                               | Media-query, visual-viewport and toast hooks.                              |
| `src/state/route.ts`                       | Ten-stop reducer, per-stop layovers, derived legs and layovers.            |
| `src/state/url.ts`                         | Tolerant route/layover tokens, code resolution and share URLs.             |
| `src/state/storage.ts`                     | Defensive unit, border and last-route persistence.                         |
| `src/data/airports.ts`                     | Tuple validation/decoding and airport display helpers.                     |
| `src/data/search.ts`                       | Normalised prefix index, ranking and code lookup.                          |
| `src/data/rankHints.ts`                    | Documented primary-airport ranking hints.                                  |
| `src/data/generated/airports.json`         | Generated compact airport tuples and dictionaries.                         |
| `src/data/generated/borders.json`          | Generated delta-encoded Natural Earth land borders.                        |
| `src/lib/geo.ts`                           | Spherical geometry, great circles and enclosing caps.                      |
| `src/lib/flightTime.ts`                    | Configurable estimates, duration formatting and totals.                    |
| `src/lib/altitude.ts`                      | Climb/cruise/descent profile, arc sampling and vertical exaggeration.      |
| `src/lib/layover.ts`                       | Default layover, menu choices, validation and formatting.                  |
| `src/lib/borders.ts`                       | Border dataset decoding and lat/lng densification.                         |
| `src/lib/units.ts`                         | Distance conversion, rounding and formatting.                              |
| `src/lib/normalize.ts`                     | Shared accent/special-letter search normalisation.                         |
| `src/lib/legColors.ts`                     | Leg colour palette.                                                        |
| `src/lib/stopText.ts`                      | Stop labels, captions and placeholders.                                    |
| `src/globe/GlobeView.tsx`                  | Lazy React lifecycle, props and keyboard boundary.                         |
| `src/globe/GlobeRenderer.ts`               | Scene, camera, controls, routes, labels, textures and animation.           |
| `src/globe/math3d.ts`                      | ECEF/scene conversions and robust spherical interpolation.                 |
| `src/styles/app.css`                       | Tokens, layout, component styles and reduced-motion rules.                 |
| `src/assets/textures/`                     | Generated NASA Earth WebP textures.                                        |
| `scripts/update-airports.ts`               | Downloads, caching and validated atomic output writes.                     |
| `scripts/lib/dataset.ts`                   | Pure dataset selection, cleaning, validation and hashing.                  |
| `scripts/lib/csv.ts`                       | Strict RFC 4180 CSV parser.                                                |
| `scripts/build-borders.ts`                 | Natural Earth download/cache and validated border output writes.           |
| `scripts/lib/borders.ts`                   | Pure border extraction, quantisation, delta encoding and validation.       |
| `scripts/build-icons.ts`                   | PNG icons from SVGs and optional globe social preview capture.             |
| `public/`                                  | SVG/PNG icons, manifest and social preview.                                |
| `scripts/build-textures.ts`                | NASA JPEG resampling and WebP generation.                                  |
| `data/`                                    | Aliases, their rationale and airport build provenance.                     |
| `src/**/*.test.ts`, `scripts/*.test.ts`    | Unit tests beside production logic.                                        |
| `e2e/fixtures.ts`                          | Shared page/console error audit and route helpers.                         |
| `e2e/journey.spec.ts`, `e2e/globe.spec.ts` | Journey interactions, rendering, assets and layout tests.                  |
| `playwright.config.ts`, `vite.config.ts`   | Browser projects, Pages preview and bundling/unit-test configuration.      |
| `.github/workflows/`                       | Pages deployment and daily airport refresh.                                |

## Conventions

Strict TypeScript; pure calculations separate from React/Three.js effects. Prettier uses single quotes and a 120-column width. CSS stays in the existing token-based stylesheet. Node scripts use erasable TypeScript with `.ts` imports. See [AGENTS.md](AGENTS.md) for verification and contribution rules.

## Decisions

**Design language.** Corners come from five tokens in `app.css`: `--radius-full` for every button/control and dot, `--radius-xs` for tags, `--radius-sm` for rows, fields and options, `--radius-md` for menus and toasts, `--radius-lg` for panels and dialogs; nested corners stay concentric (sm + 10px panel padding = lg). Compact panel controls share `--control-h`, floating globe controls `--float-h` with `--surface-float`/`--shadow-float`. Don't add literal radii.

**Direct Three.js.** The renderer needs true spherical interpolation and render-on-demand control. The globe.gl/three-globe approach brings h3-js and unused layers, a continuous rendering model and Bezier arcs that can exaggerate height or pass through Earth near antipodes. Direct Three.js keeps these choices explicit; those alternative packages are not dependencies of this project.

**Route geometry and labels.** Unit-vector slerp determines the ground track. The airborne arc follows a simplified climb–cruise–descent profile with one cruising altitude for every flight; height is exaggerated 12× because true altitude is under a pixel at globe scale, while horizontal climb/descent distances stay true. `LineMaterial` keeps screen-space line widths, with `geometry.instanceCount` revealing segments. HTML labels remain crisp and easy to position; projection hides far-side markers and tries alternate offsets to reduce collisions.

**Framing.** A deterministic enclosing spherical cap includes sampled ground tracks. The camera uses the available field of view after UI insets, label/arc margins and an overview distance limit. Routes that cannot fit show a “Step through flights” stepper instead of implying the entire route is visible. Framing views a route from slightly nearer the equator so great circles show their poleward bow rather than collapsing into a straight line. A view offset centres the scene in the unobstructed area.

**Time and distance.** Spherical Earth radius is 6,371.0088 km. Estimated minutes are distance / 850 km/h × 60 + 30, rounded to five minutes per leg; distances below 1 km have no estimate. Each transfer adds a layover (default 90 minutes, changeable per stop from a menu of 30 minutes to three days; links may carry any whole minute up to a week). Totals show flying time, layover time and their sum. Winds, aircraft, actual routing and schedules are outside the model.

**Borders.** Natural Earth 1:50m land boundaries are a public-domain, de facto reference that is small enough (35 KB gzipped) to fetch lazily. They are drawn as screen-space `LineSegments2` with stencil-based single blending; coastlines come from the imagery.

**Search.** Match quality plus importance ranks suggestions. Exact ICAO/IATA, city and name prefixes, keywords and token prefixes have different weights; scheduled service, airport size and IATA presence add importance. A short primary-airport hint set breaks major-city ties; its comments explain the policy. It is not a traffic dataset or a guarantee that every city query ranks airports by passenger count.

**URLs and storage.** `?route=CPH-LHR-JFK` uses IATA, then ICAO/ident, with a numeric OurAirports ID for identifiers unsafe in the URL format. A custom layover follows its transfer airport in minutes (`LHR_180`); default layovers and layovers at the first/last stop are omitted. Tokens travel with their stop, so reversing or reordering keeps layovers with the airport, and unknown codes cannot misalign them. Parsing accepts several separators and caps at ten stops. Unknown codes produce a toast while valid stops survive. URL > remembered route > CPH–LHR–JFK example determines startup. Explicit `?route=` loads an empty route; canonical empty URLs omit the parameter. Route edits use `history.replaceState`; the mobile picker adds a temporary history entry so Back dismisses it. Navigation between shared URLs loads their routes. Unit, border and last-route keys are prefixed `globehops:`; the remembered route uses the same tokens as the URL.
