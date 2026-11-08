# Working on GlobeHops

## Architecture and entry points

Read `src/App.tsx` first: it composes the app from focused hooks — `useAppLinks` (airports, time zones, search and URL > remembered > example startup), `useViewPreferences` (saved preferences vs visit-only overrides), `useJourneyModel`, `useJourneyPlayback`, `useJourneyAddress` (URL/remembered journey), `usePickerHistory`, `usePanelInsets` and `useAppWebTools` — and keeps editing/playback handlers and layout. `src/main.tsx` resolves the locale, loads its catalogue, loads fonts/CSS and mounts React inside `I18nProvider`. `src/components/` owns accessible UI; `src/hooks/` handles browser media, viewport, toast and narrow clock subscriptions.

Pure logic lives in `src/lib/` (geography, time-zone conversion, solar position, schedule propagation, flight progress, timeline and journey text), `src/state/` (route transitions, simulation clock/feed, links and safe storage), `src/data/` (dataset decoding, airport-to-zone lookup and search) and `src/agent/` (shared contract, itinerary schema/validation and planning). `mcp/` is the local stdio adapter over those same modules, not another calculation engine.

`src/globe/GlobeView.tsx` is the lazy React boundary for `GlobeRenderer.ts`. Keep imperative Three.js work in `src/globe/`. See [CODE.md](CODE.md), [architecture](docs/ARCHITECTURE.md) and [time and simulation](docs/TIME_AND_SIMULATION.md).

[docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) is for **external agents using GlobeHops** to construct links or call tools. It is not contributor guidance; agents working on this codebase should follow this file.

## Conventions and priorities

- TypeScript strict mode; avoid `any`. Prettier: 120 columns, single quotes, trailing commas.
- All UI text goes through `useI18n()` (`t`/`fmt`) and the typed `src/i18n/messages/{en,hu,sv}.ts` catalogues; add every key in all three locales (missing keys are compile errors). Format cities with `fmt.city()`; keep airport proper names untranslated and shared agent/MCP output in English.
- Keep pure logic in `src/lib/`, `src/state/`, `src/data/` and `src/agent/`, with meaningful unit tests next to it.
- Put CSS in `src/styles/app.css`; use its existing tokens and responsive layout conventions. Corners use only the `--radius-*` role tokens (see [CODE.md](CODE.md) “Design language”); never add literal radii.
- Prioritise simplicity, mobile usability, a prominent globe, restrained motion and accessibility. Use semantic roles, labels and keyboard controls.
- Preserve reduced-motion behaviour (saved `globehops:reduceMotion` overrides the system), touch targets, focus and useful route editing without WebGL.
- No proprietary maps, tiles, APIs, API keys or backends. Every asset must be openly licensed and documented in `docs/DATA_SOURCES.md` and `THIRD_PARTY_NOTICES.md`.
- The one exception is the owner-requested, consent-gated Google Analytics 4 in `src/analytics.ts` (rules in `src/lib/analytics.ts`): nothing loads before consent, only on `tmrk.github.io`, never with GPC/DNT. Never send airports, dates, times, the query string or the document title; route address writes through `replaceUrl`/`pushUrl`. Add no other trackers.

## Commands and verification

Use Node 22.18+; CI uses Node 24. Run `npm install` locally or `npm ci` for a clean lockfile install. `npm run dev` serves development; `npm run build` type-checks and builds; `npm run preview` serves `dist/`. `npm run places:build` regenerates city exonyms, `npm run labels:build` regenerates country/marine labels, `npm run timezones:build` regenerates airport time zones, `npm run agent:build` regenerates agent discovery JSON, and `npm run mcp` starts the local stdio server.

Run `npm run lint`, `npm test`, `npm run build`, then `npm run test:e2e`. Install browsers with `npx playwright install chromium webkit`. The suite has desktop/mobile Chromium and WebKit projects; CI deploys after only the three `@smoke` E2E tests (desktop Chromium). Firefox is not configured. When worktrees run concurrently, set a unique `E2E_PORT` (e.g. `E2E_PORT=4180 npx playwright test --project=desktop-chromium -g @smoke`). Use `npm run format` for formatting. See [development](docs/DEVELOPMENT.md) for focused test commands and screenshot review.

