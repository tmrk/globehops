# Third-party notices

The GlobeHops code is MIT licensed; bundled libraries, fonts and source content retain their own terms. The package licences below were checked against the installed `node_modules/<package>/package.json` manifests. Full licence texts are in the respective packages.

| Runtime package                     | Installed version | Licence | Copyright / source                                                                      |
| ----------------------------------- | ----------------- | ------- | --------------------------------------------------------------------------------------- |
| `react`                             | 19.3.1            | MIT     | Meta Platforms, Inc. and affiliates; [React](https://github.com/facebook/react).        |
| `react-dom`                         | 19.3.1            | MIT     | Meta Platforms, Inc. and affiliates; [React](https://github.com/facebook/react).        |
| `scheduler` (transitive)            | 0.28.0            | MIT     | Meta Platforms, Inc. and affiliates; [React](https://github.com/facebook/react).        |
| `three`                             | 0.187.0           | MIT     | Three.js authors; [Three.js](https://github.com/mrdoob/three.js).                       |
| `@fontsource/barlow`                | 5.3.0             | OFL-1.1 | Barlow by Jeremy Tribby; [Fontsource](https://fontsource.org/fonts/barlow).             |
| `@fontsource-variable/martian-mono` | 5.3.0             | OFL-1.1 | Martian Mono by Evil Martians; [Fontsource](https://fontsource.org/fonts/martian-mono). |

Earth textures derive from NASA Blue Marble Next Generation, July 2004, with topography and bathymetry. Credit: **NASA Earth Observatory (Reto Stöckli, NASA GSFC)**. NASA imagery is generally not subject to US copyright; acknowledgement is requested and no NASA endorsement is implied. See the [NASA source](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/) and [media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).

City lights derive from NASA Earth Observatory's Earth at Night (Black Marble) 2016 colour composite (`BlackMarble_2016_3km.jpg`). Credit: **NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA's Goddard Space Flight Center**. The same NASA imagery terms apply; see the [NASA source](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/). GlobeHops converts it to a night-light mask (see [data sources](docs/DATA_SOURCES.md)).

Country borders and coastlines derive from [Natural Earth](https://www.naturalearthdata.com/) 1:50m Admin 0 boundary lines (land) and 1:50m coastline, v5.1.2, which are in the public domain ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/)). Made with Natural Earth.

Country names derive from Natural Earth 1:50m **Admin 0 – Countries**, v5.1.2, from the pinned [GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson), in the **public domain** ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/)). The generated layer extracts cartographic short names, label coordinates, minimum zooms and label ranks; “United States of America” is shortened to “United States”. It contains 242 labels (7,621 bytes; 3,628 bytes gzipped). Made with Natural Earth.

Airport content derives from [OurAirports](https://ourairports.com/data/), released to the public domain without an accuracy guarantee. Source provenance, cleaning rules and texture modifications are documented in [DATA_SOURCES.md](docs/DATA_SOURCES.md). Local UI icons and logo are drawn in the project’s SVG components.

## Optional usage statistics

With the visitor's consent only, the deployed site loads Google Analytics 4 (`gtag.js`) from `www.googletagmanager.com`, a service of Google LLC under the [Google Analytics Terms of Service](https://marketingplatform.google.com/about/analytics/terms/us/) and [Google's privacy policy](https://policies.google.com/privacy). It is not bundled, contains no GlobeHops data beyond the bare page address, and never runs on local builds or forks. See [README › Privacy](README.md#privacy).

## Time-zone database

Contains information from [timezone-boundary-builder 2026f](https://github.com/evansiroky/timezone-boundary-builder/releases/tag/2026f), which is made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Boundaries derived from OpenStreetMap © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

The derivative airport-to-IANA-zone database in [src/data/generated/timezones.json](src/data/generated/timezones.json) is offered under **ODbL-1.0**. Attribution, licence notices, share-alike and machine-readable availability obligations apply to this database and its public use. It is separate from public-domain OurAirports data and MIT code. TBB's MIT build-code licence does not replace its output-data licence. Pinned source digest, construction, overrides and overlap decisions are documented in [data/TIMEZONES.md](data/TIMEZONES.md) and [data sources](docs/DATA_SOURCES.md).

## Development, tests and local MCP

These packages are declared as development dependencies and are outside the browser bundle. Versions/licences were checked against installed package manifests.

| Package                     | Installed version | Licence | Use / source                                                                                                                              |
| --------------------------- | ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `astronomy-engine`          | 2.1.19            | MIT     | Solar accuracy/alignment tests only; Donald Cross, [Astronomy Engine](https://github.com/cosinekitty/astronomy).                          |
| `ajv`                       | 8.20.0            | MIT     | JSON Schema parity/discovery tests; also a transitive MCP SDK dependency; Evgeny Poberezkin, [Ajv](https://github.com/ajv-validator/ajv). |
| `@modelcontextprotocol/sdk` | 1.32.2            | MIT     | Local stdio MCP adapter and integration tests; Anthropic, PBC, [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).  |
| `zod`                       | 4.6.7             | MIT     | Local MCP input/output schemas; Colin McDonnell, [Zod](https://github.com/colinhacks/zod).                                                |

The installed packages retain their own licence texts. The MCP adapter runs locally in Node; it is not deployed with the static site.
