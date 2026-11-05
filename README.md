# GlobeHops

GlobeHops shows air journeys as great-circle routes on an interactive 3D Earth. Choose airports, add transfers, and inspect each flight’s distance and estimated duration. Routes can be shared through the page URL; the last route and distance unit are remembered in your browser.

[Live site](https://tmrk.github.io/globehops/) · [Source](https://github.com/tmrk/globehops)

![GlobeHops journey planner](docs/screenshot.png)

## Features

- Airport search by city, name, IATA/ICAO code and keywords, with accent-insensitive matching.
- Up to ten stops; insert, remove, reverse or reorder with pointer and keyboard controls.
- Great-circle arcs, ground tracks, airport labels, flight inspection, rotation and zoom.
- Kilometres or miles, per-flight estimates and journey totals excluding layovers.
- Mobile airport picker, reduced-motion support and route editing when WebGL is unavailable.
- Static hosting, locally served assets, no accounts, backend or analytics.

## Development

Requires Node.js **22.18+** (CI uses Node 24) and npm.

```sh
npm install
npm run dev
```

Open the URL Vite prints, under `/globehops/`. For browser tests, install Chromium and WebKit once:

```sh
npx playwright install chromium webkit
npm run test:e2e
```

The stack is React 19, TypeScript, Three.js and Vite, with Vitest, Playwright, ESLint, Prettier and sharp for development.

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
| `npm run textures:build` | Build WebP textures from a separately downloaded NASA source image.              |
| `npm run icons:build`    | Generate PNG app icons from the SVG sources in `public/`.                        |

See [development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md) and [code organisation](CODE.md).

## Sources and licensing

Code is [MIT licensed](LICENSE). Earth imagery is NASA Blue Marble Next Generation, July 2004, with topography and bathymetry; credit: NASA Earth Observatory (Reto Stöckli, NASA GSFC). NASA imagery is generally not copyrighted in the US and is subject to its media guidelines. Airport data is [OurAirports public-domain data](https://ourairports.com/data/). Geist and Geist Mono fonts by Vercel use OFL-1.1. These content and font terms are separate from the code licence; see [data sources](docs/DATA_SOURCES.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Deployment

GitHub Actions checks and builds the site, runs Chromium E2E tests and publishes `dist/` to GitHub Pages at `/globehops/`. A daily airport refresh validates new data and calls the deployment workflow after a successful direct push; protected branches use a PR fallback. Setup and manual commands are in [deployment](docs/DEPLOYMENT.md).

## Project structure

| Path                                  | Contents                                                          |
| ------------------------------------- | ----------------------------------------------------------------- |
| `src/components/`, `src/hooks/`       | Journey interface and browser integration.                        |
| `src/globe/`                          | Three.js renderer, React wrapper and scene mathematics.           |
| `src/lib/`, `src/state/`, `src/data/` | Pure calculations, route state, storage, URLs and airport search. |
| `src/styles/app.css`, `src/assets/`   | Design tokens, responsive CSS and generated textures.             |
| `scripts/`, `data/`                   | Data/texture tooling, aliases and build provenance.               |
| `e2e/`                                | Browser tests and shared error auditing.                          |
| `.github/workflows/`, `docs/`         | Automation and project guides.                                    |
