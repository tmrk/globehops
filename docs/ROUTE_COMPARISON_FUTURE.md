# Future route comparison

Comparison is an extension point, not an implemented feature. GlobeHops currently edits, links and renders one journey. There is no comparison mode, multi-journey document or comparative ranking.

## What the model already provides

`JourneyInput.id` and `Journey.id` identify a journey; `Timeline.journeyId` ties its timeline to it. Each journey has leg IDs (`L1`, `L2`, …) and transfer IDs (`T1`, …). These are positional within a journey, not globally unique or stable across insertion/reordering: use a composite journey/leg identity and decide whether editing needs persistent IDs.

`computeJourney` and `buildTimeline` can run independently for each input. Each timeline holds absolute UTC instants, so one `SimulationClock` can drive `journeyStateAt` for several journeys at the same instant. A route can be in flight while another is connecting or already finished. Keep one timeline per journey, with a comparison range spanning the earliest departure to latest arrival.

Undated options need an explicit policy: for example, the same assumed departure for all, labelled `assumed`. Different entered starts should remain absolute rather than silently aligning them. A separate elapsed-time comparison could be useful, but would be a different viewing mode and must label its alignment clearly.

## Renderer and state work still needed

The current `GlobeRoute`, simulation feed, aircraft, highlight and selection APIs address a single route. Comparison needs journey-scoped geometry keys, multiple aircraft/highlights, a palette distinguishing journeys from their individual legs, and marker deduplication for shared airports. Define framing for all routes versus a selected journey, follow behaviour and disposal when an option is removed. Preserve sparse framing samples, precomputed geometry and render-on-demand updates.

App state must hold several inputs and derived timelines, independent validation issues and a selected journey/leg. Existing stop-based time facts and propagation can be reused; scheduling should not be reimplemented in comparison components. Keep per-journey provenance visible when comparing entered schedules with estimated or assumed options.

## Possible link evolution

A versioned itinerary document is the clearest extension, for example:

```json
{
  "version": 2,
  "journeys": [
    { "id": "A", "stops": [{ "airport": "CPH" }, { "airport": "JFK" }] },
    { "id": "B", "stops": [{ "airport": "CPH" }, { "airport": "LHR" }, { "airport": "JFK" }] }
  ]
}
```

This is a proposal, not an accepted schema. It would need shared view/alignment fields, limits, validation, generator updates and MCP handling. Retain v1 parsing and existing route links.

An alternative is repeated route parameters with journey prefixes for schedules, such as `route=CPH-JFK&route=CPH-LHR-JFK&A.dep1=…&B.dep1=…`. Current parsing does not support this: it keeps the first parameter value and has no journey-prefix grammar. Define ordering, IDs, encoding and length limits before choosing it; long comparisons may favour a document.

## Metrics and interface sketch

| Metric       | Existing basis                                                  | Interpretation                                         |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------ |
| Distance     | Sum of great-circle leg kilometres                              | Modelled route length, not flown track.                |
| Flying time  | Sum of leg durations or estimates                               | Show entered/estimated/mixed provenance.               |
| Layover time | Sum of transfer durations/settings                              | Distinguish entered endpoints from fallback settings.  |
| Journey time | Last arrival minus first departure, or undated summed estimates | Includes connections; compare dates/zones through UTC. |
| Stops        | Intermediate airports; also expose flight count                 | More stops need not imply a longer journey.            |
| Provenance   | Time points, duration sources and issues                        | An assumed comparison is not a timetable comparison.   |

A possible interface adds an “Add alternative” action, compact A/B journey tabs and a shared globe. A small metrics table shows differences; a shared time scrubber displays separate labelled timeline rows. On mobile, edit one journey at a time and keep the globe visible; provide text comparison without WebGL. Journey colours need text labels and focus/keyboard support, and reduced motion must remain respected.

A shorter route is not necessarily faster, cheaper or better. Prices, availability, minimum connection rules, reliability, emissions and user preferences are not in the current model. Do not imply that distance or illustrative flight time establishes an overall recommendation.