Review screenshots at mobile and desktop sizes, including a picker and an edited route. The E2E rendering/layout checks save captures under `test-results/`; inspect them as well as assertions. Prefer accessible selectors and web-first assertions; avoid sleeps. Every E2E test uses the shared console/page error audit. The shared fixture seeds `globehops:locale=en` before navigation, and Playwright uses `en-GB`, so English assertions do not depend on the host time zone. Detection tests opt out with `test.use({ localeChoice: null })`; explicit locale paths still take precedence.

## Assets, data and deployment

`npm run data:update` downloads and validates OurAirports before generating `src/data/generated/airports.json` and `data/airports-build.json`. `npm run data:check` validates without writes and reports changes; it does not fail solely because data changed. Offline validation: `npm run data:check -- --offline` requires cached CSVs. Keep aliases small, correct and justified in `data/ALIASES.md`; primary-airport ranking hints belong in `src/data/rankHints.ts` with rationale. Upstream airports with wrong positions go in `data/excluded-airports.json`; airports that genuinely keep a different clock from the rest of their country go in `data/timezone-reviewed.json` (the time-zone build flags both, and a test fails while one is unexplained). Never hand-edit generated airport tuples. See [sources](docs/DATA_SOURCES.md).

`npm run borders:build` regenerates `src/data/generated/borders.json` from the pinned Natural Earth v5.1.2 GeoJSON (cached in `.cache/naturalearth/`; `--offline` and `--refresh` available). Never hand-edit it.

`npm run labels:build` regenerates multilingual country/ocean/sea labels in `src/data/generated/country-labels.json` from pinned Natural Earth v5.1.2 Admin 0 countries and marine polygons. Cache: `.cache/naturalearth/{ne_50m_admin_0_countries,ne_50m_geography_marine_polys}.geojson`; `--offline`, `--refresh` and optional country then marine source paths are available. Never hand-edit the generated labels.

`npm run places:build` regenerates `src/data/generated/city-names.json` from pinned Natural Earth v5.1.2 populated places (cache: `.cache/naturalearth/ne_10m_populated_places.geojson`; `--offline`, `--refresh` or an optional source path). Never hand-edit the generated city dictionaries. Maintain justified city/label overrides in `data/place-names.json` and document them in `data/PLACE_NAMES.md`. `I18nProvider` lazily loads the city table on first hu/sv use; English needs no request. App rebuilds locale-aware search only when dataset, locale or exonyms change. “Country names” (formerly “Place names”) retains the `globehops:countryNames` preference key; “Oceans and seas” uses `globehops:waterNames`, which inherits it until set.

`npm run timezones:build` uses the SHA-256-pinned TBB 2026f ZIP in `.cache/timezones/2026f/` (downloads if absent; `--offline` and `--refresh` available). Never hand-edit `src/data/generated/timezones.json`; commit it with `data/timezones-build.json`. Keep this ODbL derivative database separate from public-domain `airports.json`. Source updates and justified overrides are documented in `data/TIMEZONES.md`.

Never hand-edit generated `public/agent/*.json`: run `npm run agent:build` after contract, calculation or dataset changes. `scripts/agent-files.test.ts` fails on drift. `agent/dataset.json` is emitted separately by Vite from current build metadata; it is not a checked-in file.

`npm run textures:build` requires the NASA source JPEG in `.cache/bmng/` or a source path argument. `npm run icons:build` renders stylised PNG app icons and iOS splash screens from pinned Natural Earth country polygons using Playwright Chromium Canvas 2D, and converts the documented app screenshots to manifest WebP assets; add `-- --og http://localhost:4173/globehops/` to capture the social preview from a running build.

`.github/workflows/deploy.yml` publishes Pages after checks. `update-airports.yml` refreshes daily at 04:23 UTC, rebuilds time zones when airports change, pushes validated changes or opens a PR, then calls Deploy for successful direct pushes. `GITHUB_TOKEN` pushes do not trigger push workflows; keep the reusable workflow call. See [deployment](docs/DEPLOYMENT.md).

## Common pitfalls

