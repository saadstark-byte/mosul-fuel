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
  // night driving: deep blue-grey land, roads clearly lighter, muted warm highways, light names on dark halos
  dark: {
    background: "#1a2028", earth: "#1d232b",
    park_a: "#1f2e27", park_b: "#22362c", wood_a: "#1f2c25", wood_b: "#213328", scrub_a: "#212c27", scrub_b: "#233029",
    zoo: "#1f2e27", hospital: "#2b252a", school: "#262a30", industrial: "#22272e", military: "#27262a",
    pedestrian: "#252b33", sand: "#27282b", beach: "#2b2b2c", glacier: "#2a3038", aerodrome: "#232931", runway: "#363d47",
    water: "#10263d", pier: "#2c333c", buildings: "#323a45",
    other: "#3a424c", minor_service: "#3a424c", minor_a: "#4a535e", minor_b: "#454e58", link: "#5b6570", major: "#636d79",
    highway: "#a08457",
    minor_service_casing: "#171c22", minor_casing: "#171c22", link_casing: "#151a20",
    major_casing_early: "#151a20", major_casing_late: "#151a20",
    highway_casing_early: "#4a3d2b", highway_casing_late: "#4a3d2b",
    bridges_other: "#3f4751", bridges_minor: "#4e5762", bridges_link: "#606a75", bridges_major: "#68727e", bridges_highway: "#a68a5c",
    bridges_other_casing: "#11151a", bridges_minor_casing: "#11151a", bridges_link_casing: "#11151a",
    bridges_major_casing: "#11151a", bridges_highway_casing: "#3e3324",
    tunnel_other: "#333a43", tunnel_minor: "#353c45", tunnel_link: "#3b434c", tunnel_major: "#3d454f", tunnel_highway: "#5e5341",
    tunnel_other_casing: "#151a20", tunnel_minor_casing: "#151a20", tunnel_link_casing: "#151a20",
    tunnel_major_casing: "#151a20", tunnel_highway_casing: "#2e271d",
    railway: "#4f5864", boundaries: "#6b7588",
    roads_label_minor: "#c4cbd2", roads_label_major: "#e3e8ed",
    roads_label_minor_halo: "#11151a", roads_label_major_halo: "#11151a",
    subplace_label: "#aab3bc", subplace_label_halo: "#11151a", city_label: "#e9eef3", city_label_halo: "#11151a",
    state_label: "#7f8894", state_label_halo: "#11151a", country_label: "#9aa3ae",
    address_label: "#8e97a1", address_label_halo: "#11151a", ocean_label: "#6f8fb5",
    landcover: {
      grassland: "#1f2b25", barren: "#25272a", urban_area: "#20262e", farmland: "#212b25",
      glacier: "#2a3038", scrub: "#222c26", forest: "#1d2a23",
    },
  },
  // day: warm off-white land, amber highways, white streets with grey casings, blue Tigris
  light: {
    background: "#f2efe9", earth: "#f5f2ec",
    park_a: "#d9ebcf", park_b: "#c6e3b6", wood_a: "#dcebd2", wood_b: "#c9e2ba", scrub_a: "#e3edd6", scrub_b: "#d3e6c5",
    zoo: "#d9ebcf", hospital: "#f6e4e2", school: "#f3ebd9", industrial: "#ece9e4", military: "#ece6e1",
    pedestrian: "#f0ece4", sand: "#f2ebd7", beach: "#f4ecd0", glacier: "#f8f8f8", aerodrome: "#e9e8ea", runway: "#d6d6db",
    water: "#9ccbf0", pier: "#e6e2db", buildings: "#ddd7cd",
    other: "#ffffff", minor_service: "#ffffff", minor_a: "#ffffff", minor_b: "#ffffff", link: "#ffffff", major: "#ffffff",
    highway: "#fcd58a",
    minor_service_casing: "#e2ded6", minor_casing: "#dcd7cf", link_casing: "#d3cec6",
    major_casing_early: "#cdc8bf", major_casing_late: "#cdc8bf",
    highway_casing_early: "#dfa851", highway_casing_late: "#dfa851",
    bridges_other: "#ffffff", bridges_minor: "#ffffff", bridges_link: "#ffffff", bridges_major: "#ffffff", bridges_highway: "#fcd58a",
    bridges_other_casing: "#d6d1c9", bridges_minor_casing: "#d0cbc3", bridges_link_casing: "#c9c4bb",
    bridges_major_casing: "#bfb9af", bridges_highway_casing: "#d39a45",
    tunnel_other: "#f3f1ed", tunnel_minor: "#f3f1ed", tunnel_link: "#f3f1ed", tunnel_major: "#f3f1ed", tunnel_highway: "#fbe6bd",
    tunnel_other_casing: "#ddd9d2", tunnel_minor_casing: "#ddd9d2", tunnel_link_casing: "#ddd9d2",
    tunnel_major_casing: "#d5d0c8", tunnel_highway_casing: "#e8c690",
    railway: "#b4aea7", boundaries: "#a8a1b4",
    roads_label_minor: "#303438", roads_label_major: "#1c1f22",
    roads_label_minor_halo: "#ffffff", roads_label_major_halo: "#ffffff",
    subplace_label: "#5a5f66", subplace_label_halo: "#f5f2ec", city_label: "#25282c", city_label_halo: "#ffffff",
    state_label: "#7b7f86", state_label_halo: "#f5f2ec", country_label: "#6a6e75",
    address_label: "#6b6f75", address_label_halo: "#ffffff", ocean_label: "#4f7fb3",
    landcover: {
      grassland: "#e3eed8", barren: "#f3ecdc", urban_area: "#efebe4", farmland: "#e8efd9",
      glacier: "#ffffff", scrub: "#e4ecd5", forest: "#d6e8cb",
    },
  },
};
// trunk roads (kind major_road, kind_detail trunk) get the highway colours so main routes read as one hierarchy
const TRUNK_AS_HIGHWAY = {
  roads_major: "highway", roads_major_casing_early: "highway_casing_early", roads_major_casing_late: "highway_casing_late",
  roads_bridges_major: "bridges_highway", roads_bridges_major_casing: "bridges_highway_casing",
  roads_tunnels_major: "tunnel_highway", roads_tunnels_major_casing: "tunnel_highway_casing",
};
function tuneForDriving(list, c) {
  for (const l of list) {
    const hw = TRUNK_AS_HIGHWAY[l.id];
    if (hw && c && typeof l.paint["line-color"] === "string") {
      l.paint["line-color"] = ["case", ["==", ["get", "kind_detail"], "trunk"], c[hw], l.paint["line-color"]];
    }
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
      layers: (() => {
        const c = { ...namedFlavor(flavor), ...COLORS[flavor] };
        return tuneForDriving(layers("protomaps", c, { lang }), c);
      })(),
    };
    fs.writeFileSync(path.join(DOCS, `data/style-${flavor}-${lang}.json`), JSON.stringify(style));
  }
}
console.log("assets ok");
