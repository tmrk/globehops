# Working on GlobeHops

## Architecture and entry points

Read `src/App.tsx` first: it loads airports, builds search, initialises the route, connects the reducer to components and sends derived route geometry to the globe. `src/main.tsx` loads fonts/CSS and mounts React. `src/components/` owns accessible UI; `src/hooks/` handles browser media, viewport and toast state. `src/state/` owns route transitions, URL serialisation and safe local storage. `src/data/` decodes and searches the generated dataset; `src/lib/` owns geography, flight-time and formatting logic.

`src/globe/GlobeView.tsx` is the lazy React boundary for `GlobeRenderer.ts`. Keep imperative Three.js work in `src/globe/`. See [CODE.md](CODE.md) and [architecture](docs/ARCHITECTURE.md).

## Conventions and priorities

- TypeScript strict mode; avoid `any`. Prettier: 120 columns, single quotes, trailing commas.
- Keep pure logic in `src/lib/`, `src/state/` and `src/data/`, with meaningful unit tests next to it.
- Put CSS in `src/styles/app.css`; use its existing tokens and responsive layout conventions.
- Prioritise simplicity, mobile usability, a prominent globe, restrained motion and accessibility. Use semantic roles, labels and keyboard controls.
- Preserve reduced-motion behaviour, touch targets, focus and useful route editing without WebGL.
- No proprietary maps, tiles, APIs, API keys, backends or analytics. Every asset must be openly licensed and documented in `docs/DATA_SOURCES.md` and `THIRD_PARTY_NOTICES.md`.

## Commands and verification

Use Node 22.18+; CI uses Node 24. Run `npm install` locally or `npm ci` for a clean lockfile install. `npm run dev` serves development; `npm run build` type-checks and builds; `npm run preview` serves `dist/`.

Run `npm run lint`, `npm test`, `npm run build`, then `npm run test:e2e`. Install browsers with `npx playwright install chromium webkit`. The suite has desktop/mobile Chromium and WebKit projects; CI runs Chromium only. Firefox is not configured. Use `npm run format` for formatting. See [development](docs/DEVELOPMENT.md) for focused test commands and screenshot review.

Review screenshots at mobile and desktop sizes, including a picker and an edited route. The E2E rendering/layout checks save captures under `test-results/`; inspect them as well as assertions. Prefer accessible selectors and web-first assertions; avoid sleeps. Every E2E test uses the shared console/page error audit.

## Assets, data and deployment

`npm run data:update` downloads and validates OurAirports before generating `src/data/generated/airports.json` and `data/airports-build.json`. `npm run data:check` validates without writes and reports changes; it does not fail solely because data changed. Offline validation: `npm run data:check -- --offline` requires cached CSVs. Keep aliases small, correct and justified in `data/ALIASES.md`; primary-airport ranking hints belong in `src/data/rankHints.ts` with rationale. Never hand-edit generated airport tuples. See [sources](docs/DATA_SOURCES.md).

`npm run textures:build` requires the NASA source JPEG in `.cache/bmng/` or a source path argument. `npm run icons:build` generates PNG app icons from `public/logo.svg` and `public/favicon.svg` using Playwright Chromium; add `-- --og http://localhost:4173/globehops/` to capture the social preview from a running build.

`.github/workflows/deploy.yml` publishes Pages after checks. `update-airports.yml` refreshes daily at 04:23 UTC, pushes validated changes or opens a PR, then calls Deploy for successful direct pushes. `GITHUB_TOKEN` pushes do not trigger push workflows; keep the reusable workflow call. See [deployment](docs/DEPLOYMENT.md).

## Common pitfalls

- Production base is `/globehops/`; use imported asset URLs and test the production build at that path. `BASE_PATH` can override the Vite base for another host.
- Node runs `.ts` scripts natively: use erasable syntax and explicit `.ts` import extensions.
- The renderer runs on demand: call `requestRender()` after scene changes. Dispose Three.js geometries, materials, textures, controls and listeners when replacing or unmounting objects.
- Mobile keyboard focus must happen synchronously in the tap handler. Preserve `flushSync` followed by picker focus; desktop autofocus alone does not solve iOS keyboard activation.
- Headless Chromium WebGL needs the SwiftShader flags in `playwright.config.ts`. Keep expected fallback errors scoped to the test that deliberately disables WebGL.
- URL route takes precedence over remembered route, then the example. An explicit `?route=` means empty even though the canonical empty URL drops the parameter.
- Never commit `.cache/`, downloaded source imagery, secrets or test/build output.

## Definition of done

Lint, unit tests, all four E2E projects and production build pass. Review mobile and desktop screenshots. Update relevant documentation and `RECENT_CHANGES.md`; record genuine application bugs and limitations precisely. Keep changes within the user’s authorised scope.
