# Architecture

```text
OurAirports CSVs + aliases → update-airports → airports.json (public domain)
TBB 2026f ZIP + overrides + airports.json → build-timezones → timezones.json (ODbL)
  ↓ decodeDataset / decodeTimeZones
  airport lookup + search index + airport-ID → IANA zone lookup
  ↓
URL / remembered journey / example → routeReducer → filled stops + local times + layovers
  ↓                                                 ↓
computeLegs → precomputed globe route geometry     computeJourney → Journey + issues/provenance
                                                    ↓
                                                 buildTimeline → UTC flight/ground segments
                                                    ↓
SimulationClock (one UTC instant; live / paused / playing)
  → createSimulationFeed (journeyStateAt + subsolarPoint) → GlobeView → GlobeRenderer
  → scoped clock subscriptions → timeline/readouts/status UI
Journey → leg time editor + endpoint labels + summary
Filled stops + paused view → serializeLink → replaceState + safe storage

src/agent/{contract,itinerary,schema,plan}
  → reuse decoding/search/schedule/timeline/sun/link modules
  → build-agent-files → public/agent/{capabilities,itinerary.schema,examples}.json
  → mcp/ local stdio tools + resources + prompt (same calculations; no hosted endpoint)
  → webTools validation → useWebTools → optional live browser tools → App commands
Vite → agent/dataset.json (current dataset provenance and app release)
package.json version + git commit → Vite define → src/version.ts → bottom-left version tag (desktop), About
public/llms.txt → external-agent discovery

NASA JPEGs (Blue Marble day, Black Marble night) → build-textures → WebP assets → GlobeRenderer
Natural Earth GeoJSON → build-borders → borders.json + coastlines.json → lazy border layers
Natural Earth countries + marine polygons + place overrides → labels:build → country-labels.json
Natural Earth populated places + airports + place overrides → places:build → city-names.json
Locale path/query/storage/time zone/browser → catalogue bootstrap → I18nProvider → translated UI
  → lazy hu/sv city names → localizedCity / fmt.city + memoised localized search
  → locale prop → lazy multilingual country/ocean/sea layer
Vite localized-pages → en/hu/sv/index.html (translated static metadata)
```

Airport and time-zone JSON are imported as asset URLs and fetched independently at startup. Airport tuples decode to typed records and ID maps; the base normalised search index is built once per load. A non-English index adds city exonyms only when the dataset, locale or city table changes; route edits and playback reuse it. The separate zone table supplies names; runtime `Intl` supplies offsets and DST. Missing zones leave route planning available.

The only third-party request is optional: with the visitor's consent, `src/analytics.ts` loads Google Analytics 4 (see “Analytics” below).

React owns editing and interface state and memoises the journey/timeline when inputs change. The clock is an external store: its imperative feed updates the renderer without an App render per playback frame. App subscribes to phase/leg changes, the display menu's globe clock to whole minutes, and TimeBar to full clock snapshots during playback. URL > remembered journey (legacy route fallback) > example determines startup; only paused view time is debounced into history. See [time and simulation](TIME_AND_SIMULATION.md). First-visit examples alone wait for the airport time-zone table to finish loading (success or failure). `src/data/suggestions.ts` uses the browser’s IANA zone as a home-country proxy, resolves a likely gateway (LHR fallback), and offers three deterministic single-leg long-haul previews to familiar hubs, favouring region diversity. Estimates target at least 12 hours within 16,500 km; a sparse dataset may require shorter flights. Selecting a suggestion retains the welcome; route edits dismiss it. The mobile welcome keeps Add stop under Edit so the three 44 px suggestion rows fit the 390 × 844 reference sheet without increasing its height. Shorter screens can scroll the list. No runtime backend or remote map service is involved.

## Internationalisation and view overrides

`src/main.tsx` resolves path → `?lang=` → saved `globehops:locale` → browser time zone → browser languages → English, then loads the catalogue before mounting. Budapest and Stockholm time zones are country proxies, not geolocation. English is bundled; Hungarian and Swedish catalogues are lazy imports with the same compile-checked keys. `I18nProvider` supplies `t` and `fmt` via `useI18n()`, and loads the optional city dictionary only for hu/sv. `fmt.city()` and the localized search hook share that data; missing/unloaded names keep their original text. Airport proper names stay untranslated. Shared calculation/agent text remains English.

