# Time and simulation

GlobeHops combines entered airport-local times with estimates to place a journey on one UTC timeline. It does not fetch airline schedules, track flights or predict operational conditions. Undated routes still work without entering any dates.

## Instants, wall times and zones

An absolute instant is epoch milliseconds in UTC. Airport inputs are local wall times, `YYYY-MM-DDTHH:MM`, with optional `:00` seconds and an explicit offset. Each airport's IANA zone comes from the separate generated airport-to-zone table. Runtime `Intl.DateTimeFormat` supplies offsets, daylight-saving transitions, historical rules and display names; no Temporal polyfill or offset database is bundled.

For example, Copenhagen `2026-11-20T08:15` resolves to `2026-11-20T07:15Z`, while Heathrow `2026-11-20T09:05` resolves to `09:05Z`. That flight lasts 1h 50m. Compare instants to calculate durations, even across midnight or the date line. Auckland departure `2026-11-20T00:30` and Honolulu arrival `2026-11-19T10:00` are 8h 30m apart despite the earlier arrival date.

`depN` and `arrN` in links refer to the local time at the 1-based stop N. Simulation `t`, document `view.time` and MCP timeline instants instead require `Z` or an explicit offset. Changing the timeline display zone changes labels, not the schedule or simulation instant.

## Entering and resolving times

A departure belongs to its origin stop; an arrival belongs to its destination stop. Select a flight row to open its departure/arrival editor with native date and time inputs, local zone/offset labels and clear buttons. Missing derived endpoints appear as estimated hints; repeated-hour issues offer offset buttons. Storage stays stop-based. Reordering/inserting stops keeps entered values with their airports; reversing clears times. Arrival at the first filled stop and departure at the last are ignored and omitted from canonical links.

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

Playback advances on animation frames, capping each real-time delta at 100 ms so a backgrounded tab resumes smoothly. Live mode follows `Date.now()` every 30 seconds with no animation-frame loop. The imperative simulation feed keeps App from re-rendering per frame; App observes phase/leg changes, the live clock chip observes whole minutes, and TimeBar consumes full snapshots. Reduced motion prevents link autoplay and automatic follow; explicit playback remains available.

The timeline provides a native range slider, previous/next flight controls, clock-zone and speed menus, and Space/K playback shortcuts within the bar. Without a playable route it offers a date/daylight explorer with playback disabled.

Paused scrubs are debounced into `t` after 450 ms in App. Playback never writes `t` per frame: Safari throttles `history.replaceState`. Remembered journeys omit `t`, `play` and link-specific units. Legacy route/layover links remain readable; see [external agent integration](AGENT_INTEGRATION.md) for the complete v1 link/document contract.

## Day/night and future rules

The subsolar point is where the Sun is overhead. NOAA/Meeus declination and equation of time derive it from the selected UTC instant. Geographic sunlight uses the surface-normal dot product with that direction. `daylightAt` labels day above −0.833° geometric elevation, civil twilight down to and including −6°, and night below.

The shader blends a broad terminator, cool dim night, subtle twilight and a dimmer atmospheric rim. Its artistic transition is not identical to the categorical daylight thresholds, and it does not model weather or city lights. Turning shading off restores camera-relative lighting. Sun and airport coordinates share the Earth-fixed scene convention (Y north, Greenwich +X, east −Z); astronomy-engine tests independently check subsolar accuracy and 30-airport scene alignment across 20 instants. Solar coordinates are tested to 0.05°; topocentric elevation comparisons allow 0.1°.

Future times use the rules currently installed in the browser or Node runtime. Governments can change them, and different runtime tzdb versions can resolve the same local input differently. Links preserve local values plus any selected offset, not a frozen rules database; an offset may later fail validation after a rule change. Recheck future itineraries after runtime/data updates. Historical precision also depends on runtime ICU coverage; a modern geographic zone assignment does not establish every airport's historical operational clock.
