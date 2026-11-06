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
  → mcp/ local stdio tools (same calculations; no hosted endpoint)
Vite → agent/dataset.json (current dataset provenance and app release)
package.json version + git commit → Vite define → src/version.ts → bottom-left version tag, About
public/llms.txt → external-agent discovery

NASA JPEGs (Blue Marble day, Black Marble night) → build-textures → WebP assets → GlobeRenderer
Natural Earth GeoJSON → build-borders → borders.json + coastlines.json → lazy border layers
```

Airport and time-zone JSON are imported as asset URLs and fetched independently at startup. Airport tuples decode to typed records and ID maps; the normalised search index is built once per load. The separate zone table supplies names; runtime `Intl` supplies offsets and DST. Missing zones leave route planning available.

The only third-party request is optional: with the visitor's consent, `src/analytics.ts` loads Google Analytics 4 (see “Analytics” below).

React owns editing and interface state and memoises the journey/timeline when inputs change. The clock is an external store: its imperative feed updates the renderer without an App render per playback frame. App subscribes to phase/leg changes, the display menu's globe clock to whole minutes, and TimeBar to full clock snapshots during playback. URL > remembered journey (legacy route fallback) > example determines startup; only paused view time is debounced into history. See [time and simulation](TIME_AND_SIMULATION.md). No runtime backend or remote map service is involved.

## Renderer and lifecycle

`GlobeView` loads lazily, creates one renderer, forwards props and disposes it on unmount. The scene includes an Earth sphere, atmosphere, camera lighting, great-circle lines and HTML overlays. A 1K texture appears first, then the 4K texture (skipped on GPUs limited below 4096 px). The 8K texture is fetched only once the camera comes close (distance < 2.2 Earth radii) on a non-touch device with 8192 px texture support, because it costs ~2 MB to download and ~170 MB of GPU memory with mipmaps; if a close-up first view already triggered it, the 4K download is skipped. Texture readiness marks `.stage.is-ready`. Once the day texture has settled and day/night shading is on, the renderer fetches the night-light mask (2K on coarse pointers and GPUs below 4096 px, 4K otherwise) as the material's `emissiveMap` with a black emissive colour, so three.js adds nothing itself; the custom fragment code samples it and adds warm light only past dusk, fading it in over 700 ms.

`requestRender()` schedules at most one animation frame. Each frame advances insets, camera tween, arc reveal, selection-plane animation and illumination fade, then updates OrbitControls damping, the view-space sun uniform, rendering and projected labels/aircraft. Another frame is requested only while something changes. Input, resize, texture uploads and state setters request rendering. An idle scene has no perpetual animation loop.

`GlobeView` subscribes directly to `SimulationFeed` and forwards illumination, air/ground aircraft state, active-leg highlight and follow transitions. The renderer moves the directional light into the Earth-fixed scene while shading is on and restores camera-relative lighting when it is off. The Earth material and atmosphere share sun-direction/blend uniforms and the same day/night edges (`DAY_EDGE`: solar-zenith cosine −0.07 … 0.06, roughly −4° to +3.5° of sun elevation); the night side keeps 6 % of daylight. Disabling shading fades over 360 ms, immediately under reduced motion.

The simulated aircraft uses distance progress on the precomputed arc, including parked endpoints before departure, during transfers and after arrival. The active leg has a stronger line and endpoint emphasis; flown and remaining portions use instance counts on prebuilt forward/reversed line geometry, and the end of the one partially visible segment is rewritten to the aircraft's exact position, so the trail grows continuously rather than sample by sample. Feed updates arrive inside the clock's animation frame and the view draws immediately (`GlobeRenderer.flush()`) instead of a frame later, so the aircraft, trail and labels never lag or blink between frames. Simulation highlight is separate from manually selected flight. Follow reframes on active-leg changes when the whole route does not fit; it does not continuously chase the aircraft. Drag/zoom or keyboard camera input cancels follow until a feed follow transition re-enables it.

Country borders load lazily: the renderer fetches the generated border and coastline assets in parallel only when borders are first shown (on by default, remembered per browser), decodes and densifies them, and builds one `LineSegments2` object per layer at radius 1.0004, above the sphere's flat facets: land borders at opacity 0.42, coastlines at 0.2. Their translucent materials share one stencil value, so each pixel blends once (no bright beads where segment ends overlap) and the border wins where the two meet. Route lines (dimmed legs, casings and the remaining trail) use the same technique with one stencil value per line, so every route reads as one smooth stroke; there is no separate dashed ground track. Toggling only changes visibility. A failed download of either layer logs a warning and leaves the other layer and the globe usable.

Leg replacement disposes line geometries/materials, including the remaining-trail line; marker replacement removes HTML elements. Final disposal also releases border, texture, sphere/atmosphere resources, controls, observers and listeners. Renderer creation failure leaves the journey panel usable with a WebGL fallback note.

## Analytics

`src/lib/analytics.ts` holds the testable rules and `src/analytics.ts` the browser side; `useAnalyticsConsent` remembers the visitor's decision (`globehops:analytics`) and `ConsentNotice` asks once. Measurement is offered only on `tmrk.github.io` production builds and never when the browser sends Global Privacy Control or Do Not Track, so local previews, E2E runs and forks never contact Google. Nothing loads before consent (Consent Mode v2 “basic”); after it, `gtag.js` loads at idle with advertising storage, user data and personalisation denied and Google signals off. The single page view reports `location.origin + pathname` and a fixed title; events (`share`, `play_journey`) carry no route data. The Google tag sends its page view itself as it initialises and ignores `config` overrides for it, so these values are queued with `gtag('set', …)` before `gtag('js', …)`; they then apply to every later event (scrolls, outbound clicks) even after the address and title change. This was verified against live gtag.js with collection requests blocked. App address writes go through `replaceUrl`/`pushUrl`, which call the `History.prototype` methods captured before gtag.js can wrap them, so edits and scrubs never become history page views. Withdrawing consent in About sets `ga-disable-<id>` and deletes `_ga` cookies.

## Geometry and camera

Geographic calculations use a sphere with mean Earth radius 6,371.0088 km. ECEF vectors use Z north; scene vectors use Y north, longitude 0° at +X and 90°E at −Z. Ground tracks use spherical interpolation, including a deterministic antipodal fallback.

Arcs lie in the same great-circle plane and follow `src/lib/altitude.ts`: climb to an 11 km cruise over 20 minutes at 600 km/h average ground speed (200 km), hold it, and descend over 25 minutes at 550 km/h (about 230 km). Climb and descent ease into cruise with zero slope at the top. Legs shorter than climb + descent shrink both phases proportionally and peak lower. Horizontal distances are true; height is exaggerated 12× (cruise ≈ 0.021 globe radii) above a 0.0018 base lift. Samples are dense through climb and descent and at most 60 km apart in cruise, so the arc reveal and the plane position map distance fractions to samples with `locateFraction` rather than assuming even spacing.

Framing computes an enclosing spherical cap over sampled ground tracks (or markers when no leg exists). The cap radius and available field of view determine camera distance, including arc/label margin. Camera travel uses unit-vector slerp and a temporary distance lift for large rotations. If the overview limit cannot expose the full route, the HUD offers flight-by-flight inspection with a “Spans the globe” hint.

## Layout insets and projection

The side-panel layout applies at widths ≥1000px, or ≥760px in landscape. Its right edge becomes the left inset. In the bottom-sheet layout, the top bar reserves 56px and the panel height becomes the bottom inset. ResizeObserver and window resize keep these measurements current. Insets interpolate unless reduced motion is active; `camera.setViewOffset` centres the globe in the remaining area without moving the UI. The smaller screen dimension determines the base field of view.

The mobile picker is a separate takeover dialog. `flushSync` mounts it within the tap handler, followed immediately by focus so iOS can open its keyboard. Visual viewport CSS variables position picker content around viewport changes. Desktop uses an inline picker that takes the stop row's place at the same height; its hint and suggestions render in a fixed-position popover (a portal placed under, or above when space is short, the field), so opening a search never moves the itinerary.

The mobile sheet follows touch: dragging it down from its handle, header, or content already scrolled to the top collapses it to the peek bar, and lifting the peek bar expands it (`useBottomSheet`, with the release decision in `lib/sheet.ts`). The drag is an imperative transform, not React state; taps and keyboard use the handle button. Reduced motion skips the slide. Labels are projected every rendered frame, hidden behind Earth and positioned using a small set of collision-avoidance offsets.

## Performance boundaries

Route samples, altitude arcs and the reversed remaining trail are built on route changes, not clock ticks. Playback changes illumination uniforms, aircraft projection, line instance counts and one segment end per visible line; labels are projected on rendered frames. Only camera/appearance transitions and active playback request continuing renderer frames. TimeBar renders from clock snapshots; App does not render on each tick. Live mode ticks every 30 seconds; an unchanged feed frame is ignored.

Keep the WebKit framing optimisation: camera caps use separate sparse ground samples (at most about 2° apart), rather than the denser altitude-profile samples used for drawing. `enclosingCap` keeps its dot-product hot loop, with one `acos` per radius evaluation. Do not reintroduce expensive per-point trigonometry on playback or resize. Texture loading remains progressive and capability-gated, and border geometry is built once on first use.

`mcp/` imports the pure modules natively in Node. Shared imports must remain erasable TypeScript with explicit `.ts` extensions and no Vite-only asset imports or module-scope browser globals. The adapter reads the same generated datasets from module-relative paths. External usage is documented in [AGENT_INTEGRATION.md](AGENT_INTEGRATION.md); contributor rules are in [AGENTS.md](../AGENTS.md).
