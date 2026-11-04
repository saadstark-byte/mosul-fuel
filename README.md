# Mosul Fuel

An offline map of every gas station between Mosul and Tel Kaif, with driving routes and spoken turn-by-turn directions. It runs as a web app saved to the iPhone Home Screen, so it needs no App Store, no Apple developer account, and no internet once it's installed.

## Install on iPhone

1. With internet, open the app's link in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open **Mosul Fuel** from the Home Screen and wait until the top says **Offline ready** (about 15 MB).
4. Turn on Airplane Mode and open it again to check that it works.

The Home Screen app keeps its own copy, separate from Safari. That's why step 3 must happen in the Home Screen app. If you delete the app from the Home Screen, its saved copy and your added stations are deleted too.

## Using it

- **Nearest gas station**: picks the station with the shortest drive time.
- **List**: every station, sorted by drive time from where you are.
- **Start**: turn-by-turn directions with voice. It reroutes by itself if you miss a turn. Keep the app open and the screen on while driving.
- **Preview drive**: a fake drive along the route, so you can try it at home.
- **Long-press the map**: add a gas station that isn't on the map, or set your location by hand. Use this when testing outside Mosul.

## How it works

| Part | File | Source |
|---|---|---|
| Map | `docs/data/basemap.pmtiles` (5.6 MB vector tiles) | OpenStreetMap via Protomaps |
| Roads for routing | `docs/data/graph.bin` (130k road points) | OpenStreetMap via Overpass |
| Gas stations | `docs/data/stations.json` (109) | OpenStreetMap `amenity=fuel` |
| Routing | `docs/js/router.js` (Dijkstra / A* on the phone) | — |
| Directions | `docs/js/nav.js` | — |
| Offline saving | `docs/sw.js`, `docs/js/offline.js` | — |

To refresh the map data later, run `zsh tools/refresh.sh`, then commit and push. Phones download the update the next time they open the app with internet.

Map data © OpenStreetMap contributors, available under the ODbL.
