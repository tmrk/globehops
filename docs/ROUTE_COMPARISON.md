# Journey comparison

The comparison core supports 1–4 independent journeys with positional IDs A–D and colours amber, sky, rose and mint. Removing a journey re-letters later journeys; editor drafts retain separate stable React keys. Each journey reuses `computeJourney` and `buildTimeline`, including airport-local time resolution, propagation, transfer settings and validation.

## Alignment and metrics

Entered schedules keep their absolute UTC times. Undated journeys start at the earliest departure among dated journeys, including departures back-propagated from an entered arrival. If every journey is undated, `assumedStart` supplies the common instant; null leaves them without timelines. Invalid entered times are reported rather than replaced with an assumed start. A shared playback range spans the earliest timeline start to latest end.

Fastest means shortest total journey duration, including transfers. First arrival means earliest final UTC instant and requires an end for every valid compared journey. Fewer than two comparable journeys or an exact winning tie yields no winner. Journeys with fewer than two airports or schedule errors remain available for editing but do not participate in rankings. Unanchored estimates can still be ranked by duration; provenance distinguishes entered, estimated and assumed times. Prices, availability and connection feasibility are outside this model.

## Links and documents

A retains `route`, `depN`, `arrN` and optional `label`. B–D use `b.`, `c.`, `d.` prefixes for those same fields; every group needs a route, gaps compact and keys are case-insensitive. Labels are trimmed, 1–40 characters without controls. Shared view fields remain unprefixed; `leg` refers to A and `clock` may identify any compared airport. Existing single-journey links serialize unchanged. Older clients ignore extra journeys.

Itinerary version 1 accepts exactly one of `stops`, `journeys` or `sections`; each journey contains optional `label` and exactly one of 1–10 `stops` or 1–6 `sections`, with the existing stop/section rules. All alternatives use the same form and section count. `LinkState.compare` contains B–D. Document mapping emits journeys when compare is nonempty and otherwise preserves the classic stops form. Existing URL/document size limits still apply.

## Compared trips (including round trips)

`computeTripComparison` composes `computeTrip` for 2–4 alternatives, each with up to six sequential sections separated by explicit stays. Section k is compared with section k in every alternative. Positional alternative IDs remain A–D; the contained journey IDs are A1, A2, B1, B2, and so on. Connections stay within a section; destination stays separate sections. The computations never merge sections into one journey.

Entered times remain absolute. An untimed trip lines up journey by journey with the earliest timed counterpart unless the traveller chose the stay. A chosen stay places the next untimed section relative to the previous arrival. With no timed counterpart, `assumedStart` anchors the trip; null leaves it unanchored. Times derived from stays or alignment retain estimated/assumed provenance.

`compareTripMetrics` ranks complete alternatives by total travel time: flights plus connections over all sections, excluding stays. Schedule errors, missing flights or resolution errors exclude an alternative from rankings. It returns overall and section-by-section fastest IDs and deltas; fewer than two complete trips or an exact tie has no winner. `tripComparisonTimeline` spans the fleet and identifies shared stays, allowing automatic playback to skip those gaps without changing instants. `get_journey_timeline` remains scoped to a single journey or trip.

Readable links use A's ordinary keys and `2.*`–`6.*`, then `b.*` and `b.2.*`–`b.6.*`, continuing through `d.6.*`. Within each section, stop numbering starts at 1. For example:

```text
https://tmrk.github.io/globehops/?route=BUD-FRA-JFK&2.route=JFK-FRA-BUD&b.route=BUD-JFK&b.2.route=JFK-BUD
```

`LinkState.sections` contains A's later sections; `LinkState.compare[i].sections` contains another alternative's. Links accept different section counts; the app pads to a rectangle. Export to a document pads shorter alternatives with `{ stops: [] }`, which remains invalid until edited. Every prefixed group emits its route even when empty. `leg` counts A's flights across its sections; `clock` accepts an airport from any section of any alternative. Existing single/comparison/trip links keep their serialization.

Documents use `journeys: [{ label?, sections: [{ label?, stops, stayMinutes? }, …] }, …]`. Every alternative needs the same 1–6 sections; mixed stops/sections or unequal section counts fail validation (`sections_mismatch`). The alternative label names the offer; its first section label is a fallback only. Later labels and stays map to numeric link groups.

`planComparison` returns `kind: 'trip_comparison'` with per-alternative sections, stays and trip totals plus `travelMinutes`. Its comparison has `fastest`, travel-time `ranking` (`id`, `travelMinutes`, `deltaMinutes`), and `sections` (`name`, `fastest`, per-ID `deltaMinutes`). Plain comparisons retain their fields and add `kind: 'comparison'`. MCP/browser `compare_journeys` accept route/stops/sections alternatives, including the `route` + `returnRoute` + optional `stay` shorthand. Browser `toolJourneyResponse` uses `active` for the alternative and `activeSection` for the section, while top-level journey details describe that section.

## Public APIs and integration scope

- `src/lib/compare.ts`: palette/IDs, `MAX_JOURNEYS`, `computeComparison`, `compareMetrics`, `comparisonRange`.
- `src/state/compare.ts`: drafts, active index and reducer delegating route edits to `routeReducer`; add copies active endpoints without times/layovers.
- `src/agent/plan.ts`: `planComparison`, per-journey details, ranking, summaries and both link forms.
- Local MCP `compare_journeys`: 2–4 route/stop/section alternatives, optional view and `assumeDeparture`. Visualization/validation also accept journeys documents; single calculation/timeline tools direct multi-journey input to comparison.
- WebMCP parsing: `compare_journeys` and journeys documents produce the existing `set_route` command with `link.compare` and an encoded document search string. Browser comparison input omits `assumeDeparture`.

This core change supplies the APIs and parsing. App editor wiring, simultaneous rendering and comparison UI are separate integration work. They should consume these calculations and one shared UTC simulation clock. See [external agent examples](AGENT_INTEGRATION.md#compare-alternative-journeys).
