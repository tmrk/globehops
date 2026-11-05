# Working on GlobeHops

## Architecture and entry points

Read `src/App.tsx` first: it loads airports and time zones, builds search, initialises the route and orchestrates journey, timeline, clock, persistence and components. `src/main.tsx` loads fonts/CSS and mounts React. `src/components/` owns accessible UI; `src/hooks/` handles browser media, viewport, toast and narrow clock subscriptions.

Pure logic lives in `src/lib/` (geography, time-zone conversion, solar position, schedule propagation, flight progress, timeline and journey text), `src/state/` (route transitions, simulation clock/feed, links and safe storage), `src/data/` (dataset decoding, airport-to-zone lookup and search) and `src/agent/` (shared contract, itinerary schema/validation and planning). `mcp/` is the local stdio adapter over those same modules, not another calculation engine.

`src/globe/GlobeView.tsx` is the lazy React boundary for `GlobeRenderer.ts`. Keep imperative Three.js work in `src/globe/`. See [CODE.md](CODE.md), [architecture](docs/ARCHITECTURE.md) and [time and simulation](docs/TIME_AND_SIMULATION.md).

[docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) is for **external agents using GlobeHops** to construct links or call tools. It is not contributor guidance; agents working on this codebase should follow this file.

## Conventions and priorities

- TypeScript strict mode; avoid `any`. Prettier: 120 columns, single quotes, trailing commas.
- Keep pure logic in `src/lib/`, `src/state/`, `src/data/` and `src/agent/`, with meaningful unit tests next to it.
- Put CSS in `src/styles/app.css`; use its existing tokens and responsive layout conventions. Corners use only the `--radius-*` role tokens (see [CODE.md](CODE.md) “Design language”); never add literal radii.
- Prioritise simplicity, mobile usability, a prominent globe, restrained motion and accessibility. Use semantic roles, labels and keyboard controls.
- Preserve reduced-motion behaviour, touch targets, focus and useful route editing without WebGL.
- No proprietary maps, tiles, APIs, API keys, backends or analytics. Every asset must be openly licensed and documented in `docs/DATA_SOURCES.md` and `THIRD_PARTY_NOTICES.md`.

## Commands and verification

Use Node 22.18+; CI uses Node 24. Run `npm install` locally or `npm ci` for a clean lockfile install. `npm run dev` serves development; `npm run build` type-checks and builds; `npm run preview` serves `dist/`. `npm run timezones:build` regenerates airport time zones, `npm run agent:build` regenerates agent discovery JSON, and `npm run mcp` starts the local stdio server.

Run `npm run lint`, `npm test`, `npm run build`, then `npm run test:e2e`. Install browsers with `npx playwright install chromium webkit`. The suite has desktop/mobile Chromium and WebKit projects; CI runs Chromium only. Firefox is not configured. Use `npm run format` for formatting. See [development](docs/DEVELOPMENT.md) for focused test commands and screenshot review.

Review screenshots at mobile and desktop sizes, including a picker and an edited route. The E2E rendering/layout checks save captures under `test-results/`; inspect them as well as assertions. Prefer accessible selectors and web-first assertions; avoid sleeps. Every E2E test uses the shared console/page error audit.

## Assets, data and deployment

`npm run data:update` downloads and validates OurAirports before generating `src/data/generated/airports.json` and `data/airports-build.json`. `npm run data:check` validates without writes and reports changes; it does not fail solely because data changed. Offline validation: `npm run data:check -- --offline` requires cached CSVs. Keep aliases small, correct and justified in `data/ALIASES.md`; primary-airport ranking hints belong in `src/data/rankHints.ts` with rationale. Never hand-edit generated airport tuples. See [sources](docs/DATA_SOURCES.md).

`npm run borders:build` regenerates `src/data/generated/borders.json` from the pinned Natural Earth v5.1.2 GeoJSON (cached in `.cache/naturalearth/`; `--offline` and `--refresh` available). Never hand-edit it.

`npm run labels:build` regenerates `src/data/generated/country-labels.json` from pinned Natural Earth v5.1.2 Admin 0 countries (cached at `.cache/naturalearth/ne_50m_admin_0_countries.geojson`; `--offline`, `--refresh` and an optional source path are available). Never hand-edit the generated labels.

`npm run timezones:build` uses the SHA-256-pinned TBB 2026f ZIP in `.cache/timezones/2026f/` (downloads if absent; `--offline` and `--refresh` available). Never hand-edit `src/data/generated/timezones.json`; commit it with `data/timezones-build.json`. Keep this ODbL derivative database separate from public-domain `airports.json`. Source updates and justified overrides are documented in `data/TIMEZONES.md`.

Never hand-edit generated `public/agent/*.json`: run `npm run agent:build` after contract, calculation or dataset changes. `scripts/agent-files.test.ts` fails on drift. `agent/dataset.json` is emitted separately by Vite from current build metadata; it is not a checked-in file.

`npm run textures:build` requires the NASA source JPEG in `.cache/bmng/` or a source path argument. `npm run icons:build` generates PNG app icons from `public/logo.svg` and `public/favicon.svg` using Playwright Chromium; add `-- --og http://localhost:4173/globehops/` to capture the social preview from a running build.

`.github/workflows/deploy.yml` publishes Pages after checks. `update-airports.yml` refreshes daily at 04:23 UTC, rebuilds time zones when airports change, pushes validated changes or opens a PR, then calls Deploy for successful direct pushes. `GITHUB_TOKEN` pushes do not trigger push workflows; keep the reusable workflow call. See [deployment](docs/DEPLOYMENT.md).

## Common pitfalls

- Production base is `/globehops/`; use imported asset URLs and test the production build at that path. `BASE_PATH` can override the Vite base for another host.
- Node runs `.ts` scripts and `mcp/` natively. All modules they import must use erasable TypeScript (no enums, namespaces or parameter properties), explicit `.ts` import extensions, no Vite `?url` imports and no DOM-only globals at module scope.
- One UTC `SimulationClock` drives illumination, aircraft, timeline and status. App must not re-render per playback frame; use the imperative simulation feed and narrow clock subscriptions.
- Never write `t` to the URL during playback: Safari throttles `history.replaceState`. Debounce paused scrubs (at least 400 ms); keep existing route/layover links backwards compatible.
- IANA offset/history/DST data comes from runtime `Intl`, not the boundary table. Browser/Node tzdb versions can differ; future rules can change. Missing or unsupported zones must leave route editing usable.
- The renderer runs on demand: call `requestRender()` after scene changes. Dispose Three.js geometries, materials, textures, controls and listeners when replacing or unmounting objects.
- Mobile keyboard focus must happen synchronously in the tap handler. Preserve `flushSync` followed by picker focus; desktop autofocus alone does not solve iOS keyboard activation.
- Headless Chromium WebGL needs the SwiftShader flags in `playwright.config.ts`. Keep expected fallback errors scoped to the test that deliberately disables WebGL.
- URL route takes precedence over remembered route, then the example. An explicit `?route=` means empty even though the canonical empty URL drops the parameter. Custom layovers ride on their transfer token (`LHR_180`); keep default layovers out of URLs.
- Layover menus are native `<select>` elements with the combobox role; E2E helpers target airport pickers with `airportField(page)`, not a bare `getByRole('combobox')`.
- Never commit `.cache/`, downloaded source imagery, secrets or test/build output.

## Definition of done

Lint, unit tests, all four E2E projects and production build pass. Review mobile and desktop screenshots. Update relevant documentation and `RECENT_CHANGES.md`; record genuine application bugs and limitations precisely. Keep changes within the user’s authorised scope.