- Production base is `/globehops/`; use imported asset URLs and test the production build at that path. `BASE_PATH` can override the Vite base for another host.
- Node runs `.ts` scripts and `mcp/` natively. All modules they import must use erasable TypeScript (no enums, namespaces or parameter properties), explicit `.ts` import extensions, no Vite `?url` imports and no DOM-only globals at module scope.
- Locale precedence is path → `?lang=` → saved `globehops:locale` → browser time zone (Budapest/Stockholm as country proxies, not physical location) → browser languages → English. Explicit selectors persist; link/tool language changes are visit-only. Keep `/en/`, `/hu/`, `/sv/` static pages under the configured base and ordinary share links language-neutral.
- Agent link/tool view options are temporary overrides; preserve saved follow, layers, units, clock, shading and locale preferences. Optional experimental WebMCP must feature-detect APIs, validate inputs and abort/unregister on cleanup; missing/broken support must not break editing.
- One UTC `SimulationClock` drives illumination, aircraft, timeline and status. App must not re-render per playback frame; use the imperative simulation feed and narrow clock subscriptions.
- Aircraft follow is separate from automatic active-leg framing. Keep its camera north-up (`up = +Y`) and OrbitControls target at the origin for seamless manual handoff; drag/wheel/touch/keyboard input exits follow. Use feed velocity, bounded predictive lead and frame-rate-independent smoothing. Reduced motion uses occasional immediate re-centering instead of continuous pursuit. Remember explicit user choices in `globehops:followAircraft`; `follow=1` / `view.follow` can override for a visit.
- Surface and atmosphere shading thresholds/GLSL must come from `src/lib/sun.ts` (narrow ±3° blend centred on the −0.833° sunset); do not duplicate curves in the renderer.
- Never write `t` to the URL during playback: Safari throttles `history.replaceState`. Debounce paused scrubs (at least 400 ms); keep existing route/layover links backwards compatible.
- IANA offset/history/DST data comes from runtime `Intl`, not the boundary table. Browser/Node tzdb versions can differ; future rules can change. Missing or unsupported zones must leave route editing usable.
- The renderer runs on demand: call `requestRender()` after scene changes. Dispose Three.js geometries, materials, textures, controls and listeners when replacing or unmounting objects.
- Mobile keyboard focus must happen synchronously in the tap handler. Preserve `flushSync` followed by picker focus; desktop autofocus alone does not solve iOS keyboard activation.
- Headless Chromium WebGL needs the SwiftShader flags in `playwright.config.ts`. Keep expected fallback errors scoped to the test that deliberately disables WebGL.
- URL route takes precedence over remembered route, then the example. An explicit `?route=` means empty even though the canonical empty URL drops the parameter. Custom layovers ride on their transfer token (`LHR_180`); keep default layovers out of URLs.
- Layover menus are native `<select>` elements with the combobox role; E2E helpers target airport pickers with `airportField(page)`, not a bare `getByRole('combobox')`.
- Never commit `.cache/`, downloaded source imagery, secrets or test/build output.

## Versioning

GlobeHops uses [semantic versioning](https://semver.org/). `package.json` is the source of truth; Vite injects it with the build commit and date (`src/version.ts`), shown faintly in the bottom-left corner on desktop (not on phones), in About and in `agent/dataset.json`.

- Every change deployed to users is a release: bump with `npm version <patch|minor|major> --no-git-tag-version` (updates `package-lock.json` too) and add `## <version> — <YYYY-MM-DD> — <title>` at the top of `RECENT_CHANGES.md`. `scripts/version.test.ts` fails if they disagree or headings are out of order.
- **patch**: fixes, copy, data/asset corrections without new behaviour; **minor**: new or changed user-visible features; **major**: breaking changes to share links, the agent contract or other public interfaces (avoid; links stay backwards compatible).
- Follow-up fixes to an unreleased version can share it. Data-only refreshes by the airport workflow do not bump the version.
- `.github/workflows/tag-release.yml` tags the commit of each successful push-triggered deploy whose version has no tag yet (`v<version>`); never move or reuse a tag.

## Definition of done

Lint, unit tests and production build pass, and the E2E specs affected by the change pass (Chromium by default; add WebKit for touch, date input, font or Safari-specific changes). The full four-project suite takes several minutes: run it only for broad UI changes or when asked; CI runs only the three `@smoke` E2E tests (desktop Chromium) before every deployment. Review mobile and desktop screenshots. Bump the version and add its `RECENT_CHANGES.md` entry; update relevant documentation; record genuine application bugs and limitations precisely. Keep changes within the user’s authorised scope.

- Compare invariants: journey ids A–D are positional; alternatives use `b.*`/`c.*`/`d.*` link parameters while single-journey links stay unchanged; one UTC clock drives the fleet, with the active journey primary for camera follow.
