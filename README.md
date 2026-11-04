# Mosul Fuel

An offline map of the gas stations in Mosul and along the road from Bozan through Tel Kaif to Mosul, with search, driving routes and spoken turn-by-turn directions. It runs as a web app saved to the iPhone Home Screen, so it needs no App Store, no Apple developer account, and no internet once it's installed.

## Install on iPhone

1. With internet, open the app's link in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open **Mosul Fuel** from the Home Screen and wait until the top says **Offline ready** (about 19 MB).
4. Turn on Airplane Mode and open it again to check that it works.

The Home Screen app keeps its own copy, separate from Safari. That's why step 3 must happen in the Home Screen app. If you delete the app from the Home Screen, its saved copy and your added stations are deleted too.

## Using it

- **Search**: find a station or a place (neighbourhood, village) in Arabic or English. Pick a place to see the stations closest to it.
- **Government only / All stations**: show only government stations (حكومي, 450 IQD/L regular, 850 enhanced) or every station. Open a station to mark it Government, Commercial or Not sure. Your marks are saved on the phone and included in the backup.
- **Nearest gas station**: picks the station with the shortest drive time.
- **Route choices**: up to 3 routes, named by the road that makes each one different. Tap a card or a grey line to pick one.
- **List**: every station, sorted by drive time from where you are.
- **Start**: turn-by-turn directions with voice. It reroutes by itself if you miss a turn. Keep the app open and the screen on while driving.
- **Preview drive**: a fake drive along the route, so you can try it at home.
- **Driving map**: large street names, one-way arrows, and landmarks to steer by (mosques, churches, hospitals, clinics, police, schools, markets). Night colours follow the phone's dark mode. **Settings → Map labels** switches names between English and العربية.
- **Long-press the map**: add a gas station that isn't on the map, or set your location by hand. Use this when testing outside Mosul.

## How it works

| Part | File | Source |
|---|---|---|
| Map | `docs/data/basemap.pmtiles` (7.8 MB vector tiles) | OpenStreetMap via Protomaps |
| Roads for routing | `docs/data/graph.bin` (175k road points) | OpenStreetMap via Overpass |
| Gas stations | `docs/data/stations.json` (81) | OpenStreetMap `amenity=fuel`, kept by `tools/filter_stations.js`: Mosul city, within 1.5 km of the Bozan–Tel Kaif–Mosul road, plus Alqosh |
| Government / commercial | `docs/data/station-kinds.json` (`{"kinds": {"<station id>": "gov" or "com"}}`) | Station list from the Jelekan app's developer; names containing حكومي or 450 count as government until then |
| Place names for search | `docs/data/places.json` (581) | OpenStreetMap `place=*` |
| Routing | `docs/js/router.js` (Dijkstra / A* on the phone) | — |
| Directions | `docs/js/nav.js` | — |
| Offline saving | `docs/sw.js`, `docs/js/offline.js` | — |

To refresh the map data later, run `zsh tools/refresh.sh`, then commit and push. Phones download the update the next time they open the app with internet.

Map data © OpenStreetMap contributors, available under the ODbL.
