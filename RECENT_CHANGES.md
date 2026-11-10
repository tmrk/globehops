# Recent changes

Every release has a [semantic version](https://semver.org/) (shown in About, and faintly in the bottom-left corner on desktop) and a git tag `v<version>`. Versions up to 1.5.0 were assigned after the fact to the releases below.

## 1.22.1 — 2026-11-10 — A one-line small player

- **The small player stays small.** On phones, the time and the flight's progress beneath the playing journey now share one line instead of breaking onto two.

## 1.22.0 — 2026-11-10 — Cinematic playback and a clearer Play

- **Cinematic playback.** Press Play and everything else steps aside: the planner, the title and the globe tools fade away and the globe fills the screen, with just a small player at the bottom showing what is happening, the time, follow aircraft and a thin line of the journey so far. **Show controls** (or Escape) brings back the full timeline while it keeps playing, and pausing brings back everything. On phones the journey sheet shrinks to the small player, so the flight has nearly the whole screen.
- **A clearer Play.** Play is now an amber sign with a play mark and the word **Play**, like the black-on-yellow signs that point the way through an airport, beside the route and its length. The miniature timeline beneath it shows the aircraft waiting at the start.
- **Less small print.** Lines such as “All trips on one clock” are gone, compared journeys show where they go and how many there are instead, and the note that untimed journeys start together now sits behind the totals' info button.
- **Tidier edges.** The **Import a flight path** and **Map your booking with AI** cards give their icons room inside the outline, and on phones a selected row in the comparison table no longer touches the edges of its highlight.

## 1.21.0 — 2026-11-10 — Import flight paths, one big Play button and a new phone layout

- **Import a flight path.** Show a flight exactly as it was flown or planned: choose **Import a flight path** in the planner, drop a file anywhere on the page or paste a route. GlobeHops reads GPX, KML/KMZ, GeoJSON, CSV (including Flightradar24 exports), IGC logs, Garmin FPL and Microsoft Flight Simulator/Little Navmap plans, and flight-plan routes such as `EGLL DCT CPT UL9 STU DCT 52N020W 53N030W DCT KJFK` (airports, VOR/NDB beacons and coordinates; airways and procedures are drawn direct, and the preview says so). A preview shows what it found before you show it on the globe.
- **Recorded flights play as flown.** A recorded track keeps its own times and altitudes: the plane departs, climbs, holds and lands exactly when and where the recording says, and the flight takes the recording's times. Logs with several flights are split where the aircraft stood on the ground and become a journey or a trip. Planned paths follow their waypoints, with their cruising levels eased from the ground.
- **Compare a path with GlobeHops' route.** **Compare with GlobeHops' route** puts your path beside GlobeHops' own route between the same airports on one clock, and a second import can be compared with the first. The totals say where a path came from, its points and how much longer than the great circle it is.
- **Paths travel in links.** Share carries the path itself (`trk1`, …); a very long recording is simplified to fit a link and Share says so, and **Download path** saves every point as GeoJSON. Files are read on your device and never uploaded.
- **One big Play button.** Playing your journey is now the obvious next step: a large play button with the route, its length and a miniature of the timeline sits exactly where the timeline appears — beneath the globe on larger screens, at the top of the journey sheet on phones — and stays put as the timeline opens. Space plays and pauses, too. Compared journeys show one coloured lane each, so you can see which arrives first before you press Play.
- **A new phone layout.** The journey sheet now rests at three heights: lowered, showing the whole globe with Play beneath it; halfway, showing your journey beside the globe; and lifted to nearly the whole screen when you edit, with the title and tabs pinned. It rises by itself when you tap **Edit** or add times and settles back when you're done, and one list scrolls inside it, with the totals at its end. Landscape phones get the side panel at full height with the player at its top, leaving the globe clear, and the timeline's controls wrap neatly at any width.
- **For agents.** Itinerary documents accept a stop's `track` (points with optional altitudes and times, or the link encoding), links accept `trkN`, and results report each flight's path. A new `import_route` tool (local MCP server and live browser tools) turns a file's text or a route string into flights, warnings and a ready link.

## 1.20.1 — 2026-11-10 — Clearer names beside the planes

- **Names beside the planes no longer pile up.** When compared journeys leave from the same airport, each plane's name steps down so you can read both, instead of one sitting on top of the other.
- **Named tabs match the rest of the planner.** A name such as “Via London” or “Nonstop” uses the same type as the journey summary. Airport-code routes, such as BUD → JFK, stay in the departure-board font.
- **The flight you open stays on screen.** On a phone, opening a flight's times keeps that flight at the top of the list.
- **Trip notes line up.** “Detours around restricted airspace” sits in the same column as the journey names, at the same size as the totals underneath.
- **Compared trips use the same spacing.** The comparison table's columns line up with the rest of the itinerary.

## 1.20.0 — 2026-11-10 — Name your journeys

- **Name any journey.** **Edit** now shows a **Name** field for every journey: a compared journey, a compared trip as a whole, or a single journey, as well as each journey of a trip. To show two people's travels together, name them after the people: “Anna” and “Ben” appear on their tabs, in the comparison table, on their timeline lanes and beside their planes on the globe, and the timeline says “Anna arrives first”. A single journey's name becomes its title. Names can have spaces now (a trip journey called “New York” used to lose its space as you typed).
- **Names travel in links.** A name is part of the link (`label=Anna&b.label=Ben`, with `b.2.route` and so on for each person's way home), so a shared link or one written by an AI assistant opens with everyone named. The guide for assistants (`llms.txt`) and the agent tools now say so, with a worked example of two travellers meeting in Tokyo.

## 1.19.0 — 2026-11-10 — Compare round trips, and map a booking with AI

- **Compare round trips.** Comparing flight options no longer stops at the way there. With compared journeys, **Add return flights** gives every option its own way home; below a round trip, **Compare trips** adds another option with the same journeys. Each trip keeps its colour and tab, and **Outbound** and **Return** under the tabs switch between its journeys. Switching trips keeps the journey you were looking at, so you can flick between the ways home. A new trip's empty way back offers the way out reversed, with its connections or nonstop.
- **Out and back, side by side.** A small table at the bottom lines the trips up: a row per trip and a column each for the outbound, the return and the total time travelling, with a bar under each time against the same journey of the other trips. The quickest way out and back stand out, the fastest trip is marked, and the others show how much longer they take. Trips between the same places are named by their connections (“via FRA”, “Nonstop”) until you name them yourself.
- **One clock for every trip.** **Play all** flies every trip together and skips the days everyone spends at the destination; each trip has its own lane on the timeline, from the way out through its stay to the way home. A trip without times of its own travels on the same days as the timed ones, unless you choose its stay.
- **Map your booking with AI.** **Map your booking with AI** in the planner gives you a short prompt to paste into ChatGPT, Gemini, Claude or any other assistant along with your confirmation email, PDF or screenshot. The assistant follows GlobeHops's published guide and replies with a link that opens your flights with their real times, connections and return. One tap copies the prompt. Your booking goes only to the assistant you choose; GlobeHops never sees it.
- **For agents.** Links compare trips with `b.2.route`…`d.6.*` alongside the trip and comparison parameters, documents accept `journeys` whose items have `sections`, and `compare_journeys` takes `sections` (or `route` plus `returnRoute`) and returns each trip's journeys, stays and totals with the fastest trip overall and journey by journey. The agent guide (`llms.txt`) now opens with step-by-step rules for turning a booking into a link.

## 1.18.2 — 2026-11-10 — Even tabs, quieter oceans

- **Tabs share the width.** A trip's journey tabs (**Outbound**, **Return**, …) and compared journeys (**A**–**D**) now split the row evenly: two tabs take half each, three a third, and so on. Long routes end in “…”, and when there are too many tabs for their names (six journeys on a phone), each tab shows just its number or letter.
- **Quieter ocean names on the whole globe.** With **Oceans and seas** on, ocean names are now smaller and fainter than the country names when you see the whole Earth, and grow back to full size as you zoom in. Where they overlap, the main country names and the major seas (such as the Caribbean or the Mediterranean) now win, so oceans no longer push them off the map.

## 1.18.1 — 2026-11-09 — Smoother stays on the timeline

- **The plane glides over a stay.** When playback skips a stay, the timeline's handle now slides smoothly across the stay's break during the short pause and lands exactly where the next journey continues, instead of jumping. The globe holds at the arrival meanwhile, then moves on to the departure day.
- **Clearer breaks.** Each stay is now a clean gap between the journeys' bars, marked with a fine slanted stroke, and its length (“5 days”) steps aside whenever the handle comes near, so it is never half hidden.

## 1.18.0 — 2026-11-09 — Round trips, and routes within reach of an airport

- **Round trips and multi-stage trips.** **Add return flight** under your stops turns a journey into a trip: the way home appears in its own **Return** tab, from your destination back to where you started, ready for its own connections and times. **+** beside the tabs adds further journeys, and **Edit** names or removes one. One-way journeys look exactly as before.
- **Stays, not layovers.** The overview at the bottom of the panel shows each journey with its date, route and time, and the stay between them — “5 days in Nairobi · 15–20 Nov”. Connections belong to a journey; stays sit between journeys and are never counted as layovers, however long. Until a journey has its own times, its stay is an estimate you can change (a week to begin with), and its dates are marked ≈.
- **Play the whole trip.** **Play trip** flies one plane through every journey on one clock. After landing it pauses for a moment, then skips the stay to the next departure, keeping the real dates, times and daylight; on the timeline each stay is a short break labelled with its length. A journey's own play button plays it alone. Scrubbing, Live, follow and speeds work as before, and the globe shows every journey, the one you're editing brightest.
- **Within reach of a diversion airport.** Twin-engine airliners must stay within a set flying time of an airport they could divert to on one engine (ETOPS/EDTO). With **Diversion-aware routing** (display menu, on by default), long oceanic flights keep within 180 minutes of a potential diversion airport, assuming a modern twin at about 400 knots on one engine. Most routes don't change; Johannesburg–Perth bends north towards Mauritius, Diego Garcia and the Cocos Islands (+441 km), and Auckland–Santiago edges towards the Pacific islands. Where no sensible route stays within reach, as Sydney–Santiago, the direct route stays and its details say it goes up to about 5 h 12 min from an airport, beyond the 180-minute model.
- **Solved together with restricted airspace.** Detours satisfy both at once, and airports inside airspace being avoided don't count as diversion options. About 2,600 potential diversion airports (open airports with a paved runway at least 2,000 m long and 45 m wide, from OurAirports) include remote islands such as Midway, Easter Island and the Cocos Islands. This is modelled reach, not an airline's approved alternates, its route or an ETOPS authorisation; winds and oceanic tracks are not modelled. The new diversion notes list sources, assumptions and limits.
- **For agents.** Itinerary documents gain `sections` for round trips and multi-stage trips with explicit stays, and links gain `2.route`…`6.route` with `N.stay`. Calculations, validation, visualisation links and timelines (with a `stay` phase) accept trips. Agents can opt into `routing` (restricted airspace and diversion-aware routes); results then report great-circle and routed distances, the diversion status and the longest modelled diversion time, and stay great circles otherwise.

## 1.17.1 — 2026-11-09 — Smoother detours

- **No more sharp corners.** Every bend in a route around restricted airspace is now a gentle curve, sized to the route (about 5% of its length on each side, less where a corridor is narrow, as between Russia and Iran). Where the inside of a corner hugs a zone, the curve bulges slightly outwards instead, so routes still never enter the zones they avoid.

## 1.17.0 — 2026-11-09 — Around restricted airspace

- **Flights avoid restricted airspace.** Routes now curve around conflict zones and closed airspace the way an EU airline's would: Helsinki–Tokyo goes over the pole instead of across Russia, Frankfurt–Beijing through the Caucasus and Central Asia, Frankfurt–Dubai around Iraq and Iran. Detours are short and smooth, cross the date line and the poles when that is the way round, and their extra distance lengthens the estimated flight time, the totals and the playback.
- **Based on current advisories.** The zones follow EASA's conflict-zone bulletins as of 9 November 2026 (Ukraine, western Russia, Iran, Iraq, Lebanon, the Persian Gulf and Gulf of Oman, Syria, Sudan, Yemen, and low-level areas such as Afghanistan and Libya for flights too short to climb above them), Belarus's EASA safety directive and Russia's closure of its airspace to EU airlines. Each counts only between its published dates, using the flight's date or today; caution-only advisories are not avoided. Every source, date and simplification is listed in the new airspace notes.
- **Clear about its limits.** A small mark beside a flight's distance shows a detour, and its details name the countries avoided and the extra distance. A flight that starts or ends in a zone, or has no sensible way round, keeps its direct route with a warning. The totals show the combined detour. Routes are illustrative, not flight planning.
- **One switch.** **Avoid restricted airspace** in the display menu is on by default and remembered; off brings back the plain great circles with exactly the previous distances and times. Long display-menu labels now wrap instead of being cut off.

## 1.16.0 — 2026-11-08 — Opens on the globe

- **GlobeHops opens on the globe.** Instead of loading an example journey, the app now starts with the globe as large as the screen allows, lit as it is right now, and its clock beneath it. On phones the sheet starts lowered: the time dial, then a large amber **Show a flight** button that opens the planner with its three long-haul ideas. The empty globe grows and shrinks smoothly as the sheet opens and closes, unless you have zoomed it yourself. Shared links and your last journey still open as before.
- **A live clock with seconds.** While **Live** is on, the dial shows seconds ticking in step with your device's clock; they fold away as soon as you move the time. The head is laid out on three columns — time on the left, the date centred (without the year while it is this year), Live on the right.
- **Smoother sheet.** Opening the planner on a phone hides the dial to give the list room, and content settles into the sheet as it opens or closes. A lowered journey shows its route and totals centred under the handle.
- **Reset, gently.** Reset's Cancel and Reset buttons slide in where Reset was, and the usual actions return the same way.
- **The Sun is named too.** The Sun now has a label like the Moon's, and both show only with **Country names** on, alongside the other place names. Labels near the screen's edge move to the other side of their body instead of being cut off.
- **Tidier alignment.** On desktop the empty globe keeps clear of the top bar and the floating dial; on phones the timeline's clock fits on one line beside the playback controls.

## 1.15.3 — 2026-11-08 — The whole screen on iPhone

- **The installed app now fills the screen down to the bottom edge.** iOS 26 gives a home-screen app with a see-through status bar a viewport one status bar short of the bottom whenever the page is shorter than the screen, and stops drawing there (WebKit bug 301108), so 1.15.1–1.15.2 stretched the app into an area iOS never showed and could hide the bottom of the journey sheet. The installed app's page is now as tall as the screen, so iOS hands it the whole screen; the earlier stretching is gone.

## 1.15.2 — 2026-11-08 — Edge to edge on iPhone, for real

- **No more black strip below the sheet.** 1.15.1 looked for the strip by comparing the window height with the screen, but on current iPhones the window reports its full height even while the sheet stops short. The installed app now measures how far bottom-anchored content really reaches, and recognises the home-screen app by its display mode as well.

## 1.15.1 — 2026-11-08 — Edge to edge on iPhone

- **The bottom sheet reaches the bottom of the screen.** In the installed app on iPhone and iPad, a black strip the height of the status bar could sit below the journey sheet (a WebKit quirk with see-through status bars). The app now measures that strip and extends the globe, sheet, airport picker and privacy sheet to the physical bottom edge.

## 1.15.0 — 2026-11-08 — An app that works offline

- **Install GlobeHops as an app.** Add it to your home screen or desktop (About → **Install GlobeHops**, or Share → Add to Home Screen on iPhone and iPad) and it opens like a native app: full screen on Android, edge to edge under the status bar on iPhone and iPad, with a launch screen instead of a blank flash and new app icons.
- **Works offline, always.** After the first visit everything GlobeHops needs — the globe imagery, every airport, time zones, labels and all three languages — is stored on your device, so it opens instantly and keeps working without a connection, in the browser or as an installed app.
- **Updates itself.** Every time it opens (or comes back to the foreground) GlobeHops checks whether a newer version has been published. The new version downloads quietly in the background and verified file by file; when it is ready, a small **Update** notice appears, or it switches over the next time you open the app. About shows the status and has **Check for updates**.
- **Feels like an app.** Pinching or double-tapping the interface no longer zooms the page and text no longer gets selected by accident, while pinch, scroll and button zoom on the globe work as before.
- **Quieter ocean names.** Ocean labels are now the size of the leading country names instead of towering over them, and water names are as bright as country names.

## 1.14.0 — 2026-11-07 — Find the Moon

- **Find the Moon.** The Moon at its true size is only in view from a narrow band of angles, so the display menu now has **Find the Moon** (while day and night shading is on): the globe turns until the Moon stands just above its edge, still north-up, and you can look around from there.
- **The Moon is named.** A small “Moon” label sits beside the disc whenever it is on screen, on the side away from the globe.
- **Earthshine.** Near new Moon, when Earth seen from the Moon is full, its sunlight now greys the Moon’s dark side, as it does to the eye, so a thin crescent no longer vanishes against black space. Earthshine fades as the Moon fills out.

## 1.13.0 — 2026-11-07 — The Sun and Moon, any moment, and Live

- **The Sun and Moon in the sky.** With day and night shading on, the Sun and the Moon now hang in space at their true positions for the moment shown, at the size they really appear: the Sun a half-degree disc with a soft glare, the Moon textured from NASA's Lunar Reconnaissance Orbiter mosaic. Turn the globe to find them; Earth hides them as they pass behind it. The Moon's phase comes from real sunlight, its near side rocks with libration, and it darkens to a faint red in Earth's shadow during a lunar eclipse.
- **See the planet at any moment.** With no route, a time dial sits below the globe (on phones, at the top of the sheet): drag or flick its hour tape, scroll, or use the arrow keys (Page Up/Down for whole days) to move the sunlight around the world, and tap the date for distant days. **Live** returns to now. A chosen moment stays in the page address, so it can be shared.
- **Live flights.** Once a journey has real dates, the timeline offers **Live**: the globe jumps to now and keeps time with the real world, showing where the plane should be and moving it every second, with the camera following the aircraft. Before departure it waits at the gate with a countdown; after landing it rests at the destination. Shared links carry `live=1`, so whoever opens one watches the flight as it happens.
- **Tidier globe controls.** The buttons in the top-right capsule now highlight their whole segment, following its rounded ends, instead of drawing circles inside it. The display menu no longer has a separate globe clock entry; the time dial replaces it.

## 1.12.0 — 2026-11-07 — Similar routes and lighter wording

- **New compared journeys start empty.** **Compare journeys** no longer copies the first journey’s airports. The new tab is blank and offers up to three similar routes between the same airports — nonstop when your journey connects, or via a different well-known hub with little detour — never one you are already comparing. Choose one, or pick any airports yourself.
- **Less text, cleaner panel.** Shorter labels and notes throughout: **Compare journeys**, **Remove journey**, “Flight ≈ 4h 55m”, “Example departure”, “City, airport or code”. The welcome header no longer repeats how to change airports, a single flight’s totals drop the “Great-circle route” and “Estimated” sublines (≈ already says it), and the comparison ticket shows a note only when untimed journeys start together. An empty journey in the ticket reads quietly instead of showing a +0m difference.
- **Natural Hungarian.** Hungarian text no longer uses the “A(z)” article placeholder, and one leftover formal phrase now matches the app’s informal voice.

## 1.11.1 — 2026-11-06 — Chosen suggestions are your journey

- **Suggested routes can be reset and compared.** Choosing one of the suggested routes still counted as the automatic example, so Reset and **Compare with another journey** stayed hidden. A chosen suggestion is now your journey, with Edit, Share, Reset and Compare like any other; its stops come into view, and the other suggestions stay just below, with your choice highlighted, until you change the route. Only the route shown on your first visit is an example.

## 1.11.0 — 2026-11-06 — Reset in one step

- **Start over in one step.** A reset button now sits beside Edit and Share. It asks first, in place: **Cancel** (which has the focus, and Escape works too) or **Reset**. Resetting removes every stop, time and compared journey and closes the timeline, leaving an empty planner with route suggestions; display settings such as units, layers and motion stay as they are.
- **Simpler editing.** Edit mode keeps inserting, removing, reordering and reversing stops; the old “Clear route” there is gone, because it emptied only the journey you were viewing and was easy to confuse with starting over. In a comparison, **Remove journey** still drops a single option.
- **Headings never collide with buttons.** When a heading and the Edit/Share/Reset buttons don't fit on one line (long Hungarian words, narrow phones), the buttons move to their own line instead of running into the title. The Hungarian comparison title is now simply “Összehasonlítás”.

## 1.10.1 — 2026-11-06 — Hardening: neater phones, keyboard and touch, a steadier globe

- **Neater on phones.** The airport search now covers the whole screen while the keyboard is open; on iPhones the journey no longer shows through beneath the floating address bar and keyboard toolbar. Editing a flight's times gives the editor the whole sheet: it scrolls into view, the totals move below the list, and date and time fields size to their wording instead of cutting off ("Idő megadása", "Ange tid"), with departure and arrival still lined up. On the narrowest phones the timeline clock gets its own line instead of wrapping word by word.
- **Keyboard fixes.** Space on a focused timeline button (Previous/Next flight, Close) now presses that button instead of starting playback, and typing in the clock menu no longer toggles playback. Enter while composing text with an input method (for example Japanese or Chinese) no longer picks an airport early. The km/mi switch works with arrow keys, Home and End as one stop in the Tab order. On phones, Tab stays inside the full-screen airport search.
- **Touch and visibility.** Timeline menus, journey tabs and lanes, info buttons, the sheet handle and other small controls have 44-pixel touch targets on touch screens; focus outlines are no longer clipped, and highlighted secondary text has more contrast. Reduce motion now also stops the pulsing location dot.
- **Sharper, steadier globe.** A slow low-resolution texture can no longer replace the detailed one after you zoom in, a failed detailed download falls back to the medium texture instead of staying blurry, airport labels re-measure once fonts load (no overlaps), and the globe recovers cleanly after the graphics context is lost. Playback does less work per frame.
- **Under the hood.** The app's orchestration is split into small, tested pieces; link, document and agent validation share one set of rules; the release workflows use least-privilege permissions. Links, agent tools and saved preferences are unchanged.

## 1.10.0 — 2026-11-06 — Compare journeys, long-haul welcome and crisper corners

- **Compare journeys.** Under your route, **Compare with another journey** adds up to four options (A–D), each with its own colour on the globe. New options start with the same airports; add a stop or change them. Tabs switch between options, and a summary shows each journey's total time on one shared time axis, which one is fastest and by how much the others take longer, and which arrives first. **Play all** flies every journey at the same time on one clock, using their real departures, arrivals and layovers: each has its own lettered aircraft, and the timeline shows a lane per journey ("Flying to London · 2h 10m left", "Layover in Frankfurt", "Landed in New York · 14:35"). Journeys without times start together at an example time. Comparisons are kept in share links (`b.route`, `b.dep1`, … for options B–D; single-journey links are unchanged).
- **Agents can set up comparisons.** Entering many times by hand is tedious, so assistants can do it: itinerary documents accept `journeys` (with optional labels such as an airline), the local MCP server has a `compare_journeys` tool that returns one link playing all options plus totals, the fastest and the first arrival, and the in-browser WebMCP tools can apply a comparison to the open page.
- **A welcome from your part of the world.** First visits now show three nonstop routes of at least twelve hours from your country's main airport to famous hubs in different regions (for Budapest: Sydney, Los Angeles and São Paulo). The country comes from your browser's time zone; nothing is looked up or sent anywhere.
- **Crisper corners.** Rows, options and tabs are square, airport-code tiles and badges almost square, buttons, menus and panels only slightly rounded, like airport signage. Round shapes remain only for icon buttons, globe controls, dots and switches.

Limitations: the welcome country is a time-zone proxy, not your physical location. Suggested routes are long-haul previews; a real nonstop service may not exist. Comparison links with many timed journeys can approach the URL length limit; agents can fall back to the itinerary-document link.

## 1.9.0 — 2026-11-06 — Brighter oceans, crisper twilight, language button, separate water names, motion choice, my location

- **Brighter oceans by day.** The deep ocean in the NASA imagery was almost black, so it looked much the same by day as by night. The day texture now lifts the darkest water to a clear navy (most in the deep basins, least on the shelves, keeping every depth gradation in order); land, ice and lakes are unchanged. The texture files also got 7–9% smaller.
- **Crisper day and night.** The shading changes from night to full day within about ±3° of the Sun's elevation around sunset (previously a gradual fade through astronomical twilight at −18°). The terminator stays exactly where the Sun sets and rises; only its softness changed. City lights still come on through dusk.
- **Language button.** The language choice moved out of the display menu into its own button beside it; it is still in About too.
- **Country names and Oceans and seas.** The old “Place names” toggle is now two: **Country names** and **Oceans and seas**, each remembered separately. If you had place names on, both start on. `names` links still switch both.
- **Reduce motion, your choice.** A **Reduce motion** switch in the display menu starts from your system setting and can override it either way, so you can enjoy every animation even when your device asks for less motion (or calm things down when it doesn't). The choice is remembered.
- **My location.** An optional **My location** switch shows where you are as a blue dot, using your browser's location permission. Your position stays in the browser: it is never stored, put in links or sent anywhere.
- **Translation review.** Hungarian and Swedish wording was reviewed for idiom: for example Swedish “Följ flygplanet” (not the ambiguous “Följ planet”), “Vänd på rutten”, “Spela upp resan” and a proper compound in “GlobeHops-version”; Hungarian method and accessibility texts, “Lépkedés a járatok között” and natural word order in several hints.

## 1.8.1 — 2026-11-06 — Kilometres in Hungarian and Swedish

- **Kilometres by default in Hungarian and Swedish.** Without a saved choice, the distance unit followed only the browser's region tag, so a Hungarian or Swedish interface in an `en-US` browser (common when the language is picked from the time zone) showed miles. Hungarian and Swedish now default to kilometres; English keeps miles for US, Liberian and Myanmar browsers. A saved choice or a `units` link parameter still wins.

## 1.8.0 — 2026-11-06 — Hungarian and Swedish, follow the aircraft, oceans and twilight

- **Three languages.** Use GlobeHops in English, Magyar or Svenska, with translated controls, country names, dates, numbers and durations. Language is chosen from an explicit address, your saved choice, a browser time-zone country hint, then browser languages. Change it in Display or About; `/en/`, `/hu/` and `/sv/` have translated search/social metadata. Ordinary Share links let recipients use their own language.
- **Local city names and search.** Hungarian and Swedish city names appear throughout the journey and search alongside the original names. The city table downloads only when one of those languages is used; missing names keep their original text. Reviewed names include Swedish “Kyjiv”. Route titles stay concise and Hungarian playback speeds state their units clearly.
- **Countries, oceans and seas.** “Place names” now adds 242 countries, 7 ocean regions and 72 seas, bays, gulfs and selected channels/straits, in all three languages. Oceans use larger blue italic capitals and seas smaller italics; airport labels keep priority, including during reduced-motion zooming.
- **Follow aircraft.** A timeline toggle keeps the aircraft in view with smooth predictive tracking and zoom that opens up during cruise. Dragging, zooming or using camera keys returns control immediately. The choice is remembered and shareable (`follow=1`); reduced motion uses occasional re-centering. Phone timeline controls wrap more clearly on narrow screens.
- **Date-aware daylight and true twilight thresholds.** Day/night shading uses the standard sunrise/sunset elevation (−0.833°) with progressive civil, nautical and astronomical twilight through −6°, −12° and −18°. Daylight falls off more naturally toward dusk, a roughly 6% night floor preserves visibility, and city lights fade in through civil dusk. Solar accuracy and texture/marker alignment are checked against an independent astronomy library across 1900–2100.
- **More useful agent access.** Additive v1 links and itinerary documents can request language, place names, borders and a one-based flight number. Local MCP visualisation returns readable/document links and a human summary, with four reference resources and a `plan_and_visualize` prompt. Supported browsers expose five validated live WebMCP tools. Link/tool view choices preserve saved preferences; combined follow/flight links keep the aircraft camera active, ICAO clock links resolve correctly, and oversized documents can fall back to readable URLs.

Limitations: automatic country detection uses the browser’s time zone, not physical location. Automatic city-exonym matching covers 54.3% of scheduled-service airports; unmatched cities keep their original names, and airport proper names remain untranslated. Agent outputs remain English. Drake Passage is omitted because its pinned source geometry has no usable open-water polygon. WebMCP remains experimental; modern/legacy API paths were exercised through mocks. The globe stays spherical and twilight brightness is a display approximation without weather or terrain; solar test errors do not guarantee observed sunrise/sunset accuracy. Follow’s feature-level browser checks covered Chromium; it still needs WebKit/real-device review. The existing Ireland/LHR country-label overlap E2E assertion after keyboard zoom is intermittently flaky and was reproduced before this release.

## 1.7.1 — 2026-11-06 — Equal consent buttons, aligned version

- **Equal answers.** The analytics question's Deny and Allow buttons are now the same size and together span the full width of the sheet or card: Deny on the left, Allow (amber) on the right.
- **Neater version tag on desktop.** The faint version now sits the same 16 px from the left and bottom edges as the journey panel and globe controls (it was 3 px from the bottom); the panel's maximum height leaves room for it so they never overlap.

## 1.7.0 — 2026-11-06 — Clearer analytics question; version in About on phones

- **Analytics question at the bottom.** The one-time Google Analytics question no longer floats over the globe near the top. It is now a sheet at the bottom of the screen on phones (a card at the bottom centre on desktop), and the rest of the page is dimmed until you answer. **Allow** is a large amber button; **Deny** (formerly “No thanks”) is a quieter text button beneath it, or beside it on desktop. Escape does not dismiss the question; Details still opens About → Privacy on top of it. Both answers are remembered and can be changed in About.
- **No version tag on phones.** The faint version in the bottom-left corner now appears only on desktop; on phones the version is in About (“Version 1.7.0 · Build …”), and the journey sheet no longer reserves a 17 px strip for the tag.

## 1.6.1 — 2026-11-06 — Version in the bottom-left corner

- The faint version moved from beside the GlobeHops name to the bottom-left corner of the screen. On desktop it sits below the journey panel (hover shows the build commit and date). On phones it sits in a thin strip below the journey sheet's content (inside the home-indicator area on iPhones); the sheet keeps at least 17 px clear at its bottom edge, so the version never overlaps the totals, the collapsed bar or the docked timeline.

## 1.6.0 — 2026-11-06 — Version number

- **Versioning.** GlobeHops now follows semantic versioning: `package.json` holds the release version, each release adds a numbered entry here, and a workflow tags every successfully deployed new version as `v<version>`. Earlier releases were numbered retroactively (1.0.0 initial release … 1.5.0 city lights) and tagged on their last deployed commits.
- **Version in the corner.** A faint `v1.6.0` sits beside the GlobeHops name in the top-left corner on phones and desktops; hovering shows the build commit and date. About ends with “Version 1.6.0 · Build abc1234, 6 Nov 2026 · What’s new”, linking to this changelog.
- `agent/dataset.json` gains an `app` record (`version`, `commit`, `date`) so agents can tell which release they are talking to.
- A unit test keeps `package.json`, `package-lock.json` and the newest changelog heading on the same version, with headings in descending order.

## 1.5.0 — 2026-11-06 — City lights, crisper terminator, coastlines, neater totals, optional analytics

- **Crisper day and night.** The day/night blend now spans about −4° to +3.5° of solar elevation (was about −7° to +6°), the night side is darker (6 % instead of 13 % of daylight) and the orange twilight glow is narrower. The atmosphere rim uses the same edges.
- **City lights at night.** A night-light mask derived from NASA Black Marble 2016 (`lights-2k.webp`, 44 KB; `lights-4k.webp`, 143 KB) glows warm after dusk on the night side. It loads after the day texture, only while day/night shading is on, fades in over 0.7 s (instantly with reduced motion), uses the 2K mask on phones and GPUs below 4096 px, and is skipped silently if it fails. `npm run textures:build` now also builds it from the Black Marble 3 km JPEG (`--day-only` / `--night-only`).
- **Coastlines.** With borders on, a fainter outline (opacity 0.2 against 0.42 for land borders) follows every coast, so land reads clearly on the dark side. `npm run borders:build` now also writes `src/data/generated/coastlines.json` from Natural Earth 1:50m coastline v5.1.2, simplified to 0.02° (35,180 points, 79 KB gzipped); it loads in parallel with the borders and either can fail alone.
- **Neater totals.** The totals form two justified columns on shared rows: distance and flight count flush left; journey time and its flying/layover breakdown flush right. Beside Play the columns sit side by side with their details aligned beneath, and dated journeys add a departs/arrives line across the full width.
- **Google Analytics (GA4, optional).** A small notice asks once per browser; nothing loads from Google until the visitor chooses Allow (Consent Mode v2, advertising storage/user data/personalisation always denied, Google signals and ad personalisation off). One page view per visit, reported as the bare address (`https://tmrk.github.io/globehops/`) and the title “GlobeHops”, plus `share` and `play_journey` events; airports, dates and times are never sent. Route edits rewrite the address through the browser's own History methods, captured before gtag.js loads, so they never count as page views. The Google tag sends its own page view at start-up and ignores `config` overrides, so the bare address and title are queued with `set` before `js` (verified on live gtag.js). Only `tmrk.github.io` production builds are measured; local previews, E2E runs, forks and browsers sending Global Privacy Control or Do Not Track are never asked. About → Privacy explains it and has a switch; switching off sets Google's opt-out flag and deletes the `_ga` cookies.

Limitations: in the GA4 property, **Admin → Data streams → Enhanced measurement → Page views → “Page changes based on browser history events”** should be switched off; GlobeHops already avoids history page views from edits, but the mobile picker's Back still produces a `popstate`. City lights are a 2016 composite and the coastline is a 1:50m generalisation. The existing country-names E2E test is intermittently flaky on desktop Chromium (“Ireland / LHR” label overlap after zooming); it fails at a similar rate without these changes.

## 1.4.0 — 2026-11-06 — Calmer, aligned interface

A review of the whole interface for clutter and alignment. Every feature remains; fewer controls are visible at once and everything sits on one grid.

- **One grid for the journey.** Stops, flights, layovers and actions share four columns: route line, airport code, text, trailing tools. Codes, flight and layover icons, names and figures each form one straight vertical line. The route line is drawn per row, so it no longer breaks beside an open flight editor.
- **Edit mode.** Rows no longer carry a grip, a remove button and an insert button each. **Edit** (top of the panel) reveals reorder handles, remove and “add a stop here”, plus **Reverse route** and **Clear route**; **Done** returns to the calm view. Choosing an airport, Add stop, layovers and flight times work as before outside edit mode.
- **Quieter flights.** Each flight row reads “✈ 979 km · ≈ 1h 40m” with “Add times ⌄” (or its local times, departure-board style) at the right, instead of a numbered badge, an amber bordered pill and a plus on every row. The plane takes the flight's colour.
- **One primary action.** The totals sit at the bottom of the panel behind a ticket-style tear line, with a single amber **Play** button. Share and Edit are text buttons in the panel header; the header's Play/Reverse/Share chips are gone.
- **One map control.** The four floating globe buttons and the “Now” clock chip became one top-right group: a **display menu** (country borders, country names, day and night, km/mi, and the globe clock that opens the timeline) and **Re-centre**.
- **Phones: one bottom surface.** The open timeline is now the top of the journey sheet instead of a second floating card; collapsed during playback, the sheet is just the timeline, leaving more globe. While it is docked the totals scroll with the list. Timeline controls are equal-height chips with visible menu chevrons, and previous/next flight share one capsule.
- **Flight-times editor.** Date and time fields line up in two columns for departure and arrival; clearing an entered time is a small × in its heading.
- **Airport look.** Codes are split-flap departure-board tiles; the Play button is an amber wayfinding sign.
- **Code and city only.** Stop rows show the airport code and city on one line, as on a boarding pass; the full airport name stays in search results, the hover tooltip and the screen-reader label, and search still matches it. Airfields without a code show their name.
- README screenshots, README usage text, CODE.md (component map and a layout/alignment rule) and the E2E specs were updated. Tests open the display menu or Edit mode where those controls moved.

Limitations: per-end flight-time clearing moved into the editor heading; the sheet gesture and native pickers still need real-device review.

## 1.3.0 — 2026-11-05 — Flight-time editing, smooth playback, country names, typography and logo

- **Flight times, in place:** every flight row shows “Add times” (or its local departure → arrival once dated) and opens an editor with one row per end: the airport, its zone for that instant (“CET · UTC+1”) and a date and time field. Fields are native pickers under formatted faces (“Fri 20 Nov 2026”); empty fields show the time estimated from the rest of the journey with ≈ and start the picker there; keyboard focus reveals the native segmented editor. A Done button returns focus to the flight. The time bar's date explorer uses the same field.
- **Airport time zones reviewed:** all 9,934 assignments were cross-checked against the IANA tzdb country table. Two upstream OurAirports records had wrong positions and therefore wrong clocks: Ulleung, South Korea (recorded in Inner Mongolia → China time) and a “(Misplaced duplicate?)” Venezuelan record in Chad. They are now excluded (`data/excluded-airports.json`, with evidence). The time-zone build gained a country plausibility check; the 11 genuine special clocks it finds (e.g. Ciudad Juárez, Lord Howe, Eucla, Easter Island) are documented in `data/timezone-reviewed.json`, and a test fails on any new unexplained outlier. Schedule arithmetic remains UTC.
- **Smooth playback:** the trail now ends exactly at the aircraft (the last segment is cut to the exact progress) instead of growing in 60 km steps, and the globe draws inside the clock's animation frame, so the aircraft no longer blinks out between frames.
- **No dotted or dashed lines:** translucent route lines (dimmed legs, casings, the unflown remainder) use the stencil buffer so overlapping segment joints no longer bead into dots; the dashed ground track is gone.
- **Airport search without jumps:** on desktop the search field takes the row's exact place and height, and the hint and suggestions float in a popover above the itinerary (placed above the field when space below is short).
- **Typography system:** Barlow (signage grotesque) for the interface and Martian Mono, condensed, for codes, times, dates, distances and totals, with a token scale, caps tracking and tightened mono spacing. Replaces Geist.
- **New logo:** a globe with one great-circle hop, drawn with the globe's own origin and destination markers; new favicon, app icons and social image.
- **Country names (optional, off by default):** Natural Earth 1:50m label points, ranks and minimum zooms; names appear progressively as you zoom, sized by importance, without overlapping each other or airport labels. Lazy-loaded; the choice is remembered (`npm run labels:build`).
- **Faster deploys:** the Pages workflow gates on lint, unit tests, build and three `@smoke` E2E tests instead of the full Chromium suite (≈ 12 min → under 2 min); run affected E2E specs locally.
- **Mobile sheet gestures:** drag the journey sheet down (from its handle, header, or content scrolled to the top) to collapse it to the peek bar; lift the peek bar to bring it back. Short drags spring back.

Limitations: native date/time pickers and the sheet gesture still need real-device review (Playwright emulates touch with synthetic events). Zone abbreviations come from the browser's ICU data, which currently prints London's winter zone as GMT+0, so GlobeHops shows “UTC+0” there. Country names follow Natural Earth's de facto depiction.

## 1.2.0 — 2026-11-05 — Time, flight playback, day and night, agent access

- **Optional flight times:** select a flight to enter departure/arrival dates and times in each airport's local time. Times are stored per stop (a leg's departure on its origin, its arrival on its destination), so inserting stops keeps them in place; Reverse clears them. Missing times are propagated from entered ones (forward, then backward) using the flight-time estimator and layover settings; entered values never move. Every time carries provenance (entered, estimated, or assumed for an undated example). Errors (negative flight time, overlapping connection, nonexistent local time, offset mismatch, unknown zone) block playback; warnings cover ambiguous DST times (choose an offset), short connections, unusual durations and future rule changes.
- **Airport time zones:** a build-time point-in-polygon lookup against timezone-boundary-builder 2026f (pinned SHA-256) assigns an IANA zone to all 9,934 airports (one documented override, Union Glacier). The compact table (15 KB gz) is a separate ODbL derivative database; no polygons reach the browser. Conversions use the runtime `Intl` tzdb (DST, history, date line) instead of a Temporal polyfill.
- **Journey model and timeline:** versioned, multi-journey-ready `computeJourney` (legs `L1…`, transfers `T1…`), deterministic `journeyStateAt` (before/flight/transfer/after) and a monotonic climb–cruise–descent progress model matching the drawn arcs.
- **Playback:** one UTC `SimulationClock` drives the aircraft, timeline, status text, active-leg highlight and lighting. Auto speed plays the whole itinerary incl. layovers in ≈ 15 s; fixed 0.5/1/2 h per second, never shorter than ≈ 5 s. Scrubber with flight/layover segments, previous/next flight, clock in your zone, UTC or an airport's zone. Undated routes play from an example departure now. The renderer updates only uniforms, the plane and labels per frame; React re-renders only on phase changes.
- **Day and night:** the Sun's subsolar point (NOAA/Meeus, ≤ 0.015° from astronomy-engine) lights the Earth-fixed globe; restrained night side, subtle twilight, dimmer night-side atmosphere. Alignment is tested in scene coordinates and by sampling rendered pixels at JFK/DXB. A globe toggle turns shading off (remembered). A top-bar chip shows the current globe time.
- **Share links v1:** `depN`/`arrN` local times (optional `±HH:MM` only to disambiguate), `t`, `play`, `speed`, `clock`, `units`, `daynight`, or a base64url `itinerary` JSON document. Legacy `?route=` links are unchanged; `t` is written only when paused.
- **Agent access:** `/globehops/llms.txt`, `/globehops/agent/{capabilities,itinerary.schema,examples,dataset}.json`, JSON-LD and `describedby`/`help` links on the homepage, and a local stdio MCP server (`npm run mcp`: search_airports, calculate_route, validate_itinerary, visualize_route, get_journey_timeline) reusing the same modules as the app.
- Docs: new TIME_AND_SIMULATION, AGENT_INTEGRATION and ROUTE_COMPARISON_FUTURE; architecture, data sources, development, deployment and notices updated. The daily data workflow also rebuilds time zones and agent examples.

Limitations: positions and altitudes are illustrative estimates, not flight tracks; there is no taxi phase. Future schedules use today's time-zone rules. Overlapping zones in disputed areas resolve deterministically (documented in `data/TIMEZONES.md`). Multi-route comparison is prepared in the model but has no UI yet. Native date/time pickers still need real-device review.

## 1.1.0 — 2026-11-05 — Borders, layovers, flight profile and design language

- **Country borders:** Natural Earth 1:50m land boundaries (public domain, v5.1.2) drawn on the globe, on by default. A globe button toggles them and the choice is remembered; hidden borders are not downloaded. New `npm run borders:build` pipeline with validation and tests.
- **Layovers:** every connection gets a layover (default 1h 30m) that can be changed per stop from 30 minutes to three days. Totals show flying time, layover time and the overall journey time. Custom layovers travel in share links and the remembered route as `LHR_180`.
- **Flight profile:** arcs now climb to a typical cruising altitude (11 km) in about 20 minutes, hold it, and descend over the last ~25 minutes. Every flight shares one cruise height (12× vertical exaggeration); short flights peak lower. Replaces the distance-scaled sine lift.
- **Design language:** all corners use five role tokens (full, xs, sm, md, lg) with concentric nesting; compact controls share one height and floating globe controls share one surface/shadow.
- **Fix:** wide multi-leg routes froze WebKit (Safari and every iOS browser) for ~15 s on load, e.g. the suggested London → Dubai → Singapore → Sydney: the camera's enclosing-cap search evaluated `atan2`/`hypot` per point thousands of times over ~350 points. It now compares dot products, frames from samples ≤ 2° apart and frames the first route once (≈ 0.45 s in Playwright WebKit; 12× faster in V8). Regression test added.
- Durations of a day or more format as `1d 4h 05m`.
- README now describes only the web app, its use and its sources; setup and commands live in `docs/DEVELOPMENT.md`.

Limitations: the altitude profile is a fixed illustrative model (no aircraft types, step climbs or holding). Border lines follow Natural Earth's de facto depiction at 1:50m and are approximate at close zoom. Layover choices are not validated against minimum connection times.

## 1.0.1 — 2026-11-05 — Deployment verification and texture loading

- First GitHub Pages deployment verified: Deploy workflow green (lint, unit, build, Chromium E2E), and the full four-project Playwright suite passes against https://tmrk.github.io/globehops/ (`E2E_BASE_URL`). The live bundle hashes match a local build of the same commit.
- Textures now load progressively: 1K → 4K for everyone; 8K only when zoomed in close on capable desktops (saves ~2 MB and ~130 MB GPU memory on typical visits).
- `scripts/dataset.test.ts` skips its cache-backed CLI integration test when `.cache/ourairports/` is absent (CI), instead of failing.
- Initial dataset rebuilt online so `data/airports-build.json` records the upstream OurAirports commit.

## 1.0.0 — 2026-11-05 — Initial release

- Interactive textured Earth with true great-circle arcs, dashed ground tracks, projected airport labels and flight inspection.
- Airport autocomplete, up to ten stops, insertion/removal, reverse, keyboard/pointer reorder, share URLs and remembered route/unit preferences.
- Mobile takeover picker, responsive journey panel, reduced motion, accessible controls, credits and a usable planner without WebGL.
- Direct Three.js with render-on-demand, spherical camera framing and UI-aware view offsets; static Vite build for GitHub Pages.
- Validated OurAirports generation, NASA WebP texture pipeline, daily data workflow and Pages deployment checks.
- Unit coverage for search ranking, display helpers and scene mathematics; four-project Playwright coverage of journeys, rendering, layout, fallback and base-path assets. Project, data and maintenance documentation added.

Limitations: OurAirports lacks traffic data, so ranking relies on match quality, scheduled service, size and maintained hub hints. NASA BMNG is a 2004 composite. Flight estimates ignore winds, aircraft, actual routing and layovers. The globe requires WebGL; route editing does not. Local E2E covers Chromium/WebKit, with no Firefox project; CI runs Chromium only. Real-device keyboard/native sharing still need device review.
