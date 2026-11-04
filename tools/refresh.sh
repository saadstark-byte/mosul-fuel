#!/bin/zsh
# Re-downloads the newest OpenStreetMap data for Mosul – Tel Kaif – Bozan and rebuilds the app files in docs/.
# Needs: python3, node, and `brew install pmtiles`. Run from anywhere: zsh tools/refresh.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BBOX_OVERPASS="36.20,42.90,36.80,43.40"   # south,west,north,east
BBOX_PMTILES="42.90,36.20,43.40,36.80"    # west,south,east,north
UA="mosul-fuel-offline-map/1.0 (personal project)"
mkdir -p data

# Overpass servers are often busy: retry with growing waits, alternating between two servers.
overpass() {  # overpass <query> <output file>
  local servers=(https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter)
  local wait=10 tmp="$2.part"
  for attempt in 1 2 3 4 5 6; do
    local url=${servers[$(( (attempt - 1) % 2 + 1 ))]}
    if curl -sf -m 400 -A "$UA" --data-urlencode "data=$1" "$url" -o "$tmp" \
       && python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('elements') else 1)" "$tmp"; then
      mv "$tmp" "$2"; return 0
    fi
    echo "  server busy ($url), retrying in ${wait}s…"
    sleep $wait; wait=$(( wait * 2 ))
  done
  echo "Could not download from Overpass. Try again later." >&2; return 1
}

echo "Downloading gas stations…"
overpass "[out:json][timeout:180];nwr[\"amenity\"=\"fuel\"]($BBOX_OVERPASS);out center tags;" data/fuel.json
echo "Downloading roads…"
overpass "[out:json][timeout:360];way[\"highway\"~\"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road)$\"]($BBOX_OVERPASS);out body geom;" data/roads.json

echo "Downloading map tiles…"
BUILD=$(curl -sf https://build-metadata.protomaps.dev/builds.json | python3 -c "import sys,json;print(json.load(sys.stdin)[-1]['key'])")
pmtiles extract "https://build.protomaps.com/$BUILD" data/basemap.pmtiles --bbox="$BBOX_PMTILES"

if [ ! -d data/assets-dl/basemaps-assets-main ]; then
  echo "Downloading fonts and icons…"
  mkdir -p data/assets-dl
  curl -sfL https://codeload.github.com/protomaps/basemaps-assets/tar.gz/refs/heads/main -o data/assets-dl/assets.tar.gz
  tar -xzf data/assets-dl/assets.tar.gz -C data/assets-dl
fi
[ -d tools/node_modules ] || (cd tools && npm install)

python3 -I tools/build_data.py
node tools/build_assets.js
node tools/build_manifest.js
echo "Done. Commit and push docs/ to update the app; phones pick it up next time they open it online."
