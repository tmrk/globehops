# Time and simulation

GlobeHops combines entered airport-local times with estimates to place a journey on one UTC timeline. It does not fetch airline schedules, track flights or predict operational conditions. Undated routes still work without entering any dates.

## Instants, wall times and zones

An absolute instant is epoch milliseconds in UTC. Airport inputs are local wall times, `YYYY-MM-DDTHH:MM`, with optional `:00` seconds and an explicit offset. Each airport's IANA zone comes from the separate generated airport-to-zone table. Runtime `Intl.DateTimeFormat` supplies offsets, daylight-saving transitions, historical rules and display names; no Temporal polyfill or offset database is bundled.

For example, Copenhagen `2026-11-20T08:15` resolves to `2026-11-20T07:15Z`, while Heathrow `2026-11-20T09:05` resolves to `09:05Z`. That flight lasts 1h 50m. Compare instants to calculate durations, even across midnight or the date line. Auckland departure `2026-11-20T00:30` and Honolulu arrival `2026-11-19T10:00` are 8h 30m apart despite the earlier arrival date.

`depN` and `arrN` in links refer to the local time at the 1-based stop N. Simulation `t`, document `view.time` and MCP timeline instants instead require `Z` or an explicit offset. Changing the timeline display zone changes labels, not the schedule or simulation instant.

## Entering and resolving times

A departure belongs to its origin stop; an arrival belongs to its destination stop. Every flight row carries an “Add times” control (or its local departure → arrival times once dated); it opens the flight's editor. Each end shows the airport, its zone label for that instant (“CET · UTC+1”, or only the offset where ICU has no customary abbreviation, e.g. browsers currently print London's winter zone as GMT+0) and a date and a time field. The fields are native inputs under formatted faces (“Fri 20 Nov 2026”), so a tap opens the platform picker and keyboard focus reveals the native segmented editor. Empty fields show the value derived from the rest of the journey with ≈; the native picker starts from it, and changing only the date or the time keeps the shown other half. Repeated-hour issues offer offset buttons. Storage stays stop-based. Reordering/inserting stops keeps entered values with their airports; reversing clears times. Arrival at the first filled stop and departure at the last are ignored and omitted from canonical links.

Supported schedule years are **1900–2100**. A date without a time is incomplete: the reducer and readable links can preserve it, but it is not an anchor. Itinerary documents require both date and time. Invalid inputs are reported and treated as absent for propagation; an error still prevents playback even if estimates fill the missing point.

Local-time resolution tries the runtime offsets around the date and verifies which candidates map back to that wall time:

- **Exact:** use the unique instant.
- **Repeated hour:** warn and use the earlier instant if no offset was selected. At New York on `2026-11-01T01:30`, `-04:00` selects `05:30Z` (EDT), while `-05:00` selects `06:30Z` (EST). Issue options carry the valid offsets and labels.
- **Skipped hour:** error; do not silently shift it. New York `2026-03-08T02:30` does not exist because clocks jump from 02:00 to 03:00. Enter a valid time outside the gap.
- **Explicit offset:** it must match a valid offset of that airport zone at that wall time. Copenhagen `2026-11-20T08:15Z` is an offset mismatch: the local offset is `+01:00`. The UTC instant `08:15Z` would be 09:15 locally. An offset selects an interpretation; it does not convert an arbitrary UTC timestamp into airport-local input.

In a URL encode a positive offset's `+` as `%2B`; parsing also tolerates a plus decoded as a space. The literal `Z` is valid for a local input only where UTC+0 is valid at that wall time. A mapped but runtime-unsupported zone has its own error. Missing zone data leaves undated route editing available; derived times may use UTC as a display fallback, which is not an inferred airport zone.

## Propagation and provenance

`computeJourney` takes filled stops and preserves all successfully resolved entered anchors. Let `E[k]` be the estimate for flight k and `L[s]` the transfer setting at stop s (default 90 minutes).

1. **Forward:** fill an unknown arrival from the preceding departure plus `E`; fill an unknown departure from that stop's arrival plus `L`.
2. **Backward:** visit stops in reverse order, filling only unknown departures from the next arrival minus `E`, then unknown transfer arrivals from their departures minus `L`.
3. **Assumed start:** if no entered value resolved and an explicit `assumedStart` was supplied, seed the first departure and run forward. Without an entered or assumed anchor, times stay unknown and there is no playable timeline.

