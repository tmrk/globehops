# Recent changes

Every release has a [semantic version](https://semver.org/) (shown in About, and faintly in the bottom-left corner on desktop) and a git tag `v<version>`. Versions up to 1.5.0 were assigned after the fact to the releases below.

## 1.9.0 — 2026-11-06 — Brighter oceans, crisper twilight, language button, separate water names, motion choice, my location

- **Brighter oceans by day.** The deep ocean in the NASA imagery was almost black, so it looked much the same by day as by night. The day texture now lifts the darkest water to a clear navy (most in the deep basins, least on the shelves, keeping every depth gradation in order); land, ice and lakes are unchanged. The texture files also got 7–9% smaller.
- **Crisper day and night.** The shading changes from night to full day within about ±3° of the Sun's elevation around sunset (previously a gradual fade through astronomical twilight at −18°). The terminator stays exactly where the Sun sets and rises; only its softness changed. City lights still come on through dusk.
- **Language button.** The language choice moved out of the display menu into its own button beside it; it is still in About too.
- **Country names and Oceans and seas.** The old “Place names” toggle is now two: **Country names** and **Oceans and seas**, each remembered separately. If you had place names on, both start on. `names` links still switch both.
- **Reduce motion, your choice.** A **Reduce motion** switch in the display menu starts from your system setting and can override it either way, so you can enjoy every animation even when your device asks for less motion (or calm things down when it doesn't). The choice is remembered.
- **My location.** An optional **My location** switch shows where you are as a blue dot, using your browser's location permission. Your position stays in the browser: it is never stored, put in links or sent anywhere.
- **Translation review.** Hungarian and Swedish wording was reviewed for idiom: for example Swedish “Följ flygplanet” (not the ambiguous “Följ planet”), “Vänd på rutten”, “Spela upp resan” and a proper compound in “GlobeHops-version”; Hungarian method and accessibility texts, “Lépkedés a járatok között” and natural word order in several hints.

## 1.8.1 — 2026-11-06 — Kilometres in Hungarian and Swedish

- **Kilometres by default in Hungarian and Swedish.** Without a saved choice, the distance unit followed only the browser's region tag, so a Hungarian or Swedish interface in an `en-US` browser (common when the language is picked from the time zone) showed miles. Hungarian and Swedish now default to kilometres; English keeps miles for US, Liberian and Myanmar browsers. A saved choice or a `units` link parameter still wins.

## 1.8.0 — 2026-11-06 — Hungarian and Swedish, follow the aircraft, oceans and twilight

- **Three languages.** Use GlobeHops in English, Magyar or Svenska, with translated controls, country names, dates, numbers and durations. Language is chosen from an explicit address, your saved choice, a browser time-zone country hint, then browser languages. Change it in Display or About; `/en/`, `/hu/` and `/sv/` have translated search/social metadata. Ordinary Share links let recipients use their own language.
- **Local city names and search.** Hungarian and Swedish city names appear throughout the journey and search alongside the original names. The city table downloads only when one of those languages is used; missing names keep their original text. Reviewed names include Swedish “Kyjiv”. Route titles stay concise and Hungarian playback speeds state their units clearly.
- **Countries, oceans and seas.** “Place names” now adds 242 countries, 7 ocean regions and 72 seas, bays, gulfs and selected channels/straits, in all three languages. Oceans use larger blue italic capitals and seas smaller italics; airport labels keep priority, including during reduced-motion zooming.
- **Follow aircraft.** A timeline toggle keeps the aircraft in view with smooth predictive tracking and zoom that opens up during cruise. Dragging, zooming or using camera keys returns control immediately. The choice is remembered and shareable (`follow=1`); reduced motion uses occasional re-centering. Phone timeline controls wrap more clearly on narrow screens.
- **Date-aware daylight and true twilight thresholds.** Day/night shading uses the standard sunrise/sunset elevation (−0.833°) with progressive civil, nautical and astronomical twilight through −6°, −12° and −18°. Daylight falls off more naturally toward dusk, a roughly 6% night floor preserves visibility, and city lights fade in through civil dusk. Solar accuracy and texture/marker alignment are checked against an independent astronomy library across 1900–2100.
- **More useful agent access.** Additive v1 links and itinerary documents can request language, place names, borders and a one-based flight number. Local MCP visualisation returns readable/document links and a human summary, with four reference resources and a `plan_and_visualize` prompt. Supported browsers expose five validated live WebMCP tools. Link/tool view choices preserve saved preferences; combined follow/flight links keep the aircraft camera active, ICAO clock links resolve correctly, and oversized documents can fall back to readable URLs.

Limitations: automatic country detection uses the browser’s time zone, not physical location. Automatic city-exonym matching covers 54.3% of scheduled-service airports; unmatched cities keep their original names, and airport proper names remain untranslated. Agent outputs remain English. Drake Passage is omitted because its pinned source geometry has no usable open-water polygon. WebMCP remains experimental; modern/legacy API paths were exercised through mocks. The globe stays spherical and twilight brightness is a display approximation without weather or terrain; solar test errors do not guarantee observed sunrise/sunset accuracy. Follow’s feature-level browser checks covered Chromium; it still needs WebKit/real-device review. The existing Ireland/LHR country-label overlap E2E assertion after keyboard zoom is intermittently flaky and was reproduced before this release.

## 1.7.1 — 2026-11-06 — Equal consent buttons, aligned version

- **Equal answers.** The analytics question's Deny and Allow buttons are now the same size and together span the full width of the sheet or card: Deny on the left, Allow (amber) on the right.
- **Neater version tag on desktop.** The faint version now sits the same 16 px from the left and bottom edges as the journey panel and globe controls (it was 3 px from the bottom); the panel's maximum height leaves room for it so they never overlap.

## 1.7.0 — 2026-11-06 — Clearer analytics question; version in About on phones

- **Analytics question at the bottom.** The one-time Google Analytics question no longer floats over the globe near the top. It is now a sheet at the bottom of the screen on phones (a card at the bottom centre on desktop), and the rest of the page is dimmed until you answer. **Allow** is a large amber button; **Deny** (formerly “No thanks”) is a quieter text button beneath it, or beside it on desktop. Escape does not dismiss the question; Details still opens About → Privacy on top of it. Both answers are remembered and can be changed in About.
- **No version tag on phones.** The faint version in the bottom-left corner now appears only on desktop; on phones the version is in About (“Version 1.7.0 · Build …”), and the journey sheet no longer reserves a 17 px strip for the tag.

## 1.6.1 — 2026-11-06 — Version in the bottom-left corner

- The faint version moved from beside the GlobeHops name to the bottom-left corner of the screen. On desktop it sits below the journey panel (hover shows the build commit and date). On phones it sits in a thin strip below the journey sheet's content (inside the home-indicator area on iPhones); the sheet keeps at least 17 px clear at its bottom edge, so the version never overlaps the totals, the collapsed bar or the docked timeline.

## 1.6.0 — 2026-11-06 — Version number

- **Versioning.** GlobeHops now follows semantic versioning: `package.json` holds the release version, each release adds a numbered entry here, and a workflow tags every successfully deployed new version as `v<version>`. Earlier releases were numbered retroactively (1.0.0 initial release … 1.5.0 city lights) and tagged on their last deployed commits.
- **Version in the corner.** A faint `v1.6.0` sits beside the GlobeHops name in the top-left corner on phones and desktops; hovering shows the build commit and date. About ends with “Version 1.6.0 · Build abc1234, 6 Nov 2026 · What’s new”, linking to this changelog.
- `agent/dataset.json` gains an `app` record (`version`, `commit`, `date`) so agents can tell which release they are talking to.
- A unit test keeps `package.json`, `package-lock.json` and the newest changelog heading on the same version, with headings in descending order.

## 1.5.0 — 2026-11-06 — City lights, crisper terminator, coastlines, neater totals, optional analytics

- **Crisper day and night.** The day/night blend now spans about −4° to +3.5° of solar elevation (was about −7° to +6°), the night side is darker (6 % instead of 13 % of daylight) and the orange twilight glow is narrower. The atmosphere rim uses the same edges.
- **City lights at night.** A night-light mask derived from NASA Black Marble 2016 (`lights-2k.webp`, 44 KB; `lights-4k.webp`, 143 KB) glows warm after dusk on the night side. It loads after the day texture, only while day/night shading is on, fades in over 0.7 s (instantly with reduced motion), uses the 2K mask on phones and GPUs below 4096 px, and is skipped silently if it fails. `npm run textures:build` now also builds it from the Black Marble 3 km JPEG (`--day-only` / `--night-only`).
- **Coastlines.** With borders on, a fainter outline (opacity 0.2 against 0.42 for land borders) follows every coast, so land reads clearly on the dark side. `npm run borders:build` now also writes `src/data/generated/coastlines.json` from Natural Earth 1:50m coastline v5.1.2, simplified to 0.02° (35,180 points, 79 KB gzipped); it loads in parallel with the borders and either can fail alone.
- **Neater totals.** The totals form two justified columns on shared rows: distance and flight count flush left; journey time and its flying/layover breakdown flush right. Beside Play the columns sit side by side with their details aligned beneath, and dated journeys add a departs/arrives line across the full width.
- **Google Analytics (GA4, optional).** A small notice asks once per browser; nothing loads from Google until the visitor chooses Allow (Consent Mode v2, advertising storage/user data/personalisation always denied, Google signals and ad personalisation off). One page view per visit, reported as the bare address (`https://tmrk.github.io/globehops/`) and the title “GlobeHops”, plus `share` and `play_journey` events; airports, dates and times are never sent. Route edits rewrite the address through the browser's own History methods, captured before gtag.js loads, so they never count as page views. The Google tag sends its own page view at start-up and ignores `config` overrides, so the bare address and title are queued with `set` before `js` (verified on live gtag.js). Only `tmrk.github.io` production builds are measured; local previews, E2E runs, forks and browsers sending Global Privacy Control or Do Not Track are never asked. About → Privacy explains it and has a switch; switching off sets Google's opt-out flag and deletes the `_ga` cookies.

Limitations: in the GA4 property, **Admin → Data streams → Enhanced measurement → Page views → “Page changes based on browser history events”** should be switched off; GlobeHops already avoids history page views from edits, but the mobile picker's Back still produces a `popstate`. City lights are a 2016 composite and the coastline is a 1:50m generalisation. The existing country-names E2E test is intermittently flaky on desktop Chromium (“Ireland / LHR” label overlap after zooming); it fails at a similar rate without these changes.

## 1.4.0 — 2026-11-06 — Calmer, aligned interface

A review of the whole interface for clutter and alignment. Every feature remains; fewer controls are visible at once and everything sits on one grid.

- **One grid for the journey.** Stops, flights, layovers and actions share four columns: route line, airport code, text, trailing tools. Codes, flight and layover icons, names and figures each form one straight vertical line. The route line is drawn per row, so it no longer breaks beside an open flight editor.
- **Edit mode.** Rows no longer carry a grip, a remove button and an insert button each. **Edit** (top of the panel) reveals reorder handles, remove and “add a stop here”, plus **Reverse route** and **Clear route**; **Done** returns to the calm view. Choosing an airport, Add stop, layovers and flight times work as before outside edit mode.
- **Quieter flights.** Each flight row reads “✈ 979 km · ≈ 1h 40m” with “Add times ⌄” (or its local times, departure-board style) at the right, instead of a numbered badge, an amber bordered pill and a plus on every row. The plane takes the flight's colour.
- **One primary action.** The totals sit at the bottom of the panel behind a ticket-style tear line, with a single amber **Play** button. Share and Edit are text buttons in the panel header; the header's Play/Reverse/Share chips are gone.
- **One map control.** The four floating globe buttons and the “Now” clock chip became one top-right group: a **display menu** (country borders, country names, day and night, km/mi, and the globe clock that opens the timeline) and **Re-centre**.
- **Phones: one bottom surface.** The open timeline is now the top of the journey sheet instead of a second floating card; collapsed during playback, the sheet is just the timeline, leaving more globe. While it is docked the totals scroll with the list. Timeline controls are equal-height chips with visible menu chevrons, and previous/next flight share one capsule.
- **Flight-times editor.** Date and time fields line up in two columns for departure and arrival; clearing an entered time is a small × in its heading.
- **Airport look.** Codes are split-flap departure-board tiles; the Play button is an amber wayfinding sign.
- **Code and city only.** Stop rows show the airport code and city on one line, as on a boarding pass; the full airport name stays in search results, the hover tooltip and the screen-reader label, and search still matches it. Airfields without a code show their name.
- README screenshots, README usage text, CODE.md (component map and a layout/alignment rule) and the E2E specs were updated. Tests open the display menu or Edit mode where those controls moved.

Limitations: per-end flight-time clearing moved into the editor heading; the sheet gesture and native pickers still need real-device review.

## 1.3.0 — 2026-11-05 — Flight-time editing, smooth playback, country names, typography and logo

- **Flight times, in place:** every flight row shows “Add times” (or its local departure → arrival once dated) and opens an editor with one row per end: the airport, its zone for that instant (“CET · UTC+1”) and a date and time field. Fields are native pickers under formatted faces (“Fri 20 Nov 2026”); empty fields show the time estimated from the rest of the journey with ≈ and start the picker there; keyboard focus reveals the native segmented editor. A Done button returns focus to the flight. The time bar's date explorer uses the same field.
- **Airport time zones reviewed:** all 9,934 assignments were cross-checked against the IANA tzdb country table. Two upstream OurAirports records had wrong positions and therefore wrong clocks: Ulleung, South Korea (recorded in Inner Mongolia → China time) and a “(Misplaced duplicate?)” Venezuelan record in Chad. They are now excluded (`data/excluded-airports.json`, with evidence). The time-zone build gained a country plausibility check; the 11 genuine special clocks it finds (e.g. Ciudad Juárez, Lord Howe, Eucla, Easter Island) are documented in `data/timezone-reviewed.json`, and a test fails on any new unexplained outlier. Schedule arithmetic remains UTC.
- **Smooth playback:** the trail now ends exactly at the aircraft (the last segment is cut to the exact progress) instead of growing in 60 km steps, and the globe draws inside the clock's animation frame, so the aircraft no longer blinks out between frames.
- **No dotted or dashed lines:** translucent route lines (dimmed legs, casings, the unflown remainder) use the stencil buffer so overlapping segment joints no longer bead into dots; the dashed ground track is gone.
- **Airport search without jumps:** on desktop the search field takes the row's exact place and height, and the hint and suggestions float in a popover above the itinerary (placed above the field when space below is short).
- **Typography system:** Barlow (signage grotesque) for the interface and Martian Mono, condensed, for codes, times, dates, distances and totals, with a token scale, caps tracking and tightened mono spacing. Replaces Geist.
- **New logo:** a globe with one great-circle hop, drawn with the globe's own origin and destination markers; new favicon, app icons and social image.
- **Country names (optional, off by default):** Natural Earth 1:50m label points, ranks and minimum zooms; names appear progressively as you zoom, sized by importance, without overlapping each other or airport labels. Lazy-loaded; the choice is remembered (`npm run labels:build`).
- **Faster deploys:** the Pages workflow gates on lint, unit tests, build and three `@smoke` E2E tests instead of the full Chromium suite (≈ 12 min → under 2 min); run affected E2E specs locally.
- **Mobile sheet gestures:** drag the journey sheet down (from its handle, header, or content scrolled to the top) to collapse it to the peek bar; lift the peek bar to bring it back. Short drags spring back.

Limitations: native date/time pickers and the sheet gesture still need real-device review (Playwright emulates touch with synthetic events). Zone abbreviations come from the browser's ICU data, which currently prints London's winter zone as GMT+0, so GlobeHops shows “UTC+0” there. Country names follow Natural Earth's de facto depiction.

## 1.2.0 — 2026-11-05 — Time, flight playback, day and night, agent access

- **Optional flight times:** select a flight to enter departure/arrival dates and times in each airport's local time. Times are stored per stop (a leg's departure on its origin, its arrival on its destination), so inserting stops keeps them in place; Reverse clears them. Missing times are propagated from entered ones (forward, then backward) using the flight-time estimator and layover settings; entered values never move. Every time carries provenance (entered, estimated, or assumed for an undated example). Errors (negative flight time, overlapping connection, nonexistent local time, offset mismatch, unknown zone) block playback; warnings cover ambiguous DST times (choose an offset), short connections, unusual durations and future rule changes.
- **Airport time zones:** a build-time point-in-polygon lookup against timezone-boundary-builder 2026f (pinned SHA-256) assigns an IANA zone to all 9,934 airports (one documented override, Union Glacier). The compact table (15 KB gz) is a separate ODbL derivative database; no polygons reach the browser. Conversions use the runtime `Intl` tzdb (DST, history, date line) instead of a Temporal polyfill.
- **Journey model and timeline:** versioned, multi-journey-ready `computeJourney` (legs `L1…`, transfers `T1…`), deterministic `journeyStateAt` (before/flight/transfer/after) and a monotonic climb–cruise–descent progress model matching the drawn arcs.
- **Playback:** one UTC `SimulationClock` drives the aircraft, timeline, status text, active-leg highlight and lighting. Auto speed plays the whole itinerary incl. layovers in ≈ 15 s; fixed 0.5/1/2 h per second, never shorter than ≈ 5 s. Scrubber with flight/layover segments, previous/next flight, clock in your zone, UTC or an airport's zone. Undated routes play from an example departure now. The renderer updates only uniforms, the plane and labels per frame; React re-renders only on phase changes.
- **Day and night:** the Sun's subsolar point (NOAA/Meeus, ≤ 0.015° from astronomy-engine) lights the Earth-fixed globe; restrained night side, subtle twilight, dimmer night-side atmosphere. Alignment is tested in scene coordinates and by sampling rendered pixels at JFK/DXB. A globe toggle turns shading off (remembered). A top-bar chip shows the current globe time.
- **Share links v1:** `depN`/`arrN` local times (optional `±HH:MM` only to disambiguate), `t`, `play`, `speed`, `clock`, `units`, `daynight`, or a base64url `itinerary` JSON document. Legacy `?route=` links are unchanged; `t` is written only when paused.
- **Agent access:** `/globehops/llms.txt`, `/globehops/agent/{capabilities,itinerary.schema,examples,dataset}.json`, JSON-LD and `describedby`/`help` links on the homepage, and a local stdio MCP server (`npm run mcp`: search_airports, calculate_route, validate_itinerary, visualize_route, get_journey_timeline) reusing the same modules as the app.
- Docs: new TIME_AND_SIMULATION, AGENT_INTEGRATION and ROUTE_COMPARISON_FUTURE; architecture, data sources, development, deployment and notices updated. The daily data workflow also rebuilds time zones and agent examples.

Limitations: positions and altitudes are illustrative estimates, not flight tracks; there is no taxi phase. Future schedules use today's time-zone rules. Overlapping zones in disputed areas resolve deterministically (documented in `data/TIMEZONES.md`). Multi-route comparison is prepared in the model but has no UI yet. Native date/time pickers still need real-device review.

## 1.1.0 — 2026-11-05 — Borders, layovers, flight profile and design language

- **Country borders:** Natural Earth 1:50m land boundaries (public domain, v5.1.2) drawn on the globe, on by default. A globe button toggles them and the choice is remembered; hidden borders are not downloaded. New `npm run borders:build` pipeline with validation and tests.
- **Layovers:** every connection gets a layover (default 1h 30m) that can be changed per stop from 30 minutes to three days. Totals show flying time, layover time and the overall journey time. Custom layovers travel in share links and the remembered route as `LHR_180`.
- **Flight profile:** arcs now climb to a typical cruising altitude (11 km) in about 20 minutes, hold it, and descend over the last ~25 minutes. Every flight shares one cruise height (12× vertical exaggeration); short flights peak lower. Replaces the distance-scaled sine lift.
- **Design language:** all corners use five role tokens (full, xs, sm, md, lg) with concentric nesting; compact controls share one height and floating globe controls share one surface/shadow.
- **Fix:** wide multi-leg routes froze WebKit (Safari and every iOS browser) for ~15 s on load, e.g. the suggested London → Dubai → Singapore → Sydney: the camera's enclosing-cap search evaluated `atan2`/`hypot` per point thousands of times over ~350 points. It now compares dot products, frames from samples ≤ 2° apart and frames the first route once (≈ 0.45 s in Playwright WebKit; 12× faster in V8). Regression test added.
- Durations of a day or more format as `1d 4h 05m`.
- README now describes only the web app, its use and its sources; setup and commands live in `docs/DEVELOPMENT.md`.

Limitations: the altitude profile is a fixed illustrative model (no aircraft types, step climbs or holding). Border lines follow Natural Earth's de facto depiction at 1:50m and are approximate at close zoom. Layover choices are not validated against minimum connection times.

## 1.0.1 — 2026-11-05 — Deployment verification and texture loading

- First GitHub Pages deployment verified: Deploy workflow green (lint, unit, build, Chromium E2E), and the full four-project Playwright suite passes against https://tmrk.github.io/globehops/ (`E2E_BASE_URL`). The live bundle hashes match a local build of the same commit.
- Textures now load progressively: 1K → 4K for everyone; 8K only when zoomed in close on capable desktops (saves ~2 MB and ~130 MB GPU memory on typical visits).
- `scripts/dataset.test.ts` skips its cache-backed CLI integration test when `.cache/ourairports/` is absent (CI), instead of failing.
- Initial dataset rebuilt online so `data/airports-build.json` records the upstream OurAirports commit.

## 1.0.0 — 2026-11-05 — Initial release

- Interactive textured Earth with true great-circle arcs, dashed ground tracks, projected airport labels and flight inspection.
- Airport autocomplete, up to ten stops, insertion/removal, reverse, keyboard/pointer reorder, share URLs and remembered route/unit preferences.
- Mobile takeover picker, responsive journey panel, reduced motion, accessible controls, credits and a usable planner without WebGL.
- Direct Three.js with render-on-demand, spherical camera framing and UI-aware view offsets; static Vite build for GitHub Pages.
- Validated OurAirports generation, NASA WebP texture pipeline, daily data workflow and Pages deployment checks.
- Unit coverage for search ranking, display helpers and scene mathematics; four-project Playwright coverage of journeys, rendering, layout, fallback and base-path assets. Project, data and maintenance documentation added.

Limitations: OurAirports lacks traffic data, so ranking relies on match quality, scheduled service, size and maintained hub hints. NASA BMNG is a 2004 composite. Flight estimates ignore winds, aircraft, actual routing and layovers. The globe requires WebGL; route editing does not. Local E2E covers Chromium/WebKit, with no Firefox project; CI runs Chromium only. Real-device keyboard/native sharing still need device review.
