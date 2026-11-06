# Data sources and licences

## Earth imagery

Source: [NASA Blue Marble Next Generation with topography and bathymetry](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/), July 2004 composite. The source is `world.topo.bathy.200407.3x21600x10800.jpg`, a 21,600 × 10,800 equirectangular JPEG. [Direct download](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg).

Credit: **NASA Earth Observatory (Reto Stöckli, NASA GSFC)**.

NASA-produced imagery is generally not subject to copyright in the United States; acknowledgement is requested under the [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). NASA logos and identifiers have separate restrictions. GlobeHops uses no NASA logo and implies no NASA endorsement. These imagery terms are separate from the code’s MIT licence.

`scripts/build-textures.ts` resamples with Lanczos3 to 8192 × 4096, 4096 × 2048 and 1024 × 512 and encodes WebP (quality 80, 82 and 72 respectively). There are no colour edits or content changes. Only the generated WebP files are committed. The imagery is a historical, cloud-free composite, not current satellite coverage.

## City lights

Source: NASA Earth Observatory [Earth at Night (Black Marble) 2016 colour maps](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/), `BlackMarble_2016_3km.jpg`, a 13,500 × 6,750 equirectangular JPEG composited from Suomi NPP VIIRS day/night band data. [Direct download](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg) (SHA-256 `230aac448ae68c358be433dd518888cccb3a85ccf66f7b44326441c324ad6725` as downloaded on 2026-11-06).

Credit: **NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA's Goddard Space Flight Center.** The same NASA imagery terms as above apply.

`scripts/build-textures.ts` resamples with Lanczos3 to 4096 × 2048 and 2048 × 1024, then `scripts/lib/lights.ts` turns each RGB pixel into a single light value: red minus 0.55 × blue, minus 2, scaled so that 110 is full brightness. This removes the bluish moonlit land, ice and ocean of the composite and keeps the warm-white lights. The masks are WebP (`lights-4k.webp` quality 75, about 143 KB; `lights-2k.webp` quality 80, about 44 KB). The globe shader tints them warm and shows them only on the night side. Lights reflect 2016 and are not live.

## Airport data