Flight estimates are distance / 850 km/h × 60 + 30 minutes, rounded to five minutes per leg. Distances below 1 km have no estimate and propagation uses zero minutes for them. Entered anchors are never moved to make a connection work: conflicting times produce issues.

| Provenance  | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `entered`   | A valid airport-local input resolved to this instant.                                   |
| `estimated` | Derived from an entered anchor using flight/layover estimates.                          |
| `assumed`   | An example start was supplied for an undated journey; derived points retain this label. |

Duration provenance is separate: both endpoints entered means `entered`; a direct estimate dependency means `estimated`; otherwise independently anchored endpoints produce `mixed`. A transfer uses `source: setting` when one side was derived from the other through the layover setting, or `source: times` when the resolved endpoints determine it. The setting does not override two known endpoint times. Dependency edges establish provenance; equal numeric durations alone do not.

Dated/assumed flight totals sum resolved durations, transfer totals sum resolved ground time, and journey time is last arrival minus first departure. Undated totals sum flight estimates and layover settings. A calculated total does not prove an itinerary is valid; inspect issues as well.

## Schedule issues

Errors prevent playback. Warnings and information preserve validity. Stop/leg indices in the model are zero-based; messages use human-facing 1-based numbers. The agent layer also reports document, airport lookup and encoding errors; see its [contract](../public/agent/capabilities.json).

| Code                     | Severity    | Meaning / action                                                                              |
| ------------------------ | ----------- | --------------------------------------------------------------------------------------------- |
| `invalid_time`           | Error       | Invalid local calendar date/time; correct it.                                                 |
| `date_out_of_range`      | Error       | Enter a year from 1900 to 2100.                                                               |
| `time_missing`           | Warning     | Date entered without a time; not used as an anchor.                                           |
| `timezone_unknown`       | Error       | Entered time has no mapped airport zone.                                                      |
| `timezone_unsupported`   | Error       | Runtime Intl does not support the mapped zone.                                                |
| `ambiguous_local_time`   | Warning     | Repeated hour; earlier option used until a valid offset is selected.                          |
| `nonexistent_local_time` | Error       | Wall time falls in a clock-change gap.                                                        |
| `offset_mismatch`        | Error       | Explicit offset is invalid for this airport wall time.                                        |
| `ignored_time`           | Warning     | Arrival at origin or departure at destination is unused.                                      |
| `negative_flight_time`   | Error       | For distance ≥1 km, arrival does not follow departure (zero also fails).                      |
| `connection_overlap`     | Error       | Transfer departure is before arrival.                                                         |
| `short_connection`       | Warning     | Ground time is under 20 minutes; this is not a minimum-connection-time check.                 |
| `unusual_flight_time`    | Warning     | Entered/mixed duration is below `0.6 × estimate − 20` or above `1.6 × estimate + 60` minutes. |
| `long_layover`           | Warning     | Ground time exceeds seven days.                                                               |
| `future_rules`           | Information | An entered instant is in the future; current runtime rules may change.                        |

## Progress and timeline semantics

`flightProgress.ts` maps elapsed time to a monotonic distance fraction through climb, cruise and descent. The altitude model supplies climb/descent distances and average ground speeds. Short flights scale both phases to fill the available duration. With cruise distance remaining, those phases are compressed if necessary to leave at least 20% of duration for cruise. Progress is piecewise linear in time and clamped to [0, 1].

Position follows a great circle on a spherical Earth; altitude follows the illustrative climb/cruise/descent profile. Display height is exaggerated 12×. The whole departure-to-arrival interval is treated as flight: taxi, winds, airways, aircraft type and real tracks are absent. Time fraction and distance fraction can differ; neither represents live tracking.

`buildTimeline` returns null unless the journey has at least one leg, known start/end and no error issues. A timeline has its journey ID, first departure, last arrival and positive-duration flight/ground segments in absolute UTC. `journeyStateAt` is deterministic for a journey, timeline and instant:

| Phase      | State                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `before`   | At the origin, with the next departure instant.                                                                    |
| `flight`   | Active leg, elapsed/remaining minutes, time/distance fractions, position, altitude and climb/cruise/descent phase. |
| `transfer` | At a transfer airport, with arrival, next departure and minutes remaining.                                         |
| `after`    | At the destination; journey complete.                                                                              |

