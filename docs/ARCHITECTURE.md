# Architecture

```text
OurAirports CSVs + data/aliases.json
  → scripts/update-airports.ts + scripts/lib/{csv,dataset}.ts
  → src/data/generated/airports.json + data/airports-build.json
  → loadAirports / decodeDataset
  → buildSearchIndex → AirportPicker → selected airport ID
  → routeReducer → stops (+ custom layovers) → computeLegs (great-circle distance + time)
                                             → computeLayovers (default or custom ground time)
  → App → StopList + Summary
        → GlobeView → GlobeRenderer (markers, ground tracks, altitude-profile arcs, borders)

URL / localStorage → initial route (URL > remembered > example)
filled stops → share URL + replaceState + localStorage
unit and border preferences → localStorage
NASA JPEG → scripts/build-textures.ts → imported WebP assets → GlobeRenderer
Natural Earth GeoJSON → scripts/build-borders.ts → borders.json asset → fetched while borders are shown
```

The generated JSON is imported as an asset URL and fetched at startup. Its compact tuples decode to typed airports plus ID maps; the normalised prefix index is built once per load. React owns route state and interface state. Selected flights are derived from legs; changing stops resets selection. No runtime backend or remote map service is involved.

## Renderer and lifecycle

`GlobeView` loads lazily, creates one renderer, forwards props and disposes it on unmount. The scene includes an Earth sphere, atmosphere, camera lighting, great-circle lines and HTML overlays. A 1K texture appears first, then the 4K texture (skipped on GPUs limited below 4096 px). The 8K texture is fetched only once the camera comes close (distance < 2.2 Earth radii) on a non-touch device with 8192 px texture support, because it costs ~2 MB to download and ~170 MB of GPU memory with mipmaps; if a close-up first view already triggered it, the 4K download is skipped. Texture readiness marks `.stage.is-ready`.

`requestRender()` schedules at most one animation frame. Each frame advances insets, camera tween, arc reveal and plane animation, then updates OrbitControls damping, renders and projects labels. Another frame is requested only while something changes. Input, resize, texture uploads and state setters request rendering. An idle scene has no perpetual animation loop.

Country borders load lazily: the renderer fetches the generated border asset only when borders are first shown (on by default, remembered per browser), decodes and densifies it, and builds one `LineSegments2` object at radius 1.0004 — above the sphere's flat facets, below the ground tracks. Its translucent material writes and tests the stencil buffer so each pixel blends once, avoiding bright beads where segment ends overlap. Toggling only changes visibility. A failed border download logs a warning and leaves the globe usable.

Leg replacement disposes line geometries/materials; marker replacement removes HTML elements. Final disposal also releases border, texture, sphere/atmosphere resources, controls, observers and listeners. Renderer creation failure leaves the journey panel usable with a WebGL fallback note.

## Geometry and camera

Geographic calculations use a sphere with mean Earth radius 6,371.0088 km. ECEF vectors use Z north; scene vectors use Y north, longitude 0° at +X and 90°E at −Z. Ground tracks use spherical interpolation, including a deterministic antipodal fallback.

Arcs lie in the same great-circle plane and follow `src/lib/altitude.ts`: climb to an 11 km cruise over 20 minutes at 600 km/h average ground speed (200 km), hold it, and descend over 25 minutes at 550 km/h (about 230 km). Climb and descent ease into cruise with zero slope at the top. Legs shorter than climb + descent shrink both phases proportionally and peak lower. Horizontal distances are true; height is exaggerated 12× (cruise ≈ 0.021 globe radii) above a 0.0018 base lift. Samples are dense through climb and descent and at most 60 km apart in cruise, so the arc reveal and the plane position map distance fractions to samples with `locateFraction` rather than assuming even spacing.

Framing computes an enclosing spherical cap over sampled ground tracks (or markers when no leg exists). The cap radius and available field of view determine camera distance, including arc/label margin. Camera travel uses unit-vector slerp and a temporary distance lift for large rotations. If the overview limit cannot expose the full route, the HUD offers flight-by-flight inspection with a “Spans the globe” hint.

## Layout insets and projection

At widths of 760px and above, the panel’s right edge becomes the left inset. Below 760px, the top bar reserves 56px and the panel height becomes the bottom inset. ResizeObserver and window resize keep these measurements current. Insets interpolate unless reduced motion is active; `camera.setViewOffset` centres the globe in the remaining area without moving the UI. The smaller screen dimension determines the base field of view.

The mobile picker is a separate takeover dialog. `flushSync` mounts it within the tap handler, followed immediately by focus so iOS can open its keyboard. Visual viewport CSS variables position picker content around viewport changes. Desktop uses an inline picker. Labels are projected every rendered frame, hidden behind Earth and positioned using a small set of collision-avoidance offsets.
