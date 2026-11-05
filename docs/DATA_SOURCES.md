# Data sources and licences

## Earth imagery

Source: [NASA Blue Marble Next Generation with topography and bathymetry](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/), July 2004 composite. The source is `world.topo.bathy.200407.3x21600x10800.jpg`, a 21,600 × 10,800 equirectangular JPEG. [Direct download](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg).

Credit: **NASA Earth Observatory (Reto Stöckli, NASA GSFC)**.

NASA-produced imagery is generally not subject to copyright in the United States; acknowledgement is requested under the [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). NASA logos and identifiers have separate restrictions. GlobeHops uses no NASA logo and implies no NASA endorsement. These imagery terms are separate from the code’s MIT licence.

`scripts/build-textures.ts` resamples with Lanczos3 to 8192 × 4096, 4096 × 2048 and 1024 × 512 and encodes WebP (quality 80, 82 and 72 respectively). There are no colour edits or content changes. Only the generated WebP files are committed. The imagery is a historical, cloud-free composite, not current satellite coverage.

## Airport data

[OurAirports downloads](https://ourairports.com/data/) are released to the public domain without accuracy guarantees. Source repository: [davidmegginson/ourairports-data](https://github.com/davidmegginson/ourairports-data); [data dictionary](https://ourairports.com/help/data-dictionary.html).

Inputs are [airports.csv](https://davidmegginson.github.io/ourairports-data/airports.csv), [countries.csv](https://davidmegginson.github.io/ourairports-data/countries.csv) and [regions.csv](https://davidmegginson.github.io/ourairports-data/regions.csv).

Fields used: airport `id`, `ident`, `type`, `name`, `latitude_deg`, `longitude_deg`, `iso_country`, `iso_region`, `municipality`, `scheduled_service`, `icao_code`, `iata_code`, `gps_code` and `keywords`; country/region `code` and `name` provide display dictionaries. Frequencies, runways, comments and navaids are not downloaded.

Selection and cleaning in `scripts/lib/dataset.ts`:

- Exclude closed airports and balloonports. Retain valid IATA-coded records, scheduled service, or large/medium airports, including unscheduled ones. Eligible heliports/seaplane bases remain searchable.
- Drop invalid/out-of-range coordinates, the (0,0) placeholder and empty names. Reject invalid IDs, identities, types and duplicate numeric IDs.
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

`src/lib/sun.ts` implements low-precision apparent solar coordinates using [NOAA's Meeus-based equations](https://gml.noaa.gov/grad/solcalc/calcdetails.html), including declination, obliquity and equation of time. Julian day is calculated directly from epoch milliseconds. Geometric elevation excludes atmospheric refraction; daylight labels use −0.833° and −6° thresholds. The renderer uses the subsolar direction for continuous terminator/twilight shading, not a downloaded lighting dataset.

Independent tests use MIT-licensed [astronomy-engine](https://github.com/cosinekitty/astronomy), **only in tests**, to check subsolar coordinates across 1900–2100 and scene alignment. Coordinate tests require errors below 0.05°; the separate topocentric elevation comparison allows 0.1°. These are numerical test tolerances, not guarantees of observed sunrise or sunset: atmospheric conditions and the illustrative shader are outside that accuracy claim. See [time and simulation](TIME_AND_SIMULATION.md).

## Country borders

Source: [Natural Earth](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-boundary-lines/) 1:50m Cultural Vectors, **Admin 0 – Boundary Lines (land)**, version 5.1.2, read as GeoJSON from the pinned [natural-earth-vector v5.1.2 tag](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_50m_admin_0_boundary_lines_land.geojson).

Natural Earth vector and raster data are in the **public domain** ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/)); no permission is needed and credit is appreciated. Natural Earth depicts de facto boundaries. GlobeHops shows them as a visual reference only and takes no position on territorial disputes. Coastlines come from the Earth imagery, not from this layer.

`scripts/lib/borders.ts` keeps every LineString and MultiLineString part in source order, rounds coordinates to 0.01° (about 1.1 km, finer than the 1:50m source accuracy), drops consecutive duplicate points and delta-encodes each line. Validation rejects out-of-range or non-integer coordinates and requires at least 200 lines and 10,000 points. The committed `src/data/generated/borders.json` holds 392 lines and 19,735 points (about 109 KB, 35 KB gzipped). The browser downloads it only while borders are shown, subdivides steps longer than 0.5° in latitude/longitude (so borders along parallels keep following them) and draws the lines just above the globe surface.

## Fonts

Geist and Geist Mono by Vercel are bundled through `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`. Both installed package manifests declare **OFL-1.1**. The font licence text is in each package’s `LICENSE`; these terms remain separate from the project code licence. See [third-party notices](../THIRD_PARTY_NOTICES.md).
