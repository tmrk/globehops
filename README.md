# GlobeHops

**See any air journey as it really curves around the Earth.** GlobeHops draws your flights as great-circle routes on an interactive 3D globe, with distances, estimated flight times and layovers for every connection.

**[Open GlobeHops → tmrk.github.io/globehops](https://tmrk.github.io/globehops/)**

It runs in any modern browser on phones, tablets and desktops. There is nothing to install and no account to create.

![GlobeHops on a desktop: a Copenhagen–London–New York journey on the globe, with the journey panel on the left](docs/screenshot.png)

<img src="docs/screenshot-mobile.png" alt="GlobeHops on a phone: the globe above, the journey panel below" width="300">

## What you can do

- **Find airports** by city, airport name, IATA or ICAO code, or alternative names. Accents are optional: “malmo” finds Malmö.
- **Plan up to ten stops.** Insert, remove, drag or use the keyboard to reorder them, or reverse the whole journey.
- **Explore the globe.** Drag to rotate and scroll or pinch to zoom; arrow keys and +/− work too. Select a flight in the list or on the globe to fly to it. Routes too wide for one view can be stepped through flight by flight.
- **Set layovers.** Each connection starts at 1h 30m. Change it under the connecting airport, from 30 minutes to three days.
- **Show or hide country borders** with the button on the globe. They are on by default.
- **Switch kilometres and miles.** The journey totals show distance, time in the air, layovers and the overall journey time.
- **Share the journey.** The page address always holds the current route, so you can bookmark it or send it to someone. The Share button copies it or opens your device’s share sheet.

### Route links

Routes use airport codes separated by hyphens: [`?route=CPH-LHR-JFK`](https://tmrk.github.io/globehops/?route=CPH-LHR-JFK). A layover different from the default follows its airport in minutes, e.g. [`?route=LHR-DXB_240-SIN-SYD`](https://tmrk.github.io/globehops/?route=LHR-DXB_240-SIN-SYD) for four hours in Dubai. Unknown codes are reported and skipped. Without a route in the address, GlobeHops reopens your last journey in that browser.

## How the numbers are worked out

- **Distance** is the shortest great-circle path on a spherical Earth (mean radius 6,371.0088 km). Real flights often deviate because of winds, air-traffic control, weather and restricted airspace.
- **Flight time** is an estimate, not a schedule: distance at an average 850 km/h plus 30 minutes for take-off, climb, approach and landing, rounded to five minutes.
- **Total time** adds the layover at each connection to the flight times.
- **The arcs** follow a simplified flight profile. Each flight climbs to a typical cruising altitude of about 11 km over roughly 20 minutes, holds it, and descends over about the last 25 minutes. Flights too short to reach cruise peak lower. Height is exaggerated 12× so it is visible on the globe. The dashed line beneath each arc is the ground track.

## Privacy

GlobeHops has no accounts, cookies, analytics or backend. Your route lives only in the page address and in your browser’s local storage, together with your unit and border preferences. All maps, data and fonts are served with the site.

## Sources and credits

- **Earth imagery:** [Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/), July 2004 composite with topography and bathymetry. Credit: NASA Earth Observatory (Reto Stöckli, NASA GSFC). It is a cloud-free composite, not a live view. GlobeHops is not affiliated with or endorsed by NASA.
- **Airports:** [OurAirports](https://ourairports.com/data/), public domain. The airport list is checked for updates daily.
- **Country borders:** [Natural Earth](https://www.naturalearthdata.com/) 1:50m Admin 0 boundary lines (land), version 5.1.2, public domain. Natural Earth shows de facto boundaries; their depiction implies no position on any territorial dispute.
- **Typefaces:** Geist and Geist Mono by Vercel, under the SIL Open Font License 1.1.
- **Software:** built with [React](https://react.dev/) and [Three.js](https://threejs.org/), both MIT licensed.

How each source is selected, processed and licensed is documented in [data sources](docs/DATA_SOURCES.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Licence

The GlobeHops code is [MIT licensed](LICENSE). Imagery, data and fonts keep their own terms, listed above.
