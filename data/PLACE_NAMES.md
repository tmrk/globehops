# Localised place names

Natural Earth v5.1.2 supplies cartographic country/marine labels and populated-place exonyms. Its vector data are public domain; the translated names originate in Wikidata (CC0). See [data sources](../docs/DATA_SOURCES.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

Regenerate with Node 22.18+:

```sh
npm run labels:build -- --offline
npm run places:build -- --offline
```

Both commands accept `--refresh` instead of `--offline`, use pinned v5.1.2 URLs and cache under `.cache/naturalearth/`. Labels accept optional country and marine GeoJSON paths, in that order; places accepts an optional populated-places GeoJSON path. Production builders validate inputs/outputs before replacing caches or outputs by atomic renames. Do not hand-edit the generated JSON.

## Globe label table

`src/data/generated/country-labels.json` format 2 stores tuples:

```text
[kind, en, hu, sv, latitude, longitude, minZoom, rank]
```

Kinds are `country`, `ocean`, `sea` (including selected bays/gulfs/channels/straits). Unique identities are kind + English name; translated names may repeat, including Atlanti-óceán and Csendes-óceán in the two ocean hemispheres. All 242 country names and all 118 marine source names were reviewed in Hungarian and Swedish. Shared spellings such as Swedish Hudson Bay and country names such as Canada are retained when appropriate.

Countries retain Natural Earth's label points and zoom/rank. The table includes all seven ocean regions; bays/gulfs/seas through scalerank 3, plus scalerank-4 seas; English Channel, Mozambique Channel and Strait of Gibraltar are the only channels/straits. Inner Sea(s), North Western Passages, reefs, rivers and sounds are omitted. Drake Passage is also omitted: its pinned 1:50m geometry contains only near-zero-area coastline slivers, not a usable open-water polygon.

Sea points use the largest polygon by cos(latitude)-scaled area, unwrapping longitude across the antimeridian and retaining holes. Best-first square subdivision finds an interior point far from the shoreline (0.02° projected tolerance). Polar caps keep their deliberate full-longitude edge. Every marine label, including manually placed points, must pass polygon containment after 0.01° rounding. The ocean and Mediterranean placements below improve composition across the whole-globe and phone views.

Oceans start at zoom 0.8. Marine minimum zooms otherwise use `1.8 + (min_label - 2) * 0.45`, adapting Natural Earth's 2–5.7 thresholds to this globe. Oceans are italic caps that never outgrow the leading country names (rank 2, zoom 1.7) at the same zoom: up to zoom 3.6 (every whole-globe view) they are 2.5 px smaller and 30% fainter, easing to the same size and full strength by zoom 5.2. Seas use slightly smaller blue italic type. Long ocean names can occupy two lines. The normal collision and far-side rules apply; airports always win. Oceans collide as rank-2 labels after the leading countries, so those countries and the rank-1 seas win, and countries win equal-rank sea ties.

`CountryLabelLayer.setLocale(locale)`, `GlobeRenderer.setLabelLocale(locale)` and optional `GlobeView.locale` accept `en`, `hu`, `sv`; other values use English. A locale change resets text measurements and requests a frame without reloading data. The existing country-name preference controls this whole layer.

## Airport city dictionary

`src/data/generated/city-names.json` format 1 stores metadata and `names.hu` / `names.sv` dictionaries keyed by the **original** OurAirports `city|countryCode`. It emits only translations differing from `displayCity`; English has no replacement dictionary. Country keys prevent London, Ontario from receiving London, UK data.

Automatic matching requires a same-country, normalised exact match against Natural Earth `NAME`, `NAME_EN`, `NAMEASCII`, or pipe-separated `NAMEALT`. It also tries the OurAirports city after removing parenthetical detail. At least one airport in that exact city/country group must be within 75 km of the place point. Multiple qualifying places are ambiguous and skipped. NE's `-99` country codes map through reviewed `ADM0_A3` values KOS→XK, CYN→CY and SOL→SO.

Current automatic coverage: **3,495/8,821 city strings**, **2,349/4,327 scheduled-service airports (54.3%)**; 32 ambiguous city strings skipped. After overrides the dictionaries contain **870 Hungarian** and **471 Swedish** entries. Unmatched cities retain their existing display names; source coverage is intentionally incomplete.

`decodeCityNames(raw)` and `loadCityNames(url, signal)` return the two dictionaries. `localizedCity(airport, locale, table)` uses a matching exonym for hu/sv, otherwise `displayCity(airport)`; a null/unloaded table is supported. `I18nProvider` lazily fetches the Vite `?url` asset on the first hu/sv locale, shares it between those locales, and routes UI city text through `localizedCity`. English makes no city-data request. The UI uses original names until the table arrives and retains them if loading fails. App memoises the active locale’s search index through `buildSearchIndex(airports, { extraNames })`, with normal city-level match weight; only dataset, table or locale changes rebuild it. English retains the original index and ranking.

## Reviewed overrides

`data/place-names.json` is the editable source of truth. Every entry requires a reason. City translations can be added/corrected with a string or removed with `null`. Keys are exact city/country groups; an override cannot spill into a namesake in another country. The four ATH/OTP/KBP/KRK overrides deliberately use the owner's requested **service city**, while English preserves the upstream municipality.

Swedish **Kyjiv** follows [Isof’s 21 September 2026 recommendation](https://www.isof.se/om-oss/pressrum/arkiv-pressmeddelanden/2026-09-21-isof-rekommenderar-kyjiv-i-stallet-for-kiev), replacing Natural Earth’s Kiev. Hungarian **Kijev** remains unchanged.

| City key           | Hungarian override | Swedish override | Rationale                                                                                                                                                                           |
| ------------------ | ------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kyiv\|UA           | –                  | Kyjiv            | Swedish Kyjiv follows Isof/Språkrådet’s 21 September 2026 recommendation, replacing Natural Earth 5.1.2 Kiev; Hungarian Kijev is unchanged.                                         |
| Kiev\|UA           | –                  | Kyjiv            | Swedish Kyjiv follows Isof/Språkrådet’s 21 September 2026 recommendation, replacing Natural Earth 5.1.2 Kiev; Hungarian Kijev is unchanged.                                         |
| Venezia (VE)\|IT   | Velence            | Venedig          | Venice uses its Italian municipality name and province code in OurAirports; Natural Earth lacks Venezia among the matching alias fields. Established Hungarian and Swedish exonyms. |
| Firenze (FI)\|IT   | –                  | Florens          | Florence uses its Italian municipality name and province code in OurAirports; Natural Earth lacks Firenze among the matching alias fields. Hungarian already displays Firenze.      |
| Spata-Artemida\|GR | Athén              | Aten             | ATH: owner spot-check requests the familiar Athens service city; the exact airport municipality is Spata-Artemida, east of Athens.                                                  |
| Otopeni\|RO        | Bukarest           | Bukarest         | OTP: owner spot-check requests Bucharest service-city names; the exact airport municipality is Otopeni.                                                                             |
| Boryspil\|UA       | Kijev              | Kyjiv            | KBP: use the service-city name for the exact airport municipality Boryspil. Swedish Kyjiv follows Isof/Språkrådet’s 21 September 2026 recommendation; Hungarian Kijev is unchanged. |
| Balice\|PL         | Krakkó             | Kraków           | KRK: owner spot-check requests Kraków service-city names; the exact airport municipality is Balice.                                                                                 |

| Label identity                     | Display / position override                                              | Rationale                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| country: United States of America  | en: United States, hu: Egyesült Államok                                  | Short cartographic names; Swedish USA is already concise upstream.                                                                                              |
| country: Micronesia                | hu: Mikronézia, sv: Mikronesien                                          | Use the short geographic name instead of the formal state name.                                                                                                 |
| country: S. Geo. and the Is.       | hu: Déli-Georgia és Déli-Sandwich-sz., sv: Sydgeorgien och Sydsandwichö. | Abbreviate the long island suffixes to keep the full geographic identities readable on the map.                                                                 |
| country: Br. Indian Ocean Ter.     | hu: Brit Indiai-óceáni ter., sv: Britt. Indiska oceanterrit.             | Shorten the long territorial designations for the map, preserving the British Indian Ocean identity.                                                            |
| country: Guernsey                  | hu: Guernsey                                                             | Omit the formal bailiwick designation.                                                                                                                          |
| country: Taiwan                    | hu: Tajvan                                                               | Use the geographic name rather than the formal Republic of China.                                                                                               |
| country: eSwatini                  | hu: Eswatini, sv: Eswatini                                               | Use the current short country name instead of the former Swaziland.                                                                                             |
| country: St. Vin. and Gren.        | hu: Saint Vincent és Grenadine-sz., sv: Saint Vincent och Grenadinerna   | Abbreviate the long Hungarian island designation for the map.                                                                                                   |
| country: Fr. S. Antarctic Lands    | hu: Francia déli területek                                               | Short cartographic form of the French Southern and Antarctic Lands.                                                                                             |
| country: Dominica                  | hu: Dominika                                                             | Use the short geographic name instead of the formal Commonwealth.                                                                                               |
| country: Dem. Rep. Congo           | hu: Kongói DK                                                            | Common cartographic abbreviation of Kongói Demokratikus Köztársaság.                                                                                            |
| country: Congo                     | hu: Kongói Közt.                                                         | Abbreviate Köztársaság while distinguishing the two Congos.                                                                                                     |
| country: Central African Rep.      | hu: Közép-afrikai Közt., sv: Centralafrikanska rep.                      | Abbreviate the unusually long republic designation.                                                                                                             |
| country: Cabo Verde                | hu: Zöld-foki-szigetek                                                   | Use the geographic island name rather than the formal republic.                                                                                                 |
| country: Indian Ocean Ter.         | hu: Ausztrál Indiai-óceáni ter., sv: Australiska Indiska oceanterrit.    | Shorten the Australian Indian Ocean Territories; correct upstream Swedish Australienska and avoid havsområde.                                                   |
| country: Heard I. and McDonald Is. | hu: Heard- és McDonald-szigetek                                          | Omit redundant sziget after Heard.                                                                                                                              |
| country: Siachen Glacier           | sv: Siachenglaciären                                                     | Use the Swedish compound noun instead of the spaced English-influenced form.                                                                                    |
| ocean: Arctic Ocean                | hu: Északi-Jeges-tenger; lat/lng: 84, 0                                  | Hand-placed in open water for a readable whole-globe label; Arctic uses the conventional Hungarian geographic name.                                             |
| ocean: SOUTHERN OCEAN              | en: Southern Ocean; lat/lng: -64, 60                                     | Hand-placed in open water for a readable whole-globe label; Arctic uses the conventional Hungarian geographic name.                                             |
| ocean: North Atlantic Ocean        | lat/lng: 30, -40                                                         | Hand-placed in open water for a readable whole-globe label; Arctic uses the conventional Hungarian geographic name.                                             |
| ocean: South Atlantic Ocean        | lat/lng: -30, -15                                                        | Hand-placed in open water for a readable whole-globe label; Arctic uses the conventional Hungarian geographic name.                                             |
| ocean: North Pacific Ocean         | lat/lng: 10, -175                                                        | Hand-placed in the central open North Pacific; the lower latitude keeps this long label clear of Honolulu airport labels on a phone.                            |
| ocean: South Pacific Ocean         | lat/lng: -30, -135                                                       | Hand-placed in open water for a readable whole-globe label; Arctic uses the conventional Hungarian geographic name.                                             |
| ocean: INDIAN OCEAN                | en: Indian Ocean; lat/lng: -25, 80                                       | Hand-placed in open water for a readable whole-globe label; Arctic uses the conventional Hungarian geographic name.                                             |
| sea: Laccadive Sea                 | hu: Lakkadív-tenger                                                      | Replace the untranslated Hungarian fallback with the Hungarian exonym.                                                                                          |
| sea: Bahía de Campeche             | en: Bay of Campeche, hu: Campeche-öböl                                   | Use English and Hungarian bay names instead of the Spanish source name.                                                                                         |
| sea: Golfo de California           | en: Gulf of California                                                   | Use the English name instead of the Spanish source name.                                                                                                        |
| sea: Bay of Fundy                  | hu: Fundy-öböl                                                           | Correct upstream Funfy typo; audited although rank-4 bays are currently omitted.                                                                                |
| sea: Philippine Sea                | hu: Fülöp-tenger                                                         | Use the established Hungarian geographic name rather than Filippínó-tenger.                                                                                     |
| sea: Sargasso Sea                  | hu: Sargasso-tenger                                                      | Keep the established Hungarian spelling.                                                                                                                        |
| sea: Mediterranean Sea             | lat/lng: 35, 18                                                          | Place the basin-wide label in central open Mediterranean water; the computed deepest interior point lies far east, crowding Levant labels in whole-globe views. |

The Fundy spelling correction is retained in the reviewed table even though scalerank-4 bays are not currently rendered.
