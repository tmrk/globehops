# Journey comparison

The comparison core supports 1–4 independent journeys with positional IDs A–D and colours amber, sky, rose and mint. Removing a journey re-letters later journeys; editor drafts retain separate stable React keys. Each journey reuses `computeJourney` and `buildTimeline`, including airport-local time resolution, propagation, transfer settings and validation.

## Alignment and metrics

Entered schedules keep their absolute UTC times. Undated journeys start at the earliest departure among dated journeys, including departures back-propagated from an entered arrival. If every journey is undated, `assumedStart` supplies the common instant; null leaves them without timelines. Invalid entered times are reported rather than replaced with an assumed start. A shared playback range spans the earliest timeline start to latest end.

Fastest means shortest total journey duration, including transfers. First arrival means earliest final UTC instant and requires an end for every valid compared journey. Fewer than two comparable journeys or an exact winning tie yields no winner. Journeys with fewer than two airports or schedule errors remain available for editing but do not participate in rankings. Unanchored estimates can still be ranked by duration; provenance distinguishes entered, estimated and assumed times. Prices, availability and connection feasibility are outside this model.

## Links and documents

A retains `route`, `depN`, `arrN` and optional `label`. B–D use `b.`, `c.`, `d.` prefixes for those same fields; every group needs a route, gaps compact and keys are case-insensitive. Labels are trimmed, 1–40 characters without controls. Shared view fields remain unprefixed; `leg` refers to A and `clock` may identify any compared airport. Existing single-journey links serialize unchanged. Older clients ignore extra journeys.

Itinerary version 1 accepts exactly one of `stops` or `journeys`; each journey contains optional `label` and 1–10 `stops` with the existing stop rules. `LinkState.compare` contains B–D. Document mapping emits journeys when compare is nonempty and otherwise preserves the classic stops form. Existing URL/document size limits still apply.

## Public APIs and integration scope

- `src/lib/compare.ts`: palette/IDs, `MAX_JOURNEYS`, `computeComparison`, `compareMetrics`, `comparisonRange`.
- `src/state/compare.ts`: drafts, active index and reducer delegating route edits to `routeReducer`; add copies active endpoints without times/layovers.
- `src/agent/plan.ts`: `planComparison`, per-journey details, ranking, summaries and both link forms.
- Local MCP `compare_journeys`: 2–4 route/stop alternatives, optional view and `assumeDeparture`. Visualization/validation also accept journeys documents; single calculation/timeline tools direct multi-journey input to comparison.
- WebMCP parsing: `compare_journeys` and journeys documents produce the existing `set_route` command with `link.compare` and an encoded document search string. Browser comparison input omits `assumeDeparture`.

This core change supplies the APIs and parsing. App editor wiring, simultaneous rendering and comparison UI are separate integration work. They should consume these calculations and one shared UTC simulation clock. See [external agent examples](AGENT_INTEGRATION.md#compare-alternative-journeys).
