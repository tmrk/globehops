# Development

## Setup and commands

Use Node 22.18+ (CI: Node 24). Run `npm install`, then `npm run dev` and open the printed URL under `/globehops/`. `npm run build` produces `dist/`; `npm run preview -- --port 4173 --strictPort` serves it at `http://localhost:4173/globehops/`. The stack is React 19, TypeScript, Three.js and Vite, with Vitest, Playwright, ESLint, Prettier and sharp for development.

| Command                  | Purpose                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `npm install`            | Install dependencies; use `npm ci` for the lockfile in CI.                       |
| `npm run dev`            | Start the Vite development server.                                               |
| `npm run build`          | Type-check and build `dist/`.                                                    |
| `npm run preview`        | Serve the production build.                                                      |
| `npm test`               | Run unit tests.                                                                  |
| `npm run test:e2e`       | Build and test the Pages path in all four browser projects.                      |
| `npm run lint`           | ESLint and TypeScript checks.                                                    |
| `npm run format`         | Apply Prettier formatting.                                                       |
| `npm run data:update`    | Download, validate and regenerate airport data if content changes.               |
| `npm run data:check`     | Validate a fresh download without writing files; report whether it would change. |
| `npm run borders:build`  | Build the country-border dataset from the pinned Natural Earth GeoJSON.          |
| `npm run textures:build` | Build WebP textures from a separately downloaded NASA source image.              |
| `npm run icons:build`    | Generate PNG app icons from the SVG sources in `public/`.                        |

Useful focused commands:

```sh
npm test -- src/data/search.test.ts
npm run test:watch
npm run lint
npm run format:check
npx playwright install chromium webkit
npm run test:e2e -- --project=mobile-webkit
npm run test:e2e -- --grep 'autocomplete'
```

## Testing strategy

Unit tests cover pure geography, flight-time/units, route reducer, URL/storage, search/decoding and the CSV/data pipeline. Tests use the checked-in airport dataset; ordinary builds/tests do not download source data.

Playwright builds with Vite and previews the production `/globehops/` path on port 4173. After an explicit `npm run build`, use `E2E_SKIP_BUILD=1 npm run test:e2e` to reuse build output. A running preview can be reused locally; stop stale servers when validating changed assets. CI always starts a fresh server and tests desktop/mobile Chromium; local `npm run test:e2e` also runs desktop/mobile WebKit. Firefox is not installed/configured here.

Fresh browser contexts isolate storage. Tests use roles/labels, auto-waiting assertions and a shared console/page-error audit. Only the test deliberately disabling WebGL allows its expected creation diagnostics. Clipboard testing is desktop Chromium only because WebKit lacks the required permission support and mobile can invoke native sharing. Chromium launches with SwiftShader flags for headless WebGL.

Rendering checks wait for `.stage.is-ready`, capture the canvas with Playwright and decode the PNG with the existing sharp dev dependency. Pixel variance plus comparison with an empty canvas reference detect missing globe output. Reading a WebGL canvas through a 2D canvas is unreliable without `preserveDrawingBuffer`.

Inspect saved `test-results/**/journey.png` and `layout-*.png` at mobile and desktop sizes; also review the picker and an edited route after UI changes. Review focus, clipping, scroll, label visibility and space left for the globe. Captures are review artifacts, not cross-platform golden snapshots. Failures retain screenshots/traces and an HTML report:

```sh
npx playwright show-report
npx playwright show-trace test-results/<test-directory>/trace.zip
```

Before finishing: lint, unit tests, build, all four E2E projects, screenshot review and relevant docs/`RECENT_CHANGES.md` updates.

## Regeneration

Airports:

```sh
npm run data:check
npm run data:update
npm run data:check -- --offline
```

The last command needs `.cache/ourairports/{airports,countries,regions}.csv`. `data:check` reports differences without writing and does not fail simply because data changed. Review changed counts, aliases and the build record, then run tests/build. Generated JSON and its build record belong together. Selection, validation and licence details are in [data sources](DATA_SOURCES.md).

Country borders: `npm run borders:build` reads `.cache/naturalearth/ne_50m_admin_0_boundary_lines_land.geojson`, downloading the pinned Natural Earth v5.1.2 file first if the cache is missing. `-- --refresh` always downloads, `-- --offline` requires the cache, and a positional path reads another GeoJSON file. The build quantises coordinates to 0.01°, delta-encodes each line, validates ranges and minimum line/point counts, then atomically writes `src/data/generated/borders.json`. To move to a newer Natural Earth release, change the pinned URL in `scripts/lib/borders.ts`, rebuild and review the line/point counts it prints.

Textures: download the [NASA source JPEG](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg) to `.cache/bmng/world.topo.bathy.200407.3x21600x10800.jpg` (create the directory first), then run `npm run textures:build`. An explicit input works with `npm run textures:build -- /path/to/source.jpg`. The source must be a 2:1 image; commit generated WebP outputs, never the source/cache.

Icons: `npm run icons:build` renders favicon, Apple touch, standard app and maskable PNG icons from `public/favicon.svg` and `public/logo.svg`, using installed Playwright Chromium. The UI SVGs live in `src/components/Icons.tsx` and `Brand.tsx`. To regenerate `public/og-image.png` too, first build and start preview, then run:

```sh
npm run icons:build -- --og http://localhost:4173/globehops/
```

## Debugging

- Missing assets: confirm the preview URL contains `/globehops/` and inspect network responses. `BASE_PATH=/` is an explicit build override for other hosts, not the Pages configuration.
- Blank globe: check WebGL availability, texture responses, console errors and `requestRender()` after changes. Keep Three.js resource disposal intact.
- Mobile keyboard/picker: preserve synchronous `flushSync` mounting and focus in the tap handler; inspect visual viewport bounds. Emulation does not prove real-device keyboard behaviour.
- Stale route/unit: inspect `globehops:lastRoute` and `globehops:unit`. An explicit URL route overrides storage; `?route=` starts empty.
- Native Node scripts: keep `.ts` import extensions and erasable syntax; TypeScript compilation does not execute them for you.
