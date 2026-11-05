# Code organisation

| Path                                       | Responsibility                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `index.html`                               | Document metadata and React mount.                                         |
| `src/main.tsx`                             | React entry, fonts and global CSS.                                         |
| `src/App.tsx`                              | Data loading, route orchestration, persistence, editing and layout insets. |
| `src/types.ts`                             | Shared dependency-free domain types.                                       |
| `src/components/AirportPicker.tsx`         | Inline/mobile combobox, suggestions and keyboard interaction.              |
| `src/components/StopList.tsx`              | Stops, leg rows, insertion/removal and pointer/keyboard reordering.        |
| `src/components/Summary.tsx`               | Totals, unit controls and flight-time explanation.                         |
| `src/components/GlobeHud.tsx`              | Flight stepping and camera framing controls.                               |
| `src/components/AboutDialog.tsx`           | Method, credits and source links.                                          |
| `src/components/CodeBadge.tsx`             | IATA/ICAO badges and the no-code plane glyph.                              |
| `src/components/ErrorBoundary.tsx`         | Lazy globe failure boundary.                                               |
| `src/components/Brand.tsx`                 | Wordmark and SVG logo.                                                     |
| `src/components/Icons.tsx`                 | Small inline SVG icon set.                                                 |
| `src/components/Toast.tsx`                 | Live status messages and share fallback.                                   |
| `src/hooks/`                               | Media-query, visual-viewport and toast hooks.                              |
| `src/state/route.ts`                       | Ten-stop reducer and derived legs.                                         |
| `src/state/url.ts`                         | Tolerant route parsing, code resolution and share URLs.                    |
| `src/state/storage.ts`                     | Defensive unit and last-route persistence.                                 |
| `src/data/airports.ts`                     | Tuple validation/decoding and airport display helpers.                     |
| `src/data/search.ts`                       | Normalised prefix index, ranking and code lookup.                          |
| `src/data/rankHints.ts`                    | Documented primary-airport ranking hints.                                  |
| `src/data/generated/airports.json`         | Generated compact airport tuples and dictionaries.                         |
| `src/lib/geo.ts`                           | Spherical geometry, great circles and enclosing caps.                      |
| `src/lib/flightTime.ts`                    | Configurable estimates, duration formatting and totals.                    |
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

**Direct Three.js.** The renderer needs true spherical interpolation and render-on-demand control. The globe.gl/three-globe approach brings h3-js and unused layers, a continuous rendering model and Bezier arcs that can exaggerate height or pass through Earth near antipodes. Direct Three.js keeps these choices explicit; those alternative packages are not dependencies of this project.

**Route geometry and labels.** Unit-vector slerp determines the ground track; a sine lift illustrates the airborne arc without claiming an altitude profile. `LineMaterial` keeps screen-space line widths, with `geometry.instanceCount` revealing segments. HTML labels remain crisp and easy to position; projection hides far-side markers and tries alternate offsets to reduce collisions.

**Framing.** A deterministic enclosing spherical cap includes sampled ground tracks. The camera uses the available field of view after UI insets, label/arc margins and an overview distance limit. Routes that cannot fit show a “Step through flights” stepper instead of implying the entire route is visible. Framing views a route from slightly nearer the equator so great circles show their poleward bow rather than collapsing into a straight line. A view offset centres the scene in the unobstructed area.

**Time and distance.** Spherical Earth radius is 6,371.0088 km. Estimated minutes are distance / 850 km/h × 60 + 30, rounded to five minutes per leg; distances below 1 km have no estimate. Totals sum leg estimates and exclude layovers. Winds, aircraft, actual routing and schedules are outside the model.

**Search.** Match quality plus importance ranks suggestions. Exact ICAO/IATA, city and name prefixes, keywords and token prefixes have different weights; scheduled service, airport size and IATA presence add importance. A short primary-airport hint set breaks major-city ties; its comments explain the policy. It is not a traffic dataset or a guarantee that every city query ranks airports by passenger count.

**URLs and storage.** `?route=CPH-LHR-JFK` uses IATA, then ICAO/ident, with a numeric OurAirports ID for identifiers unsafe in the URL format. Parsing accepts several separators and caps at ten stops. Unknown codes produce a toast while valid stops survive. URL > remembered route > CPH–LHR–JFK example determines startup. Explicit `?route=` loads an empty route; canonical empty URLs omit the parameter. Route edits use `history.replaceState`; the mobile picker adds a temporary history entry so Back dismisses it. Navigation between shared URLs loads their routes. Unit and last-route keys are prefixed `globehops:`.
