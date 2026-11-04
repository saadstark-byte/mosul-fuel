// Copies map libraries, fonts, sprites and the map file into docs/, and writes the map styles.
// Run from anywhere:  node tools/build_assets.js
const fs = require("fs");
const path = require("path");
const { layers, namedFlavor } = require("@protomaps/basemaps");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const NM = path.join(__dirname, "node_modules");
const ASSETS = path.join(ROOT, "data", "assets-dl", "basemaps-assets-main");

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// 1. Libraries
copy(path.join(NM, "maplibre-gl/dist/maplibre-gl.js"), path.join(DOCS, "vendor/maplibre-gl.js"));
copy(path.join(NM, "maplibre-gl/dist/maplibre-gl.css"), path.join(DOCS, "vendor/maplibre-gl.css"));
copy(path.join(NM, "pmtiles/dist/pmtiles.js"), path.join(DOCS, "vendor/pmtiles.js"));
copy(path.join(NM, "@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js"), path.join(DOCS, "vendor/mapbox-gl-rtl-text.js"));

// 2. Map tiles
copy(path.join(ROOT, "data/basemap.pmtiles"), path.join(DOCS, "data/basemap.pmtiles"));

// 3. Fonts: only Latin + Arabic (+ Syriac) ranges. Anything else is served as an empty glyph set by the app.
const STACKS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
const RANGES = [0, 256, 512, 768, 1536, 1792, 2048, 8192, 8448, 64256, 64512, 64768, 65024, 65280]
  .map((s) => `${s}-${s + 255}`);
const fontIndex = {};
fs.rmSync(path.join(DOCS, "fonts"), { recursive: true, force: true });
for (const stack of STACKS) {
  fontIndex[stack] = [];
  for (const r of RANGES) {
    const src = path.join(ASSETS, "fonts", stack, `${r}.pbf`);
    if (!fs.existsSync(src)) continue;
    copy(src, path.join(DOCS, "fonts", stack, `${r}.pbf`));
    fontIndex[stack].push(r);
  }
}
fs.writeFileSync(path.join(DOCS, "fonts/index.json"), JSON.stringify(fontIndex));

// 4. Sprites
for (const flavor of ["light", "dark"]) {
  for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) {
    copy(path.join(ASSETS, "sprites/v4", flavor + suffix), path.join(DOCS, "sprites", flavor + suffix));
  }
}

// 5. Styles (sprite URL is filled in by the app at runtime)
for (const flavor of ["light", "dark"]) {
  const style = {
    version: 8,
    glyphs: "glyphs://{fontstack}/{range}",
    sprite: flavor,
    sources: {
      protomaps: {
        type: "vector",
        url: "pmtiles://basemap",
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: layers("protomaps", namedFlavor(flavor), { lang: "en" }),
  };
  fs.writeFileSync(path.join(DOCS, `data/style-${flavor}.json`), JSON.stringify(style));
}
console.log("assets ok");
