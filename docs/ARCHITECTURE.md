# Architecture

```text
OurAirports CSVs + data/aliases.json
  → scripts/update-airports.ts + scripts/lib/{csv,dataset}.ts
  → src/data/generated/airports.json + data/airports-build.json
  → loadAirports / decodeDataset
  → buildSearchIndex → AirportPicker → selected airport ID
  → routeReducer → stops → computeLegs (great-circle distance + time)
  → App → StopList + Summary
        → GlobeView → GlobeRenderer (markers, ground tracks, lifted arcs)

URL / localStorage → initial route (URL > remembered > example)
filled stops → share URL + replaceState + localStorage
unit selection → localStorage
NASA JPEG → scripts/build-textures.ts → imported WebP assets → GlobeRenderer
```

The generated JSON is imported as an asset URL and fetched at startup. Its compact tuples decode to typed airports plus ID maps; the normalised prefix index is built once per load. React owns route state and interface state. Selected flights are derived from legs; changing stops resets selection. No runtime backend or remote map service is involved.

## Renderer and lifecycle

`GlobeView` loads lazily, creates one renderer, forwards props and disposes it on unmount. The scene includes an Earth sphere, atmosphere, camera lighting, great-circle lines and HTML overlays. A 1K texture appears first; GPU capability, pointer type, memory hint and screen size choose 4K or 8K next. Texture readiness marks `.stage.is-ready`.

`requestRender()` schedules at most one animation frame. Each frame advances insets, camera tween, arc reveal and plane animation, then updates OrbitControls damping, renders and projects labels. Another frame is requested only while something changes. Input, resize, texture uploads and state setters request rendering. An idle scene has no perpetual animation loop.

Leg replacement disposes line geometries/materials; marker replacement removes HTML elements. Final disposal also releases textures, sphere/atmosphere resources, controls, observers and listeners. Renderer creation failure leaves the journey panel usable with a WebGL fallback note.

## Geometry and camera

Geographic calculations use a sphere with mean Earth radius 6,371.0088 km. ECEF vectors use Z north; scene vectors use Y north, longitude 0° at +X and 90°E at −Z. Ground tracks use spherical interpolation, including a deterministic antipodal fallback. The raised arc uses a gentle sine lift in the same great-circle plane.

Framing computes an enclosing spherical cap over sampled ground tracks (or markers when no leg exists). The cap radius and available field of view determine camera distance, including arc/label margin. Camera travel uses unit-vector slerp and a temporary distance lift for large rotations. If the overview limit cannot expose the full route, the HUD offers flight-by-flight inspection with a “Spans the globe” hint.

## Layout insets and projection

At widths of 760px and above, the panel’s right edge becomes the left inset. Below 760px, the top bar reserves 56px and the panel height becomes the bottom inset. ResizeObserver and window resize keep these measurements current. Insets interpolate unless reduced motion is active; `camera.setViewOffset` centres the globe in the remaining area without moving the UI. The smaller screen dimension determines the base field of view.

The mobile picker is a separate takeover dialog. `flushSync` mounts it within the tap handler, followed immediately by focus so iOS can open its keyboard. Visual viewport CSS variables position picker content around viewport changes. Desktop uses an inline picker. Labels are projected every rendered frame, hidden behind Earth and positioned using a small set of collision-avoidance offsets.
