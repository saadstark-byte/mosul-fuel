#!/bin/zsh
# Re-downloads the newest OpenStreetMap data for Mosul – Tel Kaif and rebuilds the app files in docs/.
# Needs: python3 (with Pillow), node, and `brew install pmtiles`. Run from anywhere: zsh tools/refresh.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BBOX_OVERPASS="36.20,42.90,36.58,43.35"   # south,west,north,east
BBOX_PMTILES="42.90,36.20,43.35,36.58"    # west,south,east,north
UA="mosul-fuel-offline-map/1.0 (personal project)"
mkdir -p data

echo "Downloading gas stations…"
curl -sf -m 200 -A "$UA" --data-urlencode "data=[out:json][timeout:180];nwr[\"amenity\"=\"fuel\"]($BBOX_OVERPASS);out center tags;" \
  https://overpass-api.de/api/interpreter -o data/fuel.json
echo "Downloading roads…"
curl -sf -m 400 -A "$UA" --data-urlencode "data=[out:json][timeout:360];way[\"highway\"~\"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road)$\"]($BBOX_OVERPASS);out body geom;" \
  https://overpass-api.de/api/interpreter -o data/roads.json

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
python3 -I tools/make_icons.py
node tools/build_manifest.js
echo "Done. Commit and push docs/ to update the app; phones pick it up next time they open it online."