Explicit Language/About selections save `globehops:locale` and use `/en/`, `/hu/` or `/sv/` under the configured base. The Vite locale plugin emits static pages with translated title/description/social metadata, canonical/hreflang and JSON-LD; the app still needs JavaScript. Ordinary Share URLs remove locale paths and `lang`. Explicit agent/link locale, layers, follow, units, shading and clock options affect the visit while preserving saved choices. Country names (formerly “Place names”) retain the legacy `globehops:countryNames` key; “Oceans and seas” uses `globehops:waterNames`, initially inheriting the saved country-name value. The `names` link/view option overrides both layers for the visit; serialization and tool `currentView.names` retain the country-name value. Aircraft follow uses `globehops:followAircraft`.

The local MCP adapter exposes five tools, four discovery/usage resources and a `plan_and_visualize` prompt. Visualisation returns both link forms and a human summary. `webTools.ts` validates five live commands before app mutation; `useWebTools` feature-detects modern/legacy experimental WebMCP, aborts/unregisters on cleanup and contains API errors. It adds no remote server or dependency to the web bundle.

## Renderer and lifecycle

`GlobeView` loads lazily, creates one renderer, forwards props and disposes it on unmount. The scene includes an Earth sphere, atmosphere, camera lighting, great-circle lines and HTML overlays. A 1K texture appears first, then the 4K texture (skipped on GPUs limited below 4096 px). The 8K texture is fetched only once the camera comes close (distance < 2.2 Earth radii) on a non-touch device with 8192 px texture support, because it costs ~2 MB to download and ~170 MB of GPU memory with mipmaps; if a close-up first view already triggered it, the 4K download is skipped. Texture readiness marks `.stage.is-ready`. Once the day texture has settled and day/night shading is on, the renderer fetches the night-light mask (2K on coarse pointers and GPUs below 4096 px, 4K otherwise) as the material's `emissiveMap` with a black emissive colour, so three.js adds nothing itself; the custom fragment code samples it and adds warm light only past dusk, fading it in over 700 ms.

`requestRender()` schedules at most one animation frame. Each frame advances insets, camera tween/aircraft follow, arc reveal, selection-plane animation and illumination fade, then updates OrbitControls damping, the view-space sun uniform, rendering and projected labels/aircraft. Another frame is requested only while something changes. Input, resize, texture uploads and state setters request rendering. An idle scene has no perpetual animation loop.

`GlobeView` subscribes directly to `SimulationFeed` and forwards illumination, air/ground aircraft state, active-leg highlight and follow transitions. The renderer moves the directional light into the Earth-fixed scene while shading is on and restores camera-relative lighting when it is off. The Earth material and atmosphere share sun-direction/blend uniforms and `SOLAR_SHADING_GLSL`, generated from the CPU curve in `sun.ts`: a narrow blend centred on the −0.833° sunset (night below about −3.8°, full daylight above about +2.2°). Lambertian direct irradiance and diffuse fill provide stronger daylight falloff; the night side keeps roughly 6% visibility. City lights fade in from −3° to civil dusk (−6°). This is a spherical display approximation without weather or terrain. Disabling shading fades over 360 ms, immediately under reduced motion.

Comparison frames optionally carry a `fleet` of coloured, tagged aircraft on the same UTC clock. Each journey's local leg indices are offset into the flattened globe route; `aircraft` and `highlightLeg` still identify the primary journey for camera follow. `setFleet` pools HTML planes, highlights every journey's current leg/endpoints and draws independent airborne trails. Empty fleets retain route reveal/selection animations; null restores single-aircraft mode. Arc `lift` separates coincident journeys without changing their ground tracks or framing samples, and `muted` quiets idle alternatives. `GlobeView` keys automatic route framing by marker keys, leg keys and lifts; colour/muting changes preserve the camera, geometry and reveal progress.