Boundaries belong to the later segment; the final arrival is `after`. Zero-duration segments are skipped. Shared before-departure text shows the local departure time because the `before` state contains no current instant. TimeBar has the clock snapshot and replaces that detail with a countdown. Other shared status text comes from `journeyText.ts`.

## Clock and playback

One `SimulationClock` supplies the UTC instant for aircraft, active leg, daylight and readouts. It is an external store with stable snapshot identity until a change. Seeking leaves live mode and clamps to the configured range. Playing from the end restarts at the range start; reaching the end pauses exactly there.

| Speed            | Behaviour                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Auto             | About 15 real seconds for the configured range, including layovers and any before-departure lead-in. |
| 0.5 h/s (`1800`) | Half a simulated hour per real second.                                                               |
| 1 h/s (`3600`)   | One simulated hour per real second.                                                                  |
| 2 h/s (`7200`)   | Two simulated hours per real second.                                                                 |

Fixed rates are capped so a full range normally takes at least about five seconds. Rates never fall below real time, so extremely short ranges are an exception. Auto uses `span / 15000`; fixed rates use `min(selectedRate, span / 5000)`, both with a minimum multiplier of 1.

Playback advances on animation frames, capping each real-time delta at 100 ms so a backgrounded tab resumes smoothly. Live mode follows `Date.now()` with no animation-frame loop: every 30 seconds for the ambient globe (`AMBIENT_TICK_MS`) and every second while tracking a journey (`TRACKING_TICK_MS`). The imperative simulation feed keeps App from re-rendering per frame; App observes phase/leg changes, the live clock chip observes whole minutes, and TimeBar consumes full snapshots. Reduced motion prevents link autoplay and automatic active-leg framing; explicit playback and the separate aircraft-follow toggle remain available.

In compare mode, `SimulationContext.fleet` supplies each journey, timeline, globe-leg offset, colour and tag. The feed evaluates every available timeline at that same clock instant and emits `SimFrame.fleet` with global leg indices. Aircraft wait at their own origins before departure, park at the preceding leg's end during transfers and remain at their destinations after arrival. Each airborne aircraft has its own flown/remaining trail and highlighted endpoints. `primary` indexes the original context fleet (including entries without timelines); its aircraft/highlight and playback velocity drive the existing camera-follow path. Closing simulation emits an empty fleet; omitting `fleet` retains single-journey frames. Unchanged frame signatures retain object identity and do not notify listeners, including while paused.

The timeline provides a native range slider, previous/next flight controls, clock-zone and speed menus, a Follow aircraft toggle, and Space/K playback shortcuts within the bar. If its journeys have flights but no valid timeline (for example while times conflict), it falls back to a date/daylight explorer with playback disabled.

**Live.** Once any journey has entered dates, the timeline offers a Live toggle. It calls `goLive(TRACKING_TICK_MS)`: the clock shows `Date.now()` regardless of the journey range (before departure the aircraft waits at its origin with a countdown; after arrival it rests at the destination), the feed treats live like playback for active-leg framing and velocity (at real-time rate), and the aircraft camera is switched on. Pressing it again, scrubbing, stepping or playing leaves live time at the moment shown. While live, App writes `live=1` instead of `t`, and the debounce never records a paused time. A `live=1` link opens the timeline live. `usePlaybackRange` moves an ambient live clock to the journey start only once, when the timeline opens, so later edits keep a chosen Live.

