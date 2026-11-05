# Recent changes

## 2026-11-05 — Borders, layovers, flight profile and design language

- **Country borders:** Natural Earth 1:50m land boundaries (public domain, v5.1.2) drawn on the globe, on by default. A globe button toggles them and the choice is remembered; hidden borders are not downloaded. New `npm run borders:build` pipeline with validation and tests.
- **Layovers:** every connection gets a layover (default 1h 30m) that can be changed per stop from 30 minutes to three days. Totals show flying time, layover time and the overall journey time. Custom layovers travel in share links and the remembered route as `LHR_180`.
- **Flight profile:** arcs now climb to a typical cruising altitude (11 km) in about 20 minutes, hold it, and descend over the last ~25 minutes. Every flight shares one cruise height (12× vertical exaggeration); short flights peak lower. Replaces the distance-scaled sine lift.
- **Design language:** all corners use five role tokens (full, xs, sm, md, lg) with concentric nesting; compact controls share one height and floating globe controls share one surface/shadow.
- **Fix:** wide multi-leg routes froze WebKit (Safari and every iOS browser) for ~15 s on load, e.g. the suggested London → Dubai → Singapore → Sydney: the camera's enclosing-cap search evaluated `atan2`/`hypot` per point thousands of times over ~350 points. It now compares dot products, frames from samples ≤ 2° apart and frames the first route once (≈ 0.45 s in Playwright WebKit; 12× faster in V8). Regression test added.
- Durations of a day or more format as `1d 4h 05m`.
- README now describes only the web app, its use and its sources; setup and commands live in `docs/DEVELOPMENT.md`.

Limitations: the altitude profile is a fixed illustrative model (no aircraft types, step climbs or holding). Border lines follow Natural Earth's de facto depiction at 1:50m and are approximate at close zoom. Layover choices are not validated against minimum connection times.

## 2026-11-05 — Deployment verification and texture loading

- First GitHub Pages deployment verified: Deploy workflow green (lint, unit, build, Chromium E2E), and the full four-project Playwright suite passes against https://tmrk.github.io/globehops/ (`E2E_BASE_URL`). The live bundle hashes match a local build of the same commit.
- Textures now load progressively: 1K → 4K for everyone; 8K only when zoomed in close on capable desktops (saves ~2 MB and ~130 MB GPU memory on typical visits).
- `scripts/dataset.test.ts` skips its cache-backed CLI integration test when `.cache/ourairports/` is absent (CI), instead of failing.
- Initial dataset rebuilt online so `data/airports-build.json` records the upstream OurAirports commit.

## 2026-11-05 — Initial release

- Interactive textured Earth with true great-circle arcs, dashed ground tracks, projected airport labels and flight inspection.
- Airport autocomplete, up to ten stops, insertion/removal, reverse, keyboard/pointer reorder, share URLs and remembered route/unit preferences.
- Mobile takeover picker, responsive journey panel, reduced motion, accessible controls, credits and a usable planner without WebGL.
- Direct Three.js with render-on-demand, spherical camera framing and UI-aware view offsets; static Vite build for GitHub Pages.
- Validated OurAirports generation, NASA WebP texture pipeline, daily data workflow and Pages deployment checks.
- Unit coverage for search ranking, display helpers and scene mathematics; four-project Playwright coverage of journeys, rendering, layout, fallback and base-path assets. Project, data and maintenance documentation added.

Limitations: OurAirports lacks traffic data, so ranking relies on match quality, scheduled service, size and maintained hub hints. NASA BMNG is a 2004 composite. Flight estimates ignore winds, aircraft, actual routing and layovers. The globe requires WebGL; route editing does not. Local E2E covers Chromium/WebKit, with no Firefox project; CI runs Chromium only. Real-device keyboard/native sharing still need device review.
