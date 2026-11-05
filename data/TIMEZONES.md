# Airport time zones

`src/data/generated/timezones.json` is a separate **ODbL-1.0 Derivative Database** mapping stable
OurAirports numeric IDs to IANA time-zone names. It does not change the public-domain licence of
`airports.json`. The browser loads only this compact table, never the boundary polygons.

## Pinned source and rebuilding

- Source: [timezone-boundary-builder 2026f](https://github.com/evansiroky/timezone-boundary-builder/releases/tag/2026f),
  comprehensive land zones, `timezones.geojson.zip` (not the reduced “1970”, “now”, or ocean variants).
- [Pinned download](https://github.com/evansiroky/timezone-boundary-builder/releases/download/2026f/timezones.geojson.zip).
- ZIP SHA-256: `2d160501c844d382233f30b0cd0db2533fe17f93a118a3d38959fe73e3ac20c3`.
- Downloaded ZIP: 52,008,272 bytes. Its only entry is `combined.json`, 172,662,670 bytes uncompressed,
  using ordinary ZIP deflate (version 2.0); ZIP64 is unnecessary. The reader rejects ZIP64, encryption,
  multipart archives, ambiguous JSON entries, invalid bounds, incorrect sizes and CRC-32 mismatches.
- Cache: `.cache/timezones/2026f/timezones.geojson.zip` (gitignored). Cached and downloaded bytes must
  match the digest; a mismatch fails, without automatically trusting a replacement asset.

```sh
npm run timezones:build             # reuse cache; download if absent
npm run timezones:build -- --offline # require cache; no network
npm run timezones:build -- --refresh # redownload and verify pinned bytes
```

Node 22.18+ is required. The implementation uses only Node built-ins and repository modules.
No system ZIP executable or GIS dependency is required. Source downloads retry transient failures.
The daily airport workflow caches `.cache/timezones` under `tz-2026f` and rebuilds the time-zone
table whenever `data:update` reports `CHANGED=true`, before tests, build and the existing commit/deploy steps.

Each build decodes the airport dataset with `decodeDataset`, validates the GeoJSON, constructs
per-polygon bounds and performs even-odd longitude/latitude ray casting, including holes. TBB
polygons are already split at ±180°; queries handle both representations of the date line without
mistaking a broad polar polygon for a small polygon that crosses it. Bounds prune irrelevant polygons.

Assignment order is polygon containment, then the nearest polygon edge within 30 km, then an explicit
override. Edge distances use a sphere of radius 6,371.0088 km and the minor great-circle segment,
including endpoints and hole edges. This is a geographic fallback, not a guarantee of an airport's
operational clock. Equal-distance ties (within 1 nanometre) and overlapping polygon zones choose the
lexicographically first zone, independent of source feature order. All overlaps, nearest assignments,
used overrides and unused overrides are recorded in `data/timezones-build.json`.

Coverage must be 100%; unresolved airports fail with their IDs, codes and coordinates. Every assigned
zone must be accepted by Node's `Intl.DateTimeFormat`, and all 30 requested IATA sentinels are checked.
All requested sentinel names match TBB 2026f exactly, including `Asia/Kolkata`, `Asia/Kathmandu`,
`Europe/Istanbul` and `Atlantic/Reykjavik`; there are no renamed-sentinel exceptions.

All validation and the 30 KiB gzip budget check complete before atomic temporary-file/rename writes.
Identical assignments and provenance preserve `generatedAt`; array order and encoding are deterministic.
The one-line build summary includes coverage, fallbacks, overlaps, byte sizes and elapsed time.

## Committed build (5 November 2026)

| Measure                                           |                Result |
| ------------------------------------------------- | --------------------: |
| Airports covered                                  |  9,934 / 9,934 (100%) |
| Distinct assigned zones                           |                   387 |
| Polygon assignments                               |                 9,933 |
| Nearest-edge assignments                          |                     0 |
| Manual overrides                                  |                     1 |
| Airports in overlapping zones                     |                    36 |
| Unsupported assigned zones / sentinel mismatches  |                 0 / 0 |
| Generated JSON, raw / gzip                        | 65,799 / 15,241 bytes |
| Real build including fresh download (`--refresh`) |         19.96 seconds |

The generated file is compact JSON ending with a newline. `zones` is sorted lexicographically;
`ids` holds positive deltas of ascending numeric airport IDs (the first is relative to zero),
and `zone` holds dictionary indices. The metadata includes the original `airports.json` content hash.
The build record repeats that metadata and records the ZIP digest and full exception report.

## Override rationale

`data/timezone-overrides.json` contains one entry:

| OurAirports ID | Airport                                               | Assigned zone          | Rationale                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 45059          | SCGC / UGL, Union Glacier Blue-Ice Runway, Antarctica | `America/Punta_Arenas` | Outside TBB land-zone coverage and more than 30 km from a polygon edge. Operator [Antarctic Logistics & Expeditions](https://antarctic-logistics.com/services/camp-services/) states that Union Glacier observes Punta Arenas time, UTC−3. |

The operator's statement supports selecting Punta Arenas as the operational clock. It does not establish
historical timekeeping at the runway before the camp existed; historical `Intl` results follow that IANA zone.
Every future override must retain a nonempty, sourced reason, and receive an explanation here.

## Known ambiguity and runtime behaviour

Contrary to an assumption that the source has no overlaps, TBB deliberately includes them.
Its [2026f expected-overlap definitions](https://github.com/evansiroky/timezone-boundary-builder/blob/2026f/expectedZoneOverlaps.json)
explicitly list Xinjiang's dual timekeeping and Abkhazia's competing zones. The committed table chooses:

- `Asia/Shanghai` over `Asia/Urumqi` for 34 airports in Xinjiang.
- `Asia/Tbilisi` over `Europe/Moscow` for UG0U (ID 3086) and UGSS (ID 3092).

These are deterministic dataset choices, not a claim that the lexicographic winner is the operational
clock everywhere in a disputed region. The report retains both candidates for every affected airport.
Changing this policy or adding an operational-clock preference needs a separately justified decision.

`decodeTimeZones` strictly checks format, metadata, counts, sorted unique names, positive safe ID deltas,
dictionary indices and complete use of the dictionary. It deliberately does not compare the stored
airport hash to a separately loaded dataset and does not reject an entire table because an older browser
has an older tzdb. Build-time Node validates actual zone support; runtime time conversion can report a
specific unsupported zone. `zoneForAirport(null, airport)` and unknown IDs return `null`, so a newer
airport dataset can still support route editing while its time-zone table catches up. The committed
coverage test does check that both generated files correspond to the same airport hash.

## Attribution and database licence

Contains information from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder),
which is made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/);
boundaries derived from OpenStreetMap © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

The upstream project distinguishes its MIT-licensed build code from its ODbL-licensed output data
in its [licence statement](https://github.com/evansiroky/timezone-boundary-builder/tree/2026f#licenses).
This generated airport-to-zone database is offered under **ODbL-1.0**, separately from application code
and the OurAirports database. In particular, ODbL sections 4.2–4.4 require retaining attribution and
licence notices and sharing publicly used Derivative Databases under ODbL (or an allowed compatible
licence). Section 4.6 requires offering the derivative database in machine-readable form, or the specified
alterations/method. The committed JSON and public generated asset provide the derivative database;
the build scripts, pinned source and documented override explain its construction.

Publicly used outputs also need an associated attribution and licence link (section 4.3). The generated
metadata carries the requested attribution, and this document carries source and licence links.
Integration owners must add these to the app's visible credits and the central `docs/DATA_SOURCES.md`
and `THIRD_PARTY_NOTICES.md`; those files are outside Task A's permitted edits.
