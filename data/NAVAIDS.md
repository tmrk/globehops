# Radio navaids

GlobeHops uses public-domain [OurAirports navaids.csv](https://davidmegginson.github.io/ourairports-data/navaids.csv) to resolve radio-navaid identifiers in pasted flight plans. OurAirports supplies no accuracy guarantee. This is a route visualisation aid, **not for navigation**; positions, status and operational availability may be wrong or outdated.

Run `npm run navaids:build`. The script uses `.cache/ourairports/navaids.csv` when present, downloads it when absent, and supports `-- --offline` (require the cache) and `-- --refresh` (download again). These flags are mutually exclusive. No dependency or API key is needed. Validation precedes atomic writes to `src/data/generated/navaids.json` and `data/navaids-build.json`; never edit generated files. Raw source CSVs and caches are not committed.

The runtime format is `{ format: 1, meta, navaids }`. Tuples are `[ident, typeCode, latitude, longitude, country]`, rounded to five decimal places. Type codes: `V` VOR, `R` VOR-DME, `T` VORTAC, `A` TACAN, `N` NDB, `B` NDB-DME, `D` DME. Identifiers are uppercase; duplicate identifiers at different locations are retained. Invalid coordinates, identifiers, country codes, unsupported types and identical tuples are excluded. The build record contains the source URL/description, SHA-256, UTF-8 bytes, rows, counts per type, exclusions and a deterministic content hash independent of build time.

The generated dataset has 11,007 aids: 364,472 bytes of compact JSON, 134,231 bytes gzip. `decodeNavaids` validates it and builds a `byIdent` map. `loadNavaids(url)` loads a caller-supplied local asset URL; the importer itself performs no fetches. There is no UI integration or automatic dataset loading in the parsing core.

There is no openly licensed worldwide fix/airway database bundled with this project. Five-letter fixes and NAT tracks are reported unresolved. Airways and SID/STAR procedures are reported as direct approximations between the resolved neighbours. The dataset contains no airway connectivity, procedure legs, frequencies, service status, terrain or operational suitability evidence. A flight plan with intermediate airports remains a single path.

For repeated radio identifiers the parser minimises detour from the preceding resolved point towards the destination, rejecting candidates more than 1,500 km from that great-circle segment. Nearby competing interpretations produce an `ambiguous_waypoint` warning. This geometric heuristic cannot establish the intended route.

The parser supports ICAO degree/minute coordinates and ARINC quadrant shorthand (`5040N` = 50°N 040°W; `50N40` = 50°N 140°W), plus `H5060` = 50°30′N 060°W half-degree shorthand. See the [FAA oceanic guidance](https://www.faa.gov/air_traffic/publications/atpubs/ntap_jan_18/part3_section2_int.html). Coordinate decoding does not make these plans suitable for navigation.

# Parsing core

`src/lib/import/index.ts` exports `detectFormat`, `looksLikeRoute`, async `importRoute`, `groupFlights`, `MAX_IMPORT_FLIGHTS` (54) and the typed result/context/options/issue interfaces. Imports are local, dependency-free and DOM-free in both browsers and native Node TypeScript. Pass the airport dataset and exact code lookup; the radio dataset is optional. `link` and `document` belong to other integrations and return `unsupported` here.

Geometry, order, elevations and usable timestamps are retained, with unit conversion only. Invalid positions are counted; backwards timestamps become null. Zone-less ISO timestamps are UTC. `stats.points` counts valid source points read (including redundant KML trails or paths beyond the flight cap); `droppedPoints` counts invalid source positions. Warning/error codes and scalar parameters are intended for localisation, with English messages for agents.

Each output path is matched to airports without moving its vertices. Recorded paths split at stationary coverage gaps or intervening ground phases; grouping then uses airport continuity only. Each journey holds at most nine flights, and at most six journeys are returned. Overflow is counted, never merged across an open jaw.

Input limits are 20 MiB and 250,000 source points, including invalid points. KMZ extraction validates ZIP bounds, uncompressed size and CRC32, with bounded streaming decompression. Stored and raw-DEFLATE entries are supported; encrypted, multi-disk and ZIP64 archives are unsupported. Raw DEFLATE requires `DecompressionStream('deflate-raw')`. XML DTD/entity declarations are rejected, and custom entities are never resolved. The XML reader uses an iterative stack, including for deeply nested documents.

KML timed point Placemarks form a recorded sequence. A LineString with the same ordered vertices as that sequence is treated as a redundant Trail; unrelated lines remain separate flights. Duplicate detection compares exact coordinates in order and does not interpolate or alter paths. Multiple timed point sequences without an explicit separation are one sequence, then use the shared ground-stop splitting rules.