The simulated aircraft uses distance progress on the precomputed arc, including parked endpoints before departure, during transfers and after arrival. The active leg has a stronger line and endpoint emphasis; flown and remaining portions use instance counts on prebuilt forward/reversed line geometry, and the end of the one partially visible segment is rewritten to the aircraft's exact position, so the trail grows continuously rather than sample by sample. Feed updates arrive inside the clock's animation frame and the view draws immediately (`GlobeRenderer.flush()`) instead of a frame later, so the aircraft, trail and labels never lag or blink between frames. Simulation highlight is separate from manually selected flight. The feed’s automatic leg framing handles active-leg changes when the whole route does not fit, independently of the explicit “Follow aircraft” toggle. Aircraft follow consumes air/ground frames and playback velocity, uses `followCamera.ts` for phase zoom, predictive lead and frame-rate-independent smoothing, and stays north-up with OrbitControls targeting the origin. Manual drag/wheel/touch/keyboard camera input exits follow. Reduced motion makes occasional immediate page turns when the aircraft leaves the safe centre area. Paused follow settles, so it does not keep rendering an idle scene.

Country borders load lazily: the renderer fetches the generated border and coastline assets in parallel only when borders are first shown (on by default, remembered per browser), decodes and densifies them, and builds one `LineSegments2` object per layer at radius 1.0004, above the sphere's flat facets: land borders at opacity 0.42, coastlines at 0.2. Their translucent materials share one stencil value, so each pixel blends once (no bright beads where segment ends overlap) and the border wins where the two meet. Route lines (dimmed legs, casings and the remaining trail) use the same technique with one stencil value per line, so every route reads as one smooth stroke; there is no separate dashed ground track. Toggling only changes visibility. A failed download of either layer logs a warning and leaves the other layer and the globe usable.

Independent place-name (countries) and water-name (oceans/seas) toggles share one label layer, which fetches `country-labels.json` when either is first shown. Its format-2 tuples carry English/Hungarian/Swedish names for 242 countries, 7 ocean regions and 72 seas. Oceans use larger blue italic capitals, seas smaller italics; zoom/limb fading and airport-first collision rules remain. Locale changes reuse the download, invalidate text metrics and request a render. `data/place-names.json` and [PLACE_NAMES.md](../data/PLACE_NAMES.md) hold reviewed overrides and conservative city-matching decisions.

Leg replacement disposes line geometries/materials, including the remaining-trail line; marker replacement removes HTML elements. Final disposal also releases border, texture, sphere/atmosphere resources, controls, observers and listeners. Renderer creation failure leaves the journey panel usable with a WebGL fallback note.

`useGeolocation` watches only while My location is enabled and WebGL/geolocation are available, clearing the watch on disable/unmount. `globehops:myLocation` stores only the explicit on/off choice. Permission denial saves off; temporary failure before a fix switches off without changing the saved choice. Coordinates remain in memory and reach only `GlobeView`/`GlobeRenderer` for a projected, hemisphere-occluded HTML dot beneath airport labels. They never enter persistence, links, analytics or agent context. The dot halo animates in CSS and stops under reduced motion.

## Analytics

`src/lib/analytics.ts` holds the testable rules and `src/analytics.ts` the browser side; `useAnalyticsConsent` remembers the visitor's decision (`globehops:analytics`) and `ConsentNotice` asks once, in a modal `<dialog>` (a bottom sheet on phones, a bottom-centre card on desktop) that dims the page until the visitor chooses Allow or Deny; Escape does not dismiss it, and Details opens About’s privacy section above it. Measurement is offered only on `tmrk.github.io` production builds and never when the browser sends Global Privacy Control or Do Not Track, so local previews, E2E runs and forks never contact Google. Nothing loads before consent (Consent Mode v2 “basic”); after it, `gtag.js` loads at idle with advertising storage, user data and personalisation denied and Google signals off. The single page view reports the bare site address with any `/en/`, `/hu/` or `/sv/` locale suffix removed, and a fixed title; events (`share`, `play_journey`) carry no route data. The Google tag sends its page view itself as it initialises and ignores `config` overrides for it, so these values are queued with `gtag('set', …)` before `gtag('js', …)`; they then apply to every later event (scrolls, outbound clicks) even after the address and title change. This was verified against live gtag.js with collection requests blocked. App address writes go through `replaceUrl`/`pushUrl`, which call the `History.prototype` methods captured before gtag.js can wrap them, so edits and scrubs never become history page views. Withdrawing consent in About sets `ga-disable-<id>` and deletes `_ga` cookies.

