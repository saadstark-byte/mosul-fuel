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

// 5. Styles, tuned for driving: one per light/dark and English/Arabic labels.
//    (sprite URL is filled in by the app at runtime)
const COLORS = {
  // night: the stock dark style has dark-grey names on near-black; make streets and names readable
  dark: {
    minor_a: "#4b5157", minor_b: "#454a50", minor_service: "#3b4045", link: "#5d656d", major: "#66707a", highway: "#7a848e",
    buildings: "#2a2e33", roads_label_minor: "#c4cbd2", roads_label_major: "#e3e8ed",
    roads_label_minor_halo: "#15171a", roads_label_major_halo: "#15171a",
    subplace_label: "#aab3bc", subplace_label_halo: "#15171a", city_label: "#e9eef3", city_label_halo: "#15171a",
  },
  light: {
    roads_label_minor: "#303438", roads_label_major: "#1c1f22",
    roads_label_minor_halo: "#ffffff", roads_label_major_halo: "#ffffff",
  },
};
function tuneForDriving(list) {
  for (const l of list) {
    if (l.id === "roads_labels_minor") { // street names: bigger, from one zoom level earlier
      l.minzoom = 14;
      l.layout["text-size"] = ["interpolate", ["linear"], ["zoom"], 14, 12, 16, 14.5, 18, 17];
      l.paint = { ...l.paint, "text-halo-width": 2 };
    }
    if (l.id === "roads_labels_major") { // main roads: bigger and bolder
      l.layout["text-size"] = ["interpolate", ["linear"], ["zoom"], 11, 12, 14, 14.5, 17, 18];
      l.layout["text-font"] = ["Noto Sans Medium"];
      l.paint = { ...l.paint, "text-halo-width": 2.2 };
    }
    if (l.id === "roads_oneway") { // one-way arrows: visible from zoom 15, larger
      l.minzoom = 15;
      l.layout["icon-size"] = ["interpolate", ["linear"], ["zoom"], 15, 0.85, 18, 1.3];
      l.layout["symbol-spacing"] = 140;
    }
    if (l.id === "pois") l.layout.visibility = "none"; // shops/cafés clutter; the app draws driving landmarks instead
  }
  return list;
}
for (const f of ["style-light.json", "style-dark.json"]) fs.rmSync(path.join(DOCS, "data", f), { force: true });
for (const flavor of ["light", "dark"]) {
  for (const lang of ["en", "ar"]) {
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
      layers: tuneForDriving(layers("protomaps", { ...namedFlavor(flavor), ...COLORS[flavor] }, { lang })),
    };
    fs.writeFileSync(path.join(DOCS, `data/style-${flavor}-${lang}.json`), JSON.stringify(style));
  }
}
console.log("assets ok");
