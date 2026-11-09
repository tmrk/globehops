# Restricted airspace

GlobeHops can route flights around airspace that airlines are advised or required to avoid. The toggle **Avoid restricted airspace** (display menu, on by default, saved as `globehops:avoidAirspace`) switches it; off restores the great-circle routes, distances and estimates exactly.

This is an illustration, not flight planning. The list below is small, hand-maintained and reviewed at a date; real airline routes also depend on winds, airways, ATC, NOTAMs and each airline's own risk assessment.

## Files

| File                               | Role                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `data/airspace-advisories.json`    | Hand-maintained list: one entry per avoidance zone, with source, dates, operators, level limit, geometry. |
| `scripts/lib/airspace.ts`          | Validates the list and builds polygons from the Natural Earth sources already used by `labels:build`.     |
| `scripts/build-airspace.ts`        | `npm run airspace:build` (`--offline`, `--refresh`): writes `src/data/generated/airspace.json`.           |
| `src/data/generated/airspace.json` | Generated runtime data (about 34 KB, 11 KB gzipped). Never hand-edit it.                                  |
| `src/data/airspace.ts`             | Decodes the generated file; exact point-in-zone test.                                                     |
| `src/lib/airspace.ts`              | Applicability rules and the detour search.                                                                |

`scripts/airspace.test.ts` fails when the generated metadata drifts from the list, so rebuild after every edit.

## Sources

