# Recent changes

## 2026-11-05 — Initial release

- Interactive textured Earth with true great-circle arcs, dashed ground tracks, projected airport labels and flight inspection.
- Airport autocomplete, up to ten stops, insertion/removal, reverse, keyboard/pointer reorder, share URLs and remembered route/unit preferences.
- Mobile takeover picker, responsive journey panel, reduced motion, accessible controls, credits and a usable planner without WebGL.
- Direct Three.js with render-on-demand, spherical camera framing and UI-aware view offsets; static Vite build for GitHub Pages.
- Validated OurAirports generation, NASA WebP texture pipeline, daily data workflow and Pages deployment checks.
- Unit coverage for search ranking, display helpers and scene mathematics; four-project Playwright coverage of journeys, rendering, layout, fallback and base-path assets. Project, data and maintenance documentation added.

Limitations: OurAirports lacks traffic data, so ranking relies on match quality, scheduled service, size and maintained hub hints. NASA BMNG is a 2004 composite. Flight estimates ignore winds, aircraft, actual routing and layovers. The globe requires WebGL; route editing does not. Local E2E covers Chromium/WebKit, with no Firefox project; CI runs Chromium only. Real-device keyboard/native sharing still need device review.
