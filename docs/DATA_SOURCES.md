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

## Fonts

Geist and Geist Mono by Vercel are bundled through `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`. Both installed package manifests declare **OFL-1.1**. The font licence text is in each package’s `LICENSE`; these terms remain separate from the project code licence. See [third-party notices](../THIRD_PARTY_NOTICES.md).