## Geometry and camera

Geographic calculations use a sphere with mean Earth radius 6,371.0088 km. ECEF vectors use Z north; scene vectors use Y north, longitude 0° at +X and 90°E at −Z. Ground tracks use spherical interpolation, including a deterministic antipodal fallback.

Arcs lie in the same great-circle plane and follow `src/lib/altitude.ts`: climb to an 11 km cruise over 20 minutes at 600 km/h average ground speed (200 km), hold it, and descend over 25 minutes at 550 km/h (about 230 km). Climb and descent ease into cruise with zero slope at the top. Legs shorter than climb + descent shrink both phases proportionally and peak lower. Horizontal distances are true; height is exaggerated 12× (cruise ≈ 0.021 globe radii) above a 0.0018 base lift. Samples are dense through climb and descent and at most 60 km apart in cruise, so the arc reveal and the plane position map distance fractions to samples with `locateFraction` rather than assuming even spacing.

Framing computes an enclosing spherical cap over sampled ground tracks (or markers when no leg exists). The cap radius and available field of view determine camera distance, including arc/label margin. Camera travel uses unit-vector slerp and a temporary distance lift for large rotations. If the overview limit cannot expose the full route, the HUD offers flight-by-flight inspection with a “Spans the globe” hint.

## Layout insets and projection

The side-panel layout applies at widths ≥1000px, or ≥760px in landscape. Its right edge becomes the left inset. In the bottom-sheet layout, the top bar reserves 56px and the panel height becomes the bottom inset. ResizeObserver and window resize keep these measurements current. Insets interpolate unless reduced motion is active; `camera.setViewOffset` centres the globe in the remaining area without moving the UI. The smaller screen dimension determines the base field of view.

The mobile picker is a separate takeover dialog. `flushSync` mounts it within the tap handler, followed immediately by focus so iOS can open its keyboard. Visual viewport CSS variables position picker content around viewport changes. Desktop uses an inline picker that takes the stop row's place at the same height; its hint and suggestions render in a fixed-position popover (a portal placed under, or above when space is short, the field), so opening a search never moves the itinerary.

The mobile sheet follows touch: dragging it down from its handle, header, or content already scrolled to the top collapses it to the peek bar, and lifting the peek bar expands it (`useBottomSheet`, with the release decision in `lib/sheet.ts`). The drag is an imperative transform, not React state; taps and keyboard use the handle button. Reduced motion skips the slide. Labels are projected every rendered frame, hidden behind Earth and positioned using a small set of collision-avoidance offsets.

The globe control group orders Layers, Language and Re-centre. Display and language menus are mutually exclusive; the latter uses native language names and roving radio buttons. Display orders borders, country names, oceans and seas, shading, optional My location, units, Reduce motion and globe time, with viewport-bounded scrolling.

`lib/motion.ts` resolves the nullable `globehops:reduceMotion` override before the system media query. `main.tsx` sets `html[data-motion]` before rendering; App keeps it in sync in a layout effect. Renderer, playback, follow, sheet and CSS all use the effective choice.

## Performance boundaries

Route samples, altitude arcs and the reversed remaining trail are built on route changes, not clock ticks. Playback changes illumination uniforms, aircraft projection, line instance counts and one segment end per visible line; labels are projected on rendered frames. Only camera/appearance transitions and active playback request continuing renderer frames. TimeBar renders from clock snapshots; App does not render on each tick. Live mode ticks every 30 seconds; an unchanged feed frame is ignored.

Keep the WebKit framing optimisation: camera caps use separate sparse ground samples (at most about 2° apart), rather than the denser altitude-profile samples used for drawing. `enclosingCap` keeps its dot-product hot loop, with one `acos` per radius evaluation. Do not reintroduce expensive per-point trigonometry on playback or resize. Texture loading remains progressive and capability-gated, and border geometry is built once on first use.

`mcp/` imports the pure modules natively in Node. Shared imports must remain erasable TypeScript with explicit `.ts` extensions and no Vite-only asset imports or module-scope browser globals. The adapter reads the same generated datasets from module-relative paths. External usage is documented in [AGENT_INTEGRATION.md](AGENT_INTEGRATION.md); contributor rules are in [AGENTS.md](../AGENTS.md).