[OurAirports downloads](https://ourairports.com/data/) are released to the public domain without accuracy guarantees. Source repository: [davidmegginson/ourairports-data](https://github.com/davidmegginson/ourairports-data); [data dictionary](https://ourairports.com/help/data-dictionary.html).

Inputs are [airports.csv](https://davidmegginson.github.io/ourairports-data/airports.csv), [countries.csv](https://davidmegginson.github.io/ourairports-data/countries.csv) and [regions.csv](https://davidmegginson.github.io/ourairports-data/regions.csv).

Fields used: airport `id`, `ident`, `type`, `name`, `latitude_deg`, `longitude_deg`, `iso_country`, `iso_region`, `municipality`, `scheduled_service`, `icao_code`, `iata_code`, `gps_code` and `keywords`; country/region `code` and `name` provide display dictionaries. Frequencies, runways, comments and navaids are not downloaded.

Selection and cleaning in `scripts/lib/dataset.ts`:

- Exclude closed airports and balloonports. Retain valid IATA-coded records, scheduled service, or large/medium airports, including unscheduled ones. Eligible heliports/seaplane bases remain searchable.
- Drop invalid/out-of-range coordinates, the (0,0) placeholder and empty names. Reject invalid IDs, identities, types and duplicate numeric IDs.
- Leave out records listed in `data/excluded-airports.json`: upstream airports whose recorded position is demonstrably wrong (each entry states the evidence). Currently two: Ulleung, South Korea (KR-1113, recorded in Inner Mongolia) and a “(Misplaced duplicate?)” Venezuelan record in Chad (VE-0526). The time-zone build's country plausibility check finds such records; see [airport time zones](../data/TIMEZONES.md#country-plausibility-check).
- Trim/collapse whitespace, uppercase valid IATA/ICAO codes and use a valid four-letter GPS code if ICAO is unavailable. Round coordinates to four decimals.
- Keep region names for US, CA and AU; use country names for all records.
- Resolve duplicate IATA/ICAO codes deterministically by scheduled service, airport type (large → medium → small → seaplane → heliport), ICAO presence, then lowest numeric ID. Clear losing codes but retain them as keywords.
- Merge upstream keywords with local aliases; normalise for deduplication, remove repeated names/codes, cap at 12 keywords and 60 characters per keyword. Sort output by numeric ID; sort dictionaries by code.

Validation requires expected columns, consistent CSV row widths and at least 50,000 airport, 200 country and 3,000 region rows. Output must contain at least 8,000 airports and at least 90% of the previous count. Twenty sentinel airports must exist within 0.2° of their expected coordinates. Validation finishes before any cache/output writes; generated files are replaced through temporary-file renames.

`data/airports-build.json` records generation time, optional upstream commit, each input’s SHA-256, bytes, Last-Modified value and row count, plus output counts and content hash. A changed content hash triggers regeneration; unchanged data keeps its previous record. The current record has a null upstream commit and Last-Modified values, so it does not establish a precise upstream revision. Cached inputs can reproduce the content via `--offline`.

Local aliases belong in `data/aliases.json`, with a reason for each in `data/ALIASES.md`; currently the alias map is empty. Prefer upstream names/keywords and shared accent normalisation. Ranking uses match quality plus scheduled service, size, code presence and the short, commented primary-airport list in `src/data/rankHints.ts`. OurAirports provides no traffic figures; these hints are a maintained ordering aid, not measured traffic data.

## Time zones

Source: [timezone-boundary-builder (TBB) 2026f](https://github.com/evansiroky/timezone-boundary-builder/releases/tag/2026f), comprehensive land-zone [timezones.geojson.zip](https://github.com/evansiroky/timezone-boundary-builder/releases/download/2026f/timezones.geojson.zip). The ZIP is pinned to SHA-256 `2d160501c844d382233f30b0cd0db2533fe17f93a118a3d38959fe73e3ac20c3`; both cached and downloaded bytes must match.

Contains information from timezone-boundary-builder, made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/); boundaries derived from OpenStreetMap © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). TBB's build code is MIT; its output data is ODbL. Retain source/licence attribution, attribute publicly used outputs and share publicly used derivative databases under ODbL, with machine-readable access as required by sections 4.2–4.6.

GlobeHops offers its derivative airport-to-zone database, [src/data/generated/timezones.json](../src/data/generated/timezones.json), under **ODbL-1.0**. It stays separate from public-domain `airports.json` and MIT application code. The committed JSON and deployed hashed asset provide the machine-readable database; scripts, provenance and overrides document its construction. Preserve visible credits and licence links when reusing the data.

`scripts/build-timezones.ts` verifies/extracts the ZIP and looks up each decoded airport coordinate against polygon bounds and rings, including holes. If containment fails, the nearest polygon edge within 30 km is used; a sourced override is the final fallback. Assignment fails if any airport remains unresolved. Node `Intl` zone support, 30 sentinels and a 30 KiB gzip budget are checked before output writes. The browser downloads only the compact ID/zone dictionary, never the polygons. Historical offsets and DST rules come from runtime `Intl`, independently of the TBB release.

The committed build covers **9,934/9,934 airports in 387 zones**, with no nearest-edge fallbacks and one override: Union Glacier (UGL/SCGC) uses `America/Punta_Arenas`, supported by its [operator's timekeeping statement](https://antarctic-logistics.com/services/camp-services/). This does not establish historical timekeeping before the camp existed.

TBB includes overlapping zones in disputed or dual-timekeeping areas. GlobeHops chooses the lexicographically first containing zone, independent of feature order; equal nearest-edge distances use the same tie-break. The 36 recorded overlaps select `Asia/Shanghai` over `Asia/Urumqi` at 34 Xinjiang airports, and `Asia/Tbilisi` over `Europe/Moscow` at UG0U/UGSS. These choices do not establish the operational clock or take a position on territorial claims. Every overlap and fallback is recorded in `data/timezones-build.json`; method, coverage, ambiguity and sourced override rationale are in [data/TIMEZONES.md](../data/TIMEZONES.md). Regenerate with `npm run timezones:build`; never hand-edit the table.

## Solar position

`src/lib/sun.ts` implements low-precision apparent solar coordinates using [NOAA's Meeus-based equations](https://gml.noaa.gov/grad/solcalc/calcdetails.html), including declination, obliquity and equation of time. Julian day is calculated directly from epoch milliseconds. Geometric elevation excludes atmospheric refraction; daylight labels use −0.833° and −6° thresholds. The renderer uses the subsolar direction for continuous shading. `sun.ts` defines a shared CPU/GLSL curve for surface and atmosphere, with midpoint −0.833°, civil/nautical/astronomical stops at −6°/−12°/−18° and full daylight at +3°. City lights fade in from −3° to −6°; a roughly 6% night floor preserves visibility. Brightness is illustrative and does not model weather or terrain; there is no downloaded lighting-position dataset.

Independent tests use MIT-licensed [astronomy-engine](https://github.com/cosinekitty/astronomy), **only in tests**, to check subsolar coordinates across 1900–2100 and scene alignment. Coordinate tests require errors below 0.005° declination and 0.02° longitude; topocentric elevation comparisons allow 0.02°. These are numerical test tolerances, not guarantees of observed sunrise or sunset: atmospheric conditions and the illustrative shader are outside that accuracy claim. See [time and simulation](TIME_AND_SIMULATION.md).

## Country borders

Source: [Natural Earth](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-boundary-lines/) 1:50m Cultural Vectors, **Admin 0 – Boundary Lines (land)**, version 5.1.2, read as GeoJSON from the pinned [natural-earth-vector v5.1.2 tag](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_50m_admin_0_boundary_lines_land.geojson).

Natural Earth vector and raster data are in the **public domain** ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/)); no permission is needed and credit is appreciated. Natural Earth depicts de facto boundaries. GlobeHops shows them as a visual reference only and takes no position on territorial disputes.

`scripts/lib/borders.ts` keeps every LineString and MultiLineString part in source order, rounds coordinates to 0.01° (about 1.1 km, finer than the 1:50m source accuracy), drops consecutive duplicate points and delta-encodes each line. Validation rejects out-of-range or non-integer coordinates and requires at least 200 lines and 10,000 points. The committed `src/data/generated/borders.json` holds 392 lines and 19,735 points (about 109 KB, 35 KB gzipped). The browser downloads it only while borders are shown, subdivides steps longer than 0.5° in latitude/longitude (so borders along parallels keep following them) and draws the lines just above the globe surface.

## Coastlines

Source: Natural Earth 1:50m Physical Vectors, **Coastline**, version 5.1.2, from the pinned [GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_50m_coastline.geojson); public domain like the borders. The same `npm run borders:build` run simplifies each line with Douglas–Peucker at 0.02° (about 2 km, below a pixel at the closest zoom) before the same quantisation and delta encoding. Validation requires at least 1,000 lines and 25,000 points. The committed `src/data/generated/coastlines.json` holds 1,427 lines and 35,180 points (about 219 KB, 79 KB gzipped). It is shown and hidden with the borders, drawn fainter.

## Country, ocean and sea names

Sources: Natural Earth v5.1.2 1:50m **Admin 0 – Countries** ([pinned GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson)) and **Geography – Marine Polygons** ([pinned GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_geography_marine_polys.geojson)). Natural Earth vectors are **public domain** ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/)); localised names come from **Wikidata, CC0** ([licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)). Names/boundaries are a cartographic reference, including Natural Earth's de facto treatment of disputed areas.

