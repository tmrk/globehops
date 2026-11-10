<p align="center"><img src="public/logo.svg" width="72" height="72" alt=""></p>

<h1 align="center">GlobeHops</h1>

<p align="center"><strong>See any air journey as it really curves around the Earth.</strong></p>

<p align="center"><a href="https://globehops.marki.im/"><strong>Open GlobeHops → globehops.marki.im</strong></a></p>

GlobeHops draws your flights as great-circle routes on an interactive 3D globe, with distances, estimated flight times, layovers and every airport's local time. Add your flight times if you like, press Play and watch the journey unfold across the sunlit and dark sides of the planet. It is free and open source, runs in any modern browser on phones, tablets and desktops, needs no account and works offline once installed as an app.

![GlobeHops on a desktop: a Copenhagen–London–New York journey on the globe, the plane over the Atlantic and city lights on the night side, with the journey panel on the left and the timeline below](docs/screenshot.png)

<p align="center"><img src="docs/screenshot-mobile.png" alt="GlobeHops on a phone: two ways from Budapest to New York compared on the globe, with the shared timeline showing that the direct flight arrives first" width="300"></p>

## What you can do

- **Plan a journey** of up to ten stops. Find airports by city, name or IATA/ICAO code, set each layover, and reorder or reverse the route.
- **Add flight times, or leave them out.** Enter any departure or arrival in the airport's local time; GlobeHops estimates the rest and handles time zones, daylight saving time and the date line.
- **Play it.** One plane flies every leg and waits out each connection in about 15 seconds while the globe fills the screen, lit by the Sun for each moment. Follow the aircraft, scrub the timeline, or watch a dated flight **live**.
- **Round trips and multi-stage trips**, with the stays between journeys kept separate from layovers.
- **Compare** up to four journeys, or whole round trips, on one shared clock.
- **Import a flight path** from GPX, KML/KMZ, GeoJSON, CSV (including Flightradar24), IGC, Garmin FPL, Microsoft Flight Simulator or Little Navmap files, or a pasted flight-plan route. Files are read on your device and never uploaded.
- **Map your booking with AI:** paste a short prompt and your confirmation into any assistant and get back a link with your flights on the globe.
- **Realistic routes** that can curve around restricted airspace (EASA conflict zones) and stay within reach of diversion airports (ETOPS-style), or plain great circles.
- **The Earth at any moment** from 1900 to 2100: day and night, city lights, and the Sun and Moon at their real positions.
- **Share** any journey: the address always holds it. In English, Magyar and Svenska.

The [user guide](docs/USER_GUIDE.md) walks through every feature and explains [how the numbers are worked out](docs/USER_GUIDE.md#how-the-numbers-are-worked-out). Distances and times are estimates, not airline schedules or flight planning.

## Links and AI assistants

Routes live in the address, e.g. [`globehops.marki.im/?route=CPH-LHR-JFK`](https://globehops.marki.im/?route=CPH-LHR-JFK); add times, return flights, comparisons and view options as described in the [link reference](docs/AGENT_INTEGRATION.md#link-reference-v1). Assistants and agents can build links from [`llms.txt`](https://globehops.marki.im/llms.txt), the [capabilities](https://globehops.marki.im/agent/capabilities.json), the [itinerary schema](https://globehops.marki.im/agent/itinerary.schema.json) and a local MCP server; see [agent integration](docs/AGENT_INTEGRATION.md). An old `tmrk.github.io/globehops/…` link opens here once its host is replaced with `globehops.marki.im`.

## Privacy

No accounts and no backend: your journey stays in the page address and your browser's storage, and imported files never leave your device. **My location** is optional and never stored or shared. **Usage statistics** (Google Analytics) load only if you allow them, never receive your airports, dates or times, and are never offered to browsers sending Global Privacy Control or Do Not Track; change your mind any time under About → Privacy.

## Credits

- Earth imagery: NASA [Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/) (Reto Stöckli, NASA GSFC); city lights: NASA [Earth at Night 2016](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/) (Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA GSFC); Moon: NASA SVS [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (LRO/LROC data courtesy of NASA/GSFC/Arizona State University). GlobeHops is not affiliated with or endorsed by NASA.
- Airports, runways and radio beacons: [OurAirports](https://ourairports.com/data/), public domain, checked for updates daily.
- Time zones: derived from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) 2026f. Contains information from timezone-boundary-builder, which is made available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/); boundaries © OpenStreetMap contributors.
- Borders, coastlines and place names: [Natural Earth](https://www.naturalearthdata.com/) 5.1.2, public domain (de facto boundaries, no position on disputes); Hungarian and Swedish names from Wikidata (CC0).
- Restricted airspace: [EASA Conflict Zone Information Bulletins](https://www.easa.europa.eu/en/domains/air-operations/czibs) and safety directives; diversion rules informed by ICAO Annex 6, 14 CFR Part 121 and EASA AMC 20-6. Not affiliated with or endorsed by EASA, ICAO or the FAA.
- Typefaces: [Barlow](https://github.com/jpt/barlow) and [Martian Mono](https://github.com/evilmartians/mono) (SIL Open Font License 1.1). Built with [React](https://react.dev/) and [Three.js](https://threejs.org/).

Details: [data sources](docs/DATA_SOURCES.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Development

```sh
npm ci                                      # Node 22.18+
npm run dev                                 # local app at http://localhost:5173/
npm run lint && npm test && npm run build   # checks and production build in dist/
```

Every push to `main` is tested and deployed to [globehops.marki.im](https://globehops.marki.im/) by Cloudflare Pages; branches and pull requests get preview links. See [development](docs/DEVELOPMENT.md), [deployment](docs/DEPLOYMENT.md), [architecture](docs/ARCHITECTURE.md) and [what's new](RECENT_CHANGES.md).

## Licence

The GlobeHops code is [MIT licensed](LICENSE). Imagery, data and fonts keep their own terms, listed above.