**Time dial.** With no flights in any journey, `TimeDial` replaces the timeline: an hour tape (24 px per hour, ticks drawn in the zone's offset at the needle, a day mark at midnight) under a fixed needle, a clock-zone menu (your time or UTC), a native date field and the same Live toggle. Drag, flick (exponential momentum, off under reduced motion), wheel and keys (arrows ±15 minutes, Shift ±1 hour, Page Up/Down ±1 day, Home for Live) seek the clock within 1900–2100. The first seek opens time, so the moment is written to `t` after the usual debounce; Live closes it again and returns the clock to the ambient 30-second cadence. On phones the dial docks into the sheet like the timeline.

Paused scrubs are debounced into `t` after 450 ms in App. Playback never writes `t` per frame: Safari throttles `history.replaceState`. Remembered journeys omit `t`, `play` and link-specific units. Legacy route/layover links remain readable; see [external agent integration](AGENT_INTEGRATION.md) for the complete v1 link/document contract.

## Aircraft follow

The explicit timeline toggle is independent of automatic leg framing for routes too wide to fit. The renderer follows air/ground frames and velocity from the same UTC simulation feed; `followCamera.ts` supplies predictive lead, phase-based zoom and frame-rate-independent exponential smoothing. The camera remains north-up with the OrbitControls target at the origin, allowing seamless handoff on drag, wheel, touch or keyboard camera input. With reduced motion, it makes occasional immediate page turns when the aircraft leaves the safe centre area instead of continuously moving. A paused follow view settles and stops requesting frames.

Explicit user choices are remembered in `globehops:followAircraft`. `follow=1` or document `view.follow` applies for the visit without replacing that preference. If a link also selects a flight, the aircraft camera takes priority; live `select_flight` exits follow to frame the requested flight. No camera tracking writes playback time to the URL or adds an App render per frame.

## Day/night and future rules

The subsolar point is where the Sun is overhead. `src/lib/sun.ts` uses the low-precision apparent Sun of date from NOAA/Meeus (declination plus equation of time, including approximate nutation and aberration). Julian centuries come directly from epoch milliseconds; there is no 1901–2099 Julian-day shortcut or local-time conversion. Declination supplies the subsolar latitude: the changing axial tilt relative to the Sun therefore produces seasons and polar day/night without a separate globe tilt. Longitude is `−15 × (UTC hours − 12 + equationOfTimeMinutes / 60)`, wrapped to [−180°, 180°). It accounts for apparent solar time, including Earth's orbital eccentricity and obliquity. See [NOAA's calculation details](https://gml.noaa.gov/grad/solcalc/calcdetails.html).

The instant always comes from `SimulationClock.getSnapshot().time` through the imperative simulation feed, including paused seeks and playback. Closing the timeline clears its range and calls `goLive()`, which follows `Date.now()` on a 30-second cadence. Journey departure times and display time zones do not independently set illumination.

Sun, airport markers and the equirectangular texture share the Earth-fixed scene convention: Y north, Greenwich +X, east −Z; the texture's left edge is −180°. On a unit sphere, `mu = dot(surfaceNormal, sunDirection) = sin(geometric solar-centre elevation)`. The surface and atmosphere use view-space normals. `renderFrame` updates the camera matrix and transforms the Earth-fixed sun direction into that same view space immediately before every draw, including camera-only motion while the simulation is paused. The directional key light is placed toward the Sun in scene space.

Independent [astronomy-engine](https://github.com/cosinekitty/astronomy/tree/master/source/js) tests (a development dependency only) compare the aberrated geocentric Sun vector rotated to the true equator of date, with longitude from apparent right ascension minus Greenwich apparent sidereal time. Over **7,629 deterministic instants spanning 1900–2100**, maximum errors measured are **0.003039° latitude/declination and 0.016407° longitude** (rounded upward). Samples include multiple UTC times near both solstices/equinoxes, perihelion/aphelion, leap days, pre-1970 dates, century boundaries and a uniform long-range sweep. Regression limits are 0.005° latitude and 0.02° longitude. Comparisons against unrefracted topocentric altitude give maxima of **0.010861°** for 90 location/time pairs and **0.014915°** for 30 airports × 201 instants (limits 0.02°). The small solar parallax is included in the reference but not the geocentric display. Geometry/UV and camera-matrix tests check texture alignment and invariance of elevation under camera motion; E2E canvas checks compare JFK/DXB day/night brightness, including a paused camera orbit.

### Surface and twilight shading

`daylightAt` retains its categorical labels: day above −0.833°, civil twilight down to and including −6°, night below. The −0.833° solar-centre elevation is the standard sea-level sunset approximation combining atmospheric refraction and the Sun's semi-diameter; actual refraction varies with weather and observer height. It is also the display blend's exact midpoint.

The pure `dayLightLevel(elevationDeg)` curve and **both** shader curves are generated from the same limits in `sun.ts`: one `smoothstep` in sin(elevation), symmetric around sunset (`TERMINATOR_HALF_WIDTH_DEG` = 3°). The blend is therefore continuous, monotonic and steepest exactly at sunset, so day and night read clearly with only a narrow twilight band between them. The band's position is exact; its brightness profile is a legibility choice, not civil/nautical/astronomical sky brightness (1.9.0 replaced a gradual curve that dimmed through −18°):

| Geometric elevation | Display blend | Meaning                 |
| ------------------- | ------------- | ----------------------- |
| ≤ about −3.83°      | 0             | Night                   |
| −0.833°             | 0.5           | Standard sunset/sunrise |
| ≥ about +2.17°      | 1             | Full day blend          |

A full day **blend** does not mean constant day brightness: the directional Lambert term still follows `max(mu, 0)`, reducing irradiance toward the horizon. The timed surface uses 1.2× the existing direct diffuse term and 0.65× its ambient diffuse term, preserving the overall overhead brightness while reducing ambient flattening. It blends into a cool floor of about 6% of daylight texture brightness for night-side legibility, plus a restrained warm twilight tint. NASA Black Marble city lights fade in between −3° and civil dusk (−6°), just after the band. The surface rim and outer atmosphere use the same twilight curve, retaining a dim night rim. Null illumination restores camera-relative lighting; toggling fades over 360 ms unless reduced motion is requested.

The sunset elevation is astronomically grounded; the band width, blend shape, ambient fill, rim and tints are display choices, not a radiative-transfer model or predictions of sky luminance. Weather, terrain, eclipses and observer height are not simulated. City lights are a static texture. At 2026-12-21 15:00 UTC, the subsolar point is about 23.44°S, 45.4°W: the North Pole is in polar night and the South Pole in polar day; the eastern Americas and most of the Atlantic are daylit, with the evening terminator toward Europe/Africa.

### Sun and Moon

With shading on, each frame's `sky` (`skyAt` in `simulation.ts`) holds the subsolar point, the Earth–Sun distance (Meeus 25.5, within 0.0001 AU of astronomy-engine) and `moonAt`. `src/lib/moon.ts` evaluates the leading terms of Meeus ch. 47 (ELP-2000/82) for the Moon's ecliptic position and distance, converts with the mean obliquity and Greenwich mean sidereal time (Meeus 12.4) to the Earth-fixed frame, and builds the Moon's pole and prime meridian from Cassini's laws (Meeus ch. 53) in that same frame. Against astronomy-engine across 1900–2100 (every 37 days), the sublunar point is within 0.04° (0.02° today; a constant ΔT of 69 s stands in for TT − UT), the distance within 50 km and the sub-Earth libration point within 0.1°. Physical libration and nutation are left out; all are far below the Moon's 0.5° disc. A test also checks the total lunar eclipse of 2025-09-07.

The renderer draws both at their true apparent sizes from the camera: the Moon at its real distance, the Sun at infinity (see [architecture](ARCHITECTURE.md)). Phase follows from lighting the Moon by the Sun's direction; Earth's umbra and penumbra are cones from the Sun's and Earth's radii. Their glare, earthshine (scaled by Earth's phase as seen from the Moon, so brightest near new Moon) and eclipse tint are display choices. At true size the Moon is only in view from a narrow band of camera directions, so the display menu's Find the Moon turns the camera to it.

### Spherical Earth approximation

The globe deliberately remains spherical. WGS84 geodetic and geocentric latitude differ by at most about **0.1925°** (often rounded to 0.19°), near 45° latitude. A spherical position using geodetic latitude aligns its radial normal with the ellipsoid's geodetic surface-normal direction, which is the useful direction for local solar elevation; converting marker latitudes to geocentric latitude would misalign the texture and that normal. The omitted ellipsoidal shape changes the geographic position by at most this angular bound, roughly one pixel or less on a globe with a 300-pixel radius, so an ellipsoid is unnecessary at the rendered scale. This shape bound is separate from the solar-coordinate errors above.

Future times use the rules currently installed in the browser or Node runtime. Governments can change them, and different runtime tzdb versions can resolve the same local input differently. Links preserve local values plus any selected offset, not a frozen rules database; an offset may later fail validation after a rule change. Recheck future itineraries after runtime/data updates. Historical precision also depends on runtime ICU coverage; a modern geographic zone assignment does not establish every airport's historical operational clock.