`npm run labels:build` reads both pinned sources from `.cache/naturalearth/` (or downloads when missing), with `--offline`, `--refresh` and optional country/marine source paths. The format-2 tuples in `src/data/generated/country-labels.json` contain kind, English/Hungarian/Swedish names, label point, minimum zoom and rank: **242 countries, 7 ocean regions and 72 seas/bays/gulfs/selected channels/straits**, 22,458 bytes (7,731 gzipped). Never hand-edit the generated file.

Countries use `NAME`/`NAME_HU`/`NAME_SV`, Natural Earth's label points, `MIN_LABEL` and `LABELRANK`. Seas use the largest polygon with longitude unwrapping, holes and cos(latitude)-scaled equirectangular projection; best-first subdivision finds a pole of inaccessibility. Seven ocean points and the Mediterranean point are hand-placed in open water for composition. All rounded marine points must remain inside their source polygons. Marine selection, zoom calibration, language review and every correction/abbreviation/point override are documented in [data/PLACE_NAMES.md](../data/PLACE_NAMES.md); the editable source is `data/place-names.json`.

The entire layer defaults off and downloads on first use of the “Place names” toggle. Oceans use larger blue italic caps, seas smaller blue italics. Visibility fades at minimum zoom and near the limb; labels yield to airport labels/dots, with countries ahead of equal-rank seas. Locale changes reuse the download and clear cached text metrics. The preference retains `globehops:countryNames` in local storage for compatibility; links may temporarily override it with `names=1` or `names=0` without changing the saved choice.

## Airport city exonyms

Source: Natural Earth v5.1.2 1:10m **Populated Places**, 7,342 points ([pinned GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places.geojson)), public domain; `NAME_HU`/`NAME_SV` are Wikidata-derived CC0 names. OurAirports municipalities/country codes and positions provide the matching targets.

`npm run places:build` uses the same cache/`--offline`/`--refresh` conventions and an optional source path. Exact normalised names/aliases, same-country checks and an airport within 75 km are required; ambiguous matches are skipped. The format-1 `src/data/generated/city-names.json` contains only changed hu/sv city names, keyed by original `city|CC`: **870 Hungarian / 471 Swedish entries**, 37,651 bytes (13,889 gzipped). Automatic matching covers 3,495 city strings and 54.3% of scheduled-service airports. It preserves London, Ontario separately from London, UK. Four documented hub overrides use the owner's requested service-city names; English retains OurAirports display semantics.

`I18nProvider` lazily loads the city asset on first hu/sv use; English makes no city-table request. `fmt.city()` localizes UI city text and App memoises a search index with additive exonyms, preserving original-name matches. Missing translations or a failed load retain the current city display. Airport proper names and English agent outputs remain unchanged. All overrides, provenance, matching limits and the reviewed Swedish Kyjiv spelling are in [data/PLACE_NAMES.md](../data/PLACE_NAMES.md). Never hand-edit the generated dictionaries.

## Fonts

Barlow by Jeremy Tribby (weights 400–700) and Martian Mono by Evil Martians (variable weight and width) are bundled through `@fontsource/barlow` and `@fontsource-variable/martian-mono`. Both installed package manifests declare **OFL-1.1** (SIL Open Font License 1.1). Only the Latin, Latin Extended and Vietnamese subsets that a page actually uses are downloaded. The font licence text is in each package’s `LICENSE`; these terms remain separate from the project code licence. See [third-party notices](../THIRD_PARTY_NOTICES.md).