- **EASA Conflict Zone Information Bulletins** (CZIBs), [index](https://www.easa.europa.eu/en/domains/air-operations/czibs), reviewed **9 November 2026** (16 active bulletins). Each zone links its bulletin. CZIBs are recommendations to EASA operators (Regulation (EU) 965/2012) and to third-country operators authorised by EASA when flying to, from or within the EU; they are not universal prohibitions, and many end on a stated date unless extended.
- **EASA Safety Directives SD-2021-02 / SD-2021-03** (Belarus, FIR Minsk), binding on EASA operators and EASA-authorised third-country operators respectively, restated by CZIB-2022-01R14.
- **Russian Federal Air Transport Agency (Rosaviatsia)**, 28 February 2022: Russian airspace closed to airlines of EU states and others (special permission aside), as reported by [Aviation Week](https://aviationweek.com/air-transport/safety-ops-regulation/russia-bans-european-carriers-response-eu-sanctions) and [Baker McKenzie](https://sanctionsnews.bakermckenzie.com/russia-imposes-a-ban-on-foreign-aircraft-flights-from-36-states/). Not an EASA advisory; it applies only to the named states' airlines, so the zone is limited to the `easa` operator group.
- **Geometry**: Natural Earth v5.1.2 1:50m Admin 0 countries and geography marine polygons (public domain), the same pinned files and `.cache/naturalearth/` cache as `npm run labels:build`. No other boundary data is downloaded or bundled.

Only facts (bulletin numbers, dates, areas, levels) are recorded; recommendation texts are short paraphrases.

## What a zone records

- `issued`, `revised`, `validUntil`: the bulletin's first issue, latest revision and published end (`null` while none is published). A zone applies to a flight only on days from `issued` to `validUntil` inclusive (UTC), using the flight's departure — entered or estimated — or today for an undated journey. Past flights before a zone's first issue and future flights after its end ignore it; extensions only take effect once the list is updated.
- `operators`: `easa` (EASA operators) and/or `tco` (EASA-authorised third-country operators). GlobeHops does not know the airline, so it assumes an EU/EEA airline (`easa`), the most restricted case, and says so in the app. The router accepts `tco` or `other` for callers that know better.
- `ceilingFl`: advisories limited to low levels (e.g. "below FL260") apply only to flights too short to climb above them under the app's altitude model (cruise ≈ FL360).
- `exemptCountries`: flights to or from these countries ignore the zone (the Persian Gulf bulletin exempts arrivals and departures at Bahrain, Kuwait, Qatar and UAE aerodromes).
- `approximate`: the geometry deliberately differs from the advisory's area; `notes` say how.
- `geometry`: Natural Earth countries by ISO code, optionally one polygon `part` containing a point, `exclude` points whose parts are dropped, and `maxLng` to clip at a meridian; or a marine polygon by name. Rings are simplified at 0.05° and parts under 0.05 square degrees are dropped.

## Zones (reviewed 9 November 2026)

| Id        | Area                                       | Source                  | Valid until | Levels      | Notes                                                                                          |
| --------- | ------------------------------------------ | ----------------------- | ----------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `ua`      | Ukraine, including Crimea (FIR Simferopol) | CZIB-2022-01R14         | 2027-01-31  | all         | Over-sea parts of FIRs Odesa/Simferopol not modelled.                                          |
| `by`      | Belarus (FIR Minsk)                        | SD-2021-02 / SD-2021-03 | —           | all         | Binding Safety Directive.                                                                      |
| `ru-west` | Russia west of 60°E                        | CZIB 2025-01 R3         | 2027-01-31  | all         | Kaliningrad and Crimea excluded (other FIRs).                                                  |
| `ru`      | Russia                                     | Rosaviatsia, 2022-02-28 | —           | all         | EU/EEA airlines only (`easa`).                                                                 |
| `ir`      | Iran (FIR Tehran)                          | CZIB-2026-04-R2         | 2026-11-16  | all         |                                                                                                |
| `iq`      | Iraq (FIR Baghdad)                         | CZIB-2026-05-R2         | 2026-11-16  | all         |                                                                                                |
| `lb`      | Lebanon (FIR Beirut)                       | CZIB-2026-06-R2         | 2026-11-16  | all         | Beirut flights start/end inside: reported as not guaranteed.                                   |
| `gulf`    | Persian Gulf waters                        | CZIB-2026-07R3          | 2026-11-16  | all         | Gulf-state airports exempt.                                                                    |
| `oman`    | Gulf of Oman west of 58°E                  | CZIB-2026-07R3          | 2026-11-16  | all         |                                                                                                |
| `sy`      | Syria (FIR Damascus)                       | CZIB-2017-03R20         | 2026-11-30  | all         | Approximate: whole FIR, because the all-levels line's waypoints have no published coordinates. |
| `sd`      | Sudan (FIR Khartoum)                       | CZIB-2023-01R8          | 2027-01-31  | all         |                                                                                                |
| `ye`      | Yemen (FIR Sana'a)                         | CZIB-2017-07R20         | 2027-04-30  | all         | Approximate: territory only; maritime routes east of B400 are caution only.                    |
| `af`      | Afghanistan (FIR Kabul)                    | CZIB-2017-08R19         | 2027-01-31  | below FL320 |                                                                                                |
| `ly`      | Libya (FIR Tripoli)                        | CZIB-2017-02R20         | 2027-01-31  | below FL320 | Caution above FL320.                                                                           |
| `so`      | Somalia (FIR Mogadishu)                    | CZIB-2017-05R20         | 2027-04-30  | ≤ FL260     |                                                                                                |
| `ml`      | Mali                                       | CZIB-2017-01R21         | 2027-04-30  | below FL260 |                                                                                                |

Not modelled (also listed in the JSON): **Saudi Arabia** CZIB-2026-09-R1 (its no-fly part of FIR Jeddah is bounded by waypoints RIBOK–…–SILPA and ULBAM–…–SOLAT whose coordinates the bulletin does not publish; the rest is caution only), **Jordan** CZIB-2026-08-R3 (caution only), **Pakistan** CZIB-2018-02R21 (Baluchistan and Khyber Pakhtunkhwa below FL260; no province boundaries are bundled) and the land areas of the Gulf FIRs in CZIB-2026-07R3 (caution only). Caution-only advisories never cause detours.

## How detours are found

1. **Applicability**: date, operator group, level limit and exemptions select the zones for a flight. An airport inside a zone (by its outline, or in that country with its cell touching the zone, for coastal airports outside simplified coastlines) makes that zone unavoidable for the flight: the flight is marked **not guaranteed** and every other zone is still avoided.
2. **Crossing test**: the great circle is sampled every 0.1° against the zones' outlines. No crossing keeps the great circle unchanged.
3. **Search**: zones are rasterised once onto a 0.5° grid (a cell blocks when a zone covers any part of it). A* over 16 directions wraps across the antimeridian and over the poles; airports' own cells stay open.
4. **Shape**: string-pulling and tightening reduce the cell path to a few great-circle arcs that hug the blocked cells (margins of 0–55 km from the outlines), and every corner is rounded so routes bend instead of kinking: over about 5% of the route on each side (200–500 km), shrinking where a corridor is tight. A spherical Bézier inside the corner is tried first, then a curve through the corner that bulges away from the zone it hugs, each checked against the grid and then against the outlines. Curves are sampled so no vertex turns by more than about 4°, and straight stretches are densified to ≤ 1° steps.
5. **Validation**: the final path is checked against the outlines every 0.1°; failing that, the unrounded path is tried. A missing path, a failed check or a detour longer than 2.2 × the great circle + 500 km keeps the great circle and marks the flight **not guaranteed**.

The routed length replaces the great-circle distance for the flight-time estimate, playback, the drawn arc, framing and totals. Results are cached per airport pair, day and operator. Territorial waters (12 nm), FIR boundaries over the sea and airways are not modelled.

## Updating

1. Open the [CZIB index](https://www.easa.europa.eu/en/domains/air-operations/czibs) and each bulletin. Update `reviewed`, every zone's `reference`, `url`, `revised` and `validUntil`, add new all-level "should not operate" areas as zones and move withdrawn ones out. Record level limits, exemptions and approximations.
2. Prefer country and marine polygons; use `part`, `exclude` and `maxLng` before adding anything custom. Do not invent coordinates: if an area cannot be located from published data, list it under `notModelled` with the reason.
3. Run `npm run airspace:build` (add `--offline` with a warm cache), `npm test` and check a few affected routes in the app.
4. Mention the review in `RECENT_CHANGES.md`. Data-only refreshes ship as patch releases.

Review whenever any `validUntil` passes: an expired bulletin silently stops applying.
