// Mosul Fuel – offline gas station map with turn-by-turn routes.
"use strict";

const $ = (id) => document.getElementById(id);
const HOME = { center: [43.14, 36.46], zoom: 10.4 };
const LS_USER = "mfuel.userStations.v1";
const LS_VOICE = "mfuel.voice";
const LS_LANG = "mfuel.lang";

const S = {
  map: null, graph: null, swOk: false,
  stations: [], places: [], fonts: {}, placeMarker: null, userKinds: {}, kindData: {}, govOnly: true,
  me: null, gps: null, costs: null, rankedAt: null,
  selected: null, preview: null, previewAt: null, routes: [], routeIdx: 0,
  nav: null, navRoute: null, follow: true, sim: null, lastReroute: 0, lastFix: null,
  wakeLock: null, marker: null, menuAt: null, editing: null, lang: "en",
};
window.S = S; // handy for debugging from the console

/* ---------- small helpers ---------- */
function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}
function setStatus(kind, text) {
  const p = $("status");
  p.className = "pill " + (kind || "");
  $("status-text").textContent = text;
}
function showHint(html, onClose) {
  const h = $("hint");
  h.innerHTML = html + ' <button type="button" id="hint-x">OK</button>';
  h.hidden = false;
  $("hint-x").onclick = () => { h.hidden = true; onClose?.(); };
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function loadUserStations() {
  try { return JSON.parse(localStorage.getItem(LS_USER) || "[]"); } catch { return []; }
}
function saveUserStations() {
  const list = S.stations.filter((s) => s.user).map(({ id, lat, lon, name, note }) => ({ id, lat, lon, name, note }));
  try { localStorage.setItem(LS_USER, JSON.stringify(list)); } catch { toast("Could not save on this phone"); }
}
const stationTitle = (s) => s.name || s.nameEn || "Gas station";
const PUMP_PATH = "M19.8 7.6 16.2 4l-1.1 1.1 2 2a2.4 2.4 0 0 0 .7 4.3V18a1 1 0 0 1-2 0v-4.5a2 2 0 0 0-2-2H13V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16h10v-8h1.3v4.5a3 3 0 0 0 6 0V9a2 2 0 0 0-.5-1.4zM11 10H5V5h6zm7.5 1a1 1 0 1 1 0-2 1 1 0 0 1 0 2z";
const PUMP_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" fill-rule="evenodd" d="${PUMP_PATH}"/></svg>`;
const byId = (id) => S.stations.find((s) => s.id === id);

/* ---------- government (حكومي) vs commercial (تجاري) ---------- */
const LS_KINDS = "mfuel.kinds.v1";
const LS_GOVONLY = "mfuel.govOnly";
const KIND_NAME = { gov: "Government", com: "Commercial", "": "Not sure" };
function loadUserKinds() { try { return JSON.parse(localStorage.getItem(LS_KINDS) || "{}"); } catch { return {}; } }
function saveUserKinds() { try { localStorage.setItem(LS_KINDS, JSON.stringify(S.userKinds)); } catch { toast("Could not save on this phone"); } }
function guessKind(s) {
  const t = [s.name, s.nameAr, s.nameEn, s.operator, s.note].join(" ");
  if (/تجار|commercial/i.test(t)) return "com";
  if (/غاز|lpg/i.test(t)) return ""; // LPG (car gas) outlets, not petrol
  if (/حكوم|government|450|٤٥٠/i.test(t)) return "gov";
  return "";
}
// your own marking wins, then the station list from Jelekan, then a guess from the name
function kindOf(s) { return S.userKinds[s.id] ?? S.kindData[s.id] ?? guessKind(s); }
function kindSource(s) { return s.id in S.userKinds ? "marked by you" : s.id in S.kindData ? "from the station list" : guessKind(s) ? "guessed from the name" : ""; }
function shown() { return S.govOnly ? S.stations.filter((s) => kindOf(s) === "gov") : S.stations; }
function setGovOnly(on, remember = true) {
  S.govOnly = on;
  if (remember) try { localStorage.setItem(LS_GOVONLY, on ? "1" : "0"); } catch {}
  for (const b of $("kind-filter").querySelectorAll("button")) b.classList.toggle("on", (b.dataset.v === "gov") === on);
  $("nearest-label").textContent = on ? "Nearest government station" : "Nearest gas station";
  refreshStationsLayer();
  renderList();
}
function setKind(s, v) {
  S.userKinds[s.id] = v;
  saveUserKinds();
  refreshStationsLayer();
  renderList();
  if (S.selected === s) renderKind(s);
  if (S.govOnly && v !== "gov") toast("Hidden from the map and list, because “Government only” is on");
}
function renderKind(s) {
  const k = kindOf(s);
  for (const b of $("st-kind").querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === k);
  const src = kindSource(s);
  $("st-kind-note").textContent = (k === "gov" ? "Government price: 450 IQD/L regular · 850 enhanced" : k === "com" ? "Commercial (تجاري) prices" : "Type unknown. Mark it if you know.") + (src ? ` · ${src}` : "");
}

/* ---------- maneuver arrows ---------- */
function arrowSvg(mod, exit) {
  const P = {
    straight: "M12 21V4M6 10l6-6 6 6",
    depart: "M12 21V4M6 10l6-6 6 6",
    right: "M6 21v-8a3 3 0 0 1 3-3h10M14 5l5 5-5 5",
    "slight-right": "M8 21v-6.5a3 3 0 0 1 .9-2.1L17 4.5M11 4h6.5v6.5",
    "sharp-right": "M7 21V8a4 4 0 0 1 6.8-2.8L19 10.5M19 4.5v6h-6",
    uturn: "M7 21V10a5 5 0 0 1 10 0v7M13 13.5l4 4 4-4",
    roundabout: "M12 21v-5M12 16a4.5 4.5 0 1 1 4.5-4.5H21M18 8.5l3 3-3 3",
    arrive: "M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  };
  let flip = false, key = mod || "straight";
  if (key.endsWith("left")) { flip = true; key = key.replace("left", "right"); }
  const d = P[key] || P.straight;
  const tr = flip ? ' transform="translate(24 0) scale(-1 1)"' : "";
  const num = mod === "roundabout" && exit ? `<text x="12" y="13.2" font-size="6.5" font-weight="800" text-anchor="middle" fill="currentColor" stroke="none">${exit}</text>` : "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"${tr}/>${num}</svg>`;
}

/* ---------- map ---------- */
function fuelIcon(color) {
  const s = 56, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.beginPath(); g.arc(28, 28, 24, 0, Math.PI * 2);
  g.fillStyle = color; g.fill();
  g.lineWidth = 4; g.strokeStyle = "#fff"; g.stroke();
  g.save(); g.translate(28, 28); g.scale(1.45, 1.45); g.translate(-12, -12);
  g.fillStyle = "#fff";
  g.fill(new Path2D(PUMP_PATH), "evenodd");
  g.restore();
  return g.getImageData(0, 0, s, s);
}

// Landmarks you can steer by: small round badges drawn on the phone (no extra download).
function landmarkIcon(color, draw) {
  const s = 40, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.beginPath(); g.arc(20, 20, 17, 0, Math.PI * 2);
  g.fillStyle = color; g.fill();
  g.lineWidth = 3; g.strokeStyle = "#fff"; g.stroke();
  g.fillStyle = "#fff"; g.strokeStyle = "#fff";
  draw(g);
  return g.getImageData(0, 0, s, s);
}
const LANDMARK_ICONS = {
  "lm-mosque": ["#0c8599", (g) => { // crescent: white disc with a badge-coloured disc over it
    g.beginPath(); g.arc(18, 20, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#0c8599"; g.beginPath(); g.arc(22.5, 17.5, 8.5, 0, Math.PI * 2); g.fill();
  }],
  "lm-church": ["#5f3dc4", (g) => { g.fillRect(18, 9, 4, 22); g.fillRect(12, 15, 16, 4); }],
  "lm-worship": ["#0c8599", (g) => { g.beginPath(); g.arc(20, 20, 5, 0, Math.PI * 2); g.fill(); }],
  "lm-hospital": ["#e03131", (g) => { g.fillRect(17, 10, 6, 20); g.fillRect(10, 17, 20, 6); }],
  "lm-clinic": ["#f06595", (g) => { g.fillRect(18, 12, 4, 16); g.fillRect(12, 18, 16, 4); }],
  "lm-police": ["#1864ab", (g) => { // shield
    g.beginPath(); g.moveTo(20, 9); g.lineTo(29, 13); g.quadraticCurveTo(29, 25, 20, 31); g.quadraticCurveTo(11, 25, 11, 13); g.closePath(); g.fill();
  }],
  "lm-school": ["#4c6ef5", (g) => { g.fillRect(11, 13, 8, 14); g.fillRect(21, 13, 8, 14); }], // open book
  "lm-market": ["#c2255c", (g) => { g.fillRect(12, 17, 16, 11); g.beginPath(); g.moveTo(10, 17); g.lineTo(20, 10); g.lineTo(30, 17); g.closePath(); g.fill(); }],
};
function addLandmarks(map, dark) {
  for (const [id, [color, draw]] of Object.entries(LANDMARK_ICONS)) if (!map.hasImage(id)) map.addImage(id, landmarkIcon(color, draw), { pixelRatio: 2 });
  const name = ["coalesce", ["get", S.lang === "ar" ? "name:ar" : "name:en"], ["get", "name"]];
  const has = (word) => ["in", word, ["coalesce", ["get", "name"], ""]];
  const KINDS = ["place_of_worship", "hospital", "clinic", "doctors", "police", "school", "university", "college", "marketplace", "supermarket", "department_store"];
  map.addLayer({
    id: "landmarks", type: "symbol", source: "protomaps", "source-layer": "pois", minzoom: 13,
    filter: ["all", ["in", ["get", "kind"], ["literal", KINDS]],
      [">=", ["zoom"], ["match", ["get", "kind"], "hospital", 13, ["place_of_worship", "police", "university"], 14.5, 15.5]]],
    layout: {
      "icon-image": ["match", ["get", "kind"],
        "place_of_worship", ["case",
          ["any", ["==", ["get", "kind_detail"], "muslim"], has("جامع"), has("مسجد"), has("Mosque"), has("mosque")], "lm-mosque",
          ["any", ["==", ["get", "kind_detail"], "christian"], has("كنيسة"), has("Church"), has("church"), has("دير")], "lm-church",
          "lm-worship"],
        "hospital", "lm-hospital", ["clinic", "doctors"], "lm-clinic", "police", "lm-police",
        ["school", "university", "college"], "lm-school", "lm-market"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.7, 16, 0.9, 18, 1.1],
      "icon-padding": 4,
      "text-field": ["step", ["zoom"], "", 16, name],
      "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-max-width": 8,
      "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true,
    },
    paint: { "text-color": dark ? "#cfd6dd" : "#3b4148", "text-halo-color": dark ? "#15171a" : "#ffffff", "text-halo-width": 1.6 },
  });
}

async function loadStyle() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const flavor = dark ? "dark" : "light";
  const style = await (await fetch(`data/style-${flavor}-${S.lang}.json`)).json();
  style.sprite = new URL(`sprites/${flavor}`, location.href).href;
  return style;
}

// Full style reload (labels language or day/night); the app's own layers are re-added on "style.load".
async function reloadStyle() {
  if (S.map) S.map.setStyle(await loadStyle(), { diff: false });
}
function setLang(lang) {
  S.lang = lang;
  try { localStorage.setItem(LS_LANG, lang); } catch {}
  for (const b of $("set-lang").querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === lang);
  reloadStyle();
}

async function initMap() {
  try { S.lang = localStorage.getItem(LS_LANG) === "ar" ? "ar" : "en"; } catch {}
  const [pmBuf, fonts, style, rtl] = await Promise.all([
    fetch("data/basemap.pmtiles").then((r) => { if (!r.ok) throw new Error("map file " + r.status); return r.arrayBuffer(); }),
    fetch("fonts/index.json").then((r) => r.json()),
    loadStyle(),
    fetch("vendor/mapbox-gl-rtl-text.js").then((r) => r.text()),
  ]);
  S.fonts = fonts;

  // Map tiles come from one file kept in memory, so no network is needed.
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocol.add(new pmtiles.PMTiles({ getKey: () => "basemap", getBytes: async (o, l) => ({ data: pmBuf.slice(o, o + l) }) }));

  // Fonts: serve bundled ranges; anything else (scripts not used here) gets an empty set.
  maplibregl.addProtocol("glyphs", async (params) => {
    const m = params.url.match(/^glyphs:\/\/(.+)\/(\d+-\d+)$/);
    if (!m) return { data: new ArrayBuffer(0) };
    const stack = decodeURIComponent(m[1]).split(",")[0].trim();
    if (!S.fonts[stack]?.includes(m[2])) return { data: new ArrayBuffer(0) };
    try {
      const r = await fetch(`fonts/${encodeURIComponent(stack)}/${m[2]}.pbf`);
      return { data: r.ok ? await r.arrayBuffer() : new ArrayBuffer(0) };
    } catch { return { data: new ArrayBuffer(0) }; }
  });

  // Arabic shaping for map labels (loaded from a local copy).
  try {
    await maplibregl.setRTLTextPlugin(URL.createObjectURL(new Blob([rtl], { type: "text/javascript" })), false);
  } catch (e) { console.warn("RTL plugin", e); }

  S.map = new maplibregl.Map({
    container: "map", style, center: HOME.center, zoom: HOME.zoom,
    minZoom: 9, maxZoom: 18.5, maxBounds: [[42.55, 35.95], [43.75, 37.05]],
    attributionControl: { compact: true }, touchPitch: false,
  });
  S.map.on("style.load", addAppLayers);
  // keep the map credits collapsed to an (i) button so they don't cover the route
  S.map.once("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
  S.map.on("click", "stations-icon", (e) => { const f = e.features?.[0]; if (f) selectStation(f.properties.id); });
  S.map.on("click", "route-alt-line", (e) => { const f = e.features?.[0]; if (f) chooseRoute(+f.properties.i); });
  S.map.on("mouseenter", "stations-icon", () => (S.map.getCanvas().style.cursor = "pointer"));
  S.map.on("mouseleave", "stations-icon", () => (S.map.getCanvas().style.cursor = ""));
  const stopFollow = (e) => { if (e.originalEvent && S.nav) { S.follow = false; $("btn-recenter").hidden = false; } };
  S.map.on("dragstart", stopFollow);
  S.map.on("zoomstart", stopFollow);
  S.map.on("rotatestart", stopFollow);
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", reloadStyle);
  setupLongPress();

  const el = document.createElement("div");
  el.className = "me";
  el.innerHTML = '<div class="cone"></div><div class="core"></div><svg class="arrow" viewBox="0 0 40 40"><path d="M20 3 33 35 20 28 7 35z" fill="#1c7ed6" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>';
  S.marker = new maplibregl.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" });
}

function addAppLayers() {
  const map = S.map;
  for (const [id, color] of [["fuel-osm", "#f08c00"], ["fuel-user", "#7048e8"], ["fuel-sel", "#e03131"], ["fuel-gov", "#2b8a3e"], ["fuel-com", "#868e96"]]) {
    if (!map.hasImage(id)) map.addImage(id, fuelIcon(color), { pixelRatio: 2 });
  }
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  // other route choices: grey, under the chosen route, tap to pick
  map.addSource("route-alts", { type: "geojson", data: altsGeoJSON() });
  map.addLayer({ id: "route-alt-casing", type: "line", source: "route-alts",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#5f6f68", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 13] } }, firstSymbol);
  map.addLayer({ id: "route-alt-line", type: "line", source: "route-alts",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#b4c3bc", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 8] } }, firstSymbol);
  map.addSource("route", { type: "geojson", data: routeGeoJSON(S.nav ? S.navRoute : S.preview) });
  map.addLayer({ id: "route-casing", type: "line", source: "route", filter: ["==", ["get", "kind"], "road"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#0b4a8f", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 14] } }, firstSymbol);
  map.addLayer({ id: "route-line", type: "line", source: "route", filter: ["==", ["get", "kind"], "road"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#339af0", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 9] } }, firstSymbol);
  map.addLayer({ id: "route-tail", type: "line", source: "route", filter: ["==", ["get", "kind"], "tail"],
    layout: { "line-cap": "round" },
    paint: { "line-color": "#339af0", "line-width": 4, "line-dasharray": [0.5, 2] } }, firstSymbol);

  addLandmarks(map, matchMedia("(prefers-color-scheme: dark)").matches);
  map.addSource("stations", { type: "geojson", data: stationsGeoJSON() });
  map.addLayer({ id: "stations-icon", type: "symbol", source: "stations",
    layout: {
      "icon-image": ["match", ["get", "kind"], "gov", "fuel-gov", "com", "fuel-com", ["case", ["get", "user"], "fuel-user", "fuel-osm"]],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.55, 13, 0.85, 16, 1.05],
      "icon-allow-overlap": true,
      "text-field": ["step", ["zoom"], "", 13.5, ["get", "label"]],
      "text-font": ["Noto Sans Medium"], "text-size": 12.5,
      "text-offset": [0, 1.35], "text-anchor": "top", "text-optional": true, "text-max-width": 9,
    },
    paint: { "text-color": "#7a3d00", "text-halo-color": "#fff", "text-halo-width": 1.6 } });
  map.addLayer({ id: "stations-sel", type: "symbol", source: "stations", filter: ["==", ["get", "id"], S.selected?.id || ""],
    layout: { "icon-image": "fuel-sel", "icon-size": 1.35, "icon-allow-overlap": true, "icon-ignore-placement": true } });
}

function stationsGeoJSON() {
  return { type: "FeatureCollection", features: shown().map((s) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: { id: s.id, label: stationTitle(s), user: !!s.user, kind: kindOf(s) },
  })) };
}
function refreshStationsLayer() { S.map?.getSource("stations")?.setData(stationsGeoJSON()); }
function setSelectedLayer() { if (S.map?.getLayer("stations-sel")) S.map.setFilter("stations-sel", ["==", ["get", "id"], S.selected?.id || ""]); }

function routeGeoJSON(r) {
  if (!r) return { type: "FeatureCollection", features: [] };
  const road = r.coords.slice(0, r.roadEnd + 1);
  const feats = [{ type: "Feature", properties: { kind: "road" }, geometry: { type: "LineString", coordinates: road } }];
  if (r.coords.length > r.roadEnd + 1) feats.push({ type: "Feature", properties: { kind: "tail" }, geometry: { type: "LineString", coordinates: r.coords.slice(r.roadEnd) } });
  return { type: "FeatureCollection", features: feats };
}
function drawRoute(r) { S.map?.getSource("route")?.setData(routeGeoJSON(r)); drawAlts(); }
function altsGeoJSON() {
  const feats = S.nav ? [] : (S.routes || []).map((r, i) => (i === S.routeIdx ? null : {
    type: "Feature", properties: { i }, geometry: { type: "LineString", coordinates: r.coords.slice(0, r.roadEnd + 1) },
  })).filter(Boolean);
  return { type: "FeatureCollection", features: feats };
}
function drawAlts() { S.map?.getSource("route-alts")?.setData(altsGeoJSON()); }

/* ---------- long press menu ---------- */
function setupLongPress() {
  const el = S.map.getCanvasContainer();
  let timer = null, start = null;
  const clear = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return clear();
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    clear();
    timer = setTimeout(() => { timer = null; openMenu(start.x, start.y); }, 550);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (!timer) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) clear();
  }, { passive: true });
  el.addEventListener("touchend", clear);
  el.addEventListener("touchcancel", clear);
  S.map.on("contextmenu", (e) => openMenu(e.point.x, e.point.y));
}
function openMenu(x, y) {
  if (S.nav) return;
  S.menuAt = S.map.unproject([x, y]);
  const m = $("menu");
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(Math.max(8, x - w / 2), innerWidth - w - 8) + "px";
  m.style.top = Math.min(Math.max(8, y - h - 12), innerHeight - h - 8) + "px";
  navigator.vibrate?.(15);
}
function closeMenu() { $("menu").hidden = true; }

/* ---------- graph & stations ---------- */
async function loadData() {
  const [stations, ways, buf, places, kinds] = await Promise.all([
    fetch("data/stations.json").then((r) => r.json()),
    fetch("data/graph-ways.json").then((r) => r.json()),
    fetch("data/graph.bin").then((r) => r.arrayBuffer()),
    fetch("data/places.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch("data/station-kinds.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  S.places = places;
  S.kindData = kinds.kinds || {};
  S.userKinds = loadUserKinds();
  S.stations = stations.concat(loadUserStations().map((s) => ({ ...s, user: true })));
  // your own choice wins; otherwise show government only once enough stations are known to be government
  let saved = null;
  try { saved = localStorage.getItem(LS_GOVONLY); } catch {}
  S.govOnly = saved != null ? saved === "1" : S.stations.filter((s) => kindOf(s) === "gov").length >= 5;
  setGovOnly(S.govOnly, false); // also draws the stations and the list
  await new Promise((r) => setTimeout(r, 30)); // let the map paint first
  S.graph = new RoadGraph(buf, ways);
  S.stations.forEach(snapStation);
  if (S.me) rank();
}
function snapStation(s) {
  const sn = S.graph?.snap(s.lat, s.lon, 400);
  if (!sn) { s.node = -1; s.walk = 0; return; }
  s.node = S.graph.destNode(sn);
  s.walk = Geo.dist(S.graph.lat[s.node], S.graph.lon[s.node], s.lat, s.lon);
}

// Rank every station by driving time from where you are.
function rank() {
  S.costs = null;
  if (S.graph && S.me) {
    const sn = S.graph.snap(S.me.lat, S.me.lon, 400);
    if (sn) {
      const res = S.graph.costsTo(sn, S.stations.map((s) => s.node));
      S.costs = new Map();
      S.stations.forEach((s, i) => { if (res[i]) S.costs.set(s.id, { time: res[i].time + s.walk / 4, meters: res[i].meters + s.walk }); });
    }
    S.rankedAt = { lat: S.me.lat, lon: S.me.lon, t: Date.now() };
  }
  renderList();
}
function maybeRank() {
  if (!S.graph || !S.me) return;
  const r = S.rankedAt;
  if (!r || Geo.dist(r.lat, r.lon, S.me.lat, S.me.lon) > 150 || Date.now() - r.t > 120000) rank();
  if (S.selected && !S.nav) {
    const p = S.previewAt;
    if (!p || Geo.dist(p.lat, p.lon, S.me.lat, S.me.lon) > 60) computePreview(false);
  }
}

/* ---------- search ---------- */
// Loose matching for Arabic, Kurdish and English: ignores diacritics, hamza forms, ة/ه, ى/ي, case and punctuation.
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/[ىیې]/g, "ي").replace(/ک/g, "ك").replace(/ە/g, "ه")
    .replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)])
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function matcher(q) {
  const words = norm(q).split(" ").filter(Boolean);
  return (text) => { const t = norm(text); return words.every((w) => t.includes(w)); };
}
const PLACE_TYPE = { city: "City", town: "Town", village: "Village", hamlet: "Village", suburb: "Area", neighbourhood: "Neighbourhood", quarter: "Neighbourhood", locality: "Place", isolated_dwelling: "Place" };
const PIN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>';

function goToPlace(i) {
  const p = S.places[i];
  if (!p) return;
  const [name, nameEn, , lat, lon] = p;
  endSearchMode();
  // list the stations closest to this place, and show the place with its nearest stations on the map
  S.near = { name: nameEn && nameEn !== name ? `${nameEn} · ${name}` : name, lat, lon };
  $("search").value = "";
  $("search-clear").hidden = false;
  S.placeMarker?.remove();
  S.placeMarker = new maplibregl.Marker({ color: "#1c7ed6" }).setLngLat([lon, lat]).addTo(S.map);
  const b = new maplibregl.LngLatBounds([lon, lat], [lon, lat]);
  shown().map((s) => [Geo.dist(lat, lon, s.lat, s.lon), s]).sort((x, y) => x[0] - y[0]).slice(0, 3).forEach(([, s]) => b.extend([s.lon, s.lat]));
  renderList();
  S.map.fitBounds(b, { padding: { top: 90, bottom: $("sheet").offsetHeight + 40, left: 50, right: 50 }, maxZoom: 15, duration: 900 });
}
function endSearchMode() {
  $("search").blur();
  $("sheet").classList.remove("searching", "expanded");
}

function renderList() {
  const q = $("search").value.trim();
  const match = q ? matcher(q) : null;
  let stations = shown();
  if (match) stations = stations.filter((s) => match([s.name, s.nameEn, s.nameAr, s.brand, s.operator, s.street, s.note].join(" ")));
  const rows = stations.map((s) => ({
    s, c: S.costs?.get(s.id) || null,
    d: S.me ? Geo.dist(S.me.lat, S.me.lon, s.lat, s.lon) : null,
  }));
  const near = !match && S.near;
  if (near) {
    rows.forEach((r) => { r.dn = Geo.dist(near.lat, near.lon, r.s.lat, r.s.lon); });
    rows.sort((a, b) => a.dn - b.dn);
  } else if (S.costs) rows.sort((a, b) => (a.c ? a.c.time : 1e9 + a.d) - (b.c ? b.c.time : 1e9 + b.d));
  else if (S.me) rows.sort((a, b) => a.d - b.d);
  else rows.sort((a, b) => stationTitle(a.s).localeCompare(stationTitle(b.s), "ar"));

  let placeRows = "";
  let nPlaces = 0;
  if (match) {
    const found = [];
    S.places.forEach((p, i) => { if (match(p[0] + " " + p[1] + " " + p[2])) found.push(i); });
    nPlaces = found.length;
    if (S.me) found.sort((a, b) => Geo.dist(S.me.lat, S.me.lon, S.places[a][3], S.places[a][4]) - Geo.dist(S.me.lat, S.me.lon, S.places[b][3], S.places[b][4]));
    placeRows = found.slice(0, 6).map((i) => {
      const [name, nameEn, , lat, lon, type] = S.places[i];
      const d = S.me ? `<b>${Fmt.dist(Geo.dist(S.me.lat, S.me.lon, lat, lon))}</b><span>straight</span>` : "";
      return `<li data-place="${i}"><div class="ico place">${PIN_SVG}</div>
        <div class="names"><div class="n1" dir="auto">${esc(nameEn && nameEn !== name ? nameEn : name)}</div><div class="n2" dir="auto">${esc(PLACE_TYPE[type] || "Place")}${nameEn && nameEn !== name ? " · " + esc(name) : ""}</div></div>
        <div class="d">${d}</div></li>`;
    }).join("");
  }

  if (match) {
    $("list-title").textContent = `${rows.length} station${rows.length === 1 ? "" : "s"}${nPlaces ? ` · ${Math.min(nPlaces, 6)} place${nPlaces === 1 ? "" : "s"}` : ""}`;
    $("list-sub").textContent = `for “${q}”`;
  } else if (near) {
    $("list-title").textContent = `Near ${near.name}`;
    $("list-sub").textContent = "distance from there";
  } else {
    $("list-title").textContent = `${S.govOnly ? "Government stations" : "Gas stations"} (${stations.length})`;
    $("list-sub").textContent = S.costs ? "by road from you" : S.me ? (S.graph ? "straight line · you're away from the roads" : "straight line") : "waiting for location…";
  }
  const empty = match && !rows.length && !placeRows ? `<li class="empty">Nothing found. Try the Arabic or English spelling.${S.govOnly ? " (Showing government stations only.)" : ""}</li>`
    : !match && !rows.length && S.govOnly ? `<li class="empty">No stations are marked as government yet. Tap “All stations”, open a station, and mark it Government.</li>` : "";
  $("list").innerHTML = placeRows + empty + rows.map(({ s, c, d, dn }) => {
    const second = s.nameEn && s.nameEn !== s.name ? s.nameEn : s.user ? (s.note || "Added by you") : (s.street || s.brand || s.nameAr || "");
    const dist = dn != null ? `<b>${Fmt.dist(dn)}</b><span>from there</span>`
      : c ? `<b>${Fmt.time(c.time)}</b><span>${Fmt.dist(c.meters)}</span>`
      : d != null ? `<b>${Fmt.dist(d)}</b><span>straight</span>` : "";
    const k = kindOf(s);
    return `<li data-id="${esc(s.id)}"><div class="ico ${k || (s.user ? "user" : "")}" title="${KIND_NAME[k]}">${PUMP_SVG}</div>
      <div class="names"><div class="n1" dir="auto">${esc(stationTitle(s))}</div><div class="n2" dir="auto">${esc(second)}</div></div>
      <div class="d">${dist}</div></li>`;
  }).join("");
}

/* ---------- bottom card: swipe between small, half and full ---------- */
function sheetState() {
  const c = $("sheet").classList;
  return c.contains("collapsed") ? "min" : c.contains("expanded") ? "max" : "mid";
}
function setSheet(state) {
  const c = $("sheet").classList;
  c.toggle("collapsed", state === "min");
  c.toggle("expanded", state === "max");
}
function sheetHeights() {
  const sh = $("sheet"), vh = innerHeight;
  const safe = parseFloat(getComputedStyle(sh).paddingBottom) - 12 || 0;
  const tall = sh.classList.contains("tall");
  return { min: (tall ? 150 : 96) + safe, mid: vh * (tall ? 0.66 : 0.46), max: vh * 0.86 };
}
function setupSheetDrag() {
  const sheet = $("sheet");
  let d = null; // current gesture
  const scrollerOf = (el) => el.closest?.("#list, #view-station");
  const begin = (y, target) => {
    if (sheet.classList.contains("nav")) return;
    const t = performance.now();
    d = { y0: y, h0: sheet.offsetHeight, scroller: target.closest?.("#grip") ? null : scrollerOf(target), dragging: false, lastY: y, lastT: t, v: 0 };
  };
  const move = (y, e) => {
    if (!d) return;
    const dy = y - d.y0;
    if (!d.dragging) {
      if (Math.abs(dy) < 8) return;
      const sc = d.scroller;
      // inside the list: let it scroll, unless it's at the top and you pull down, or the card can still grow
      if (sc && !(dy > 0 && sc.scrollTop <= 0) && !(dy < 0 && sheetState() !== "max")) { d = null; return; }
      d.dragging = true;
      d.y0 = y;
      if (sheet.classList.contains("searching")) { $("search").blur(); sheet.classList.remove("searching"); d.h0 = sheet.offsetHeight; }
      sheet.classList.add("dragging");
    }
    if (e.cancelable) e.preventDefault();
    const H = sheetHeights();
    sheet.style.maxHeight = Math.max(H.min, Math.min(H.max, d.h0 - (y - d.y0))) + "px";
    const now = performance.now();
    d.v = (y - d.lastY) / Math.max(1, now - d.lastT); // px per ms, + = moving down
    d.lastY = y; d.lastT = now;
  };
  const finish = () => {
    if (!d) return;
    const g = d; d = null;
    if (!g.dragging) return;
    S.sheetDragged = true; setTimeout(() => (S.sheetDragged = false), 50); // don't treat the drag as a tap
    const h = sheet.offsetHeight, H = sheetHeights();
    sheet.classList.remove("dragging");
    sheet.style.maxHeight = "";
    let state;
    if (g.v > 0.4) state = h > H.mid + 10 ? "mid" : "min";        // flicked down
    else if (g.v < -0.4) state = h < H.mid - 10 ? "mid" : "max";  // flicked up
    else state = ["min", "mid", "max"].reduce((a, b) => (Math.abs(H[b] - h) < Math.abs(H[a] - h) ? b : a)); // nearest
    setSheet(state);
    if (state !== "max") $("list").scrollTop = 0;
  };
  sheet.addEventListener("touchstart", (e) => { if (e.touches.length === 1) begin(e.touches[0].clientY, e.target); }, { passive: true });
  sheet.addEventListener("touchmove", (e) => move(e.touches[0].clientY, e), { passive: false });
  sheet.addEventListener("touchend", finish);
  sheet.addEventListener("touchcancel", finish);
  // mouse (desktop): drag the handle
  $("grip").addEventListener("mousedown", (e) => {
    begin(e.clientY, e.target);
    const mm = (ev) => move(ev.clientY, ev);
    const mu = () => { finish(); removeEventListener("mousemove", mm); removeEventListener("mouseup", mu); };
    addEventListener("mousemove", mm);
    addEventListener("mouseup", mu);
  });
}

/* ---------- station view & route preview ---------- */
function showView(name) {
  for (const v of ["home", "station", "nav"]) $("view-" + v).hidden = v !== name;
  $("sheet").classList.toggle("nav", name === "nav");
  $("sheet").classList.toggle("tall", name === "station");
  $("sheet").classList.remove("expanded", "collapsed");
}

function selectStation(id) {
  const s = byId(id);
  if (!s || S.nav) return;
  closeMenu();
  S.selected = s;
  setSelectedLayer();
  $("st-name").textContent = stationTitle(s);
  const alt = [s.nameEn, s.nameAr].filter((x) => x && x !== s.name);
  $("st-name2").textContent = alt.join(" · ");
  const meta = [];
  if (s.user) meta.push("Added by you" + (s.note ? ": " + s.note : ""));
  if (s.brand) meta.push("Brand: " + s.brand);
  if (s.hours) meta.push("Hours: " + s.hours);
  if (s.fuels) meta.push("Fuel: " + s.fuels.join(", "));
  if (s.street) meta.push("Street: " + s.street);
  $("st-meta").textContent = meta.join("\n");
  renderKind(s);
  $("st-user-actions").hidden = !s.user;
  showView("station");
  computePreview(true);
}

// Name each route by a town or village that only that route passes ("via Sharafiyah").
function labelRoutes(routes) {
  // prefer towns, then villages, that sit on the part of the road only this route uses
  const RANK = { town: 0, village: 1, suburb: 2 };
  const REACH = { town: 2000, village: 800, suburb: 600 };
  const places = S.places.filter((p) => p[5] in RANK);
  const clean = (s) => String(s || "").replace(/^(village|qaryat|qaryah)\s+/i, "");
  const near = (pts, lat, lon) => {
    let d = Infinity;
    for (const c of pts) { const x = Math.hypot((c[0] - lon) * Geo.KX, (c[1] - lat) * Geo.KY); if (x < d) d = x; }
    return d;
  };
  const sampled = routes.map((r) => r.coords.filter((_, k) => k % 3 === 0));
  const a = routes[0].coords[0], z = routes[0].coords[routes[0].coords.length - 1];
  // a town that only this route passes; ignore the start and end areas, which every route shares
  const cands = places.filter((p) => near([a, z], p[3], p[4]) > 3000);
  // first choice: the longest named road that only this route uses ("via Duhok-Mosul Road")
  const segKeys = routes.map((r) => {
    const s = new Set();
    for (let j = 0; j + 1 < r.nodeAt.length; j++) if (r.nodeAt[j] >= 0 && r.nodeAt[j + 1] >= 0) s.add(r.nodeAt[j] + ":" + r.nodeAt[j + 1]);
    return s;
  });
  // the main route is named by its longest road; the others by a road only they use
  const roadVia = [];
  routes.forEach((r, i) => {
    const meters = new Map();
    for (let j = 0; j + 1 < r.nodeAt.length; j++) {
      const key = r.nodeAt[j] + ":" + r.nodeAt[j + 1];
      if (r.nodeAt[j] < 0 || (i > 0 && segKeys.some((s, k) => k !== i && s.has(key)))) continue;
      const w = r.segWay[j];
      if (w < 0) continue;
      const wy = S.graph.ways[w];
      const label = wy.nameEn || wy.name || (wy.ref ? "Road " + wy.ref : "");
      if (label) meters.set(label, (meters.get(label) || 0) + r.cum[j + 1] - r.cum[j]);
    }
    let best = "", m = 1500;
    for (const [label, v] of meters) if (v > m && (i === 0 || label !== roadVia[0])) { m = v; best = label; }
    roadVia.push(best);
  });
  routes.forEach((r, i) => {
    if (roadVia[i] && !roadVia.some((x, j) => j !== i && x === roadVia[i])) { r.via = roadVia[i]; return; }
    let best = null;
    for (const p of cands) {
      const reach = REACH[p[5]];
      const d = near(sampled[i], p[3], p[4]);
      if (d > reach) continue;
      if (routes.some((_, j) => j !== i && near(sampled[j], p[3], p[4]) < reach * 1.5)) continue;
      const score = RANK[p[5]] * 10000 + d;
      if (!best || score < best.score) best = { score, p };
    }
    r.via = best ? clean(best.p[1] || best.p[0]) : "";
  });
  const shortest = routes.reduce((a, r, i) => (r.total < routes[a].total ? i : a), 0);
  routes.forEach((r, i) => { r.tag = i === 0 ? "Fastest" : i === shortest ? "Shortest" : ""; });
}

function chooseRoute(i) {
  if (!S.routes?.[i] || S.nav) return;
  S.routeIdx = i;
  S.preview = S.routes[i];
  renderRouteChoice();
}

function renderRouteChoice() {
  const r = S.preview;
  drawRoute(r);
  const many = (S.routes || []).length > 1;
  $("st-alts").hidden = !many;
  if (many) {
    $("st-alts").innerHTML = S.routes.map((x, i) => `<button type="button" class="alt${i === S.routeIdx ? " sel" : ""}" data-i="${i}">
      <b>${Fmt.time(x.time)}</b><span>${Fmt.dist(x.total)}</span>${x.via ? `<span dir="auto">via ${esc(x.via)}</span>` : ""}${x.tag ? `<em>${x.tag}</em>` : ""}</button>`).join("");
  }
  if (!r) return;
  $("st-route").innerHTML = `<b>${Fmt.time(r.time)}</b> · ${Fmt.dist(r.total)} by road${r.via ? `<div class="via" dir="auto">via ${esc(r.via)}</div>` : ""}`;
  $("st-steps").innerHTML = r.steps.map((st, i) => {
    const len = i < r.steps.length - 1 ? r.steps[i + 1].at - st.at : 0;
    return `<li dir="auto">${esc(st.text)}${len ? `<span>${Fmt.dist(len)}</span>` : ""}</li>`;
  }).join("");
}

function computePreview(fit) {
  const s = S.selected;
  if (!s) return;
  const keepVia = !fit ? S.routes?.[S.routeIdx]?.via : null;
  S.preview = null;
  S.routes = [];
  S.routeIdx = 0;
  let msg = "";
  if (!S.graph) msg = "Loading roads…";
  else if (!S.me) msg = "Turn on location (or long-press the map → “Set my location here”) to get a route.";
  else {
    const sn = S.graph.snap(S.me.lat, S.me.lon, 400);
    if (!sn) msg = `${Fmt.dist(Geo.dist(S.me.lat, S.me.lon, s.lat, s.lon))} away in a straight line. You're outside the road map (Mosul – Tel Kaif – Bozan), so no route.`;
    else if (s.node < 0) msg = "This station is too far from any mapped road to route to.";
    else {
      S.routes = S.graph.alternatives(sn, s.node, 3).map((p) => buildRoute(S.graph, sn, p, s));
      if (S.routes.length) {
        labelRoutes(S.routes);
        const keep = keepVia ? S.routes.findIndex((r) => r.via === keepVia) : -1;
        S.routeIdx = keep >= 0 ? keep : 0;
        S.preview = S.routes[S.routeIdx];
      } else msg = "No road route found.";
    }
    S.previewAt = { lat: S.me.lat, lon: S.me.lon };
  }
  $("btn-go").disabled = $("btn-sim").disabled = !S.preview;
  $("btn-go").style.opacity = $("btn-sim").style.opacity = S.preview ? 1 : 0.45;
  $("st-steps-wrap").hidden = !S.preview;
  renderRouteChoice();
  if (!S.preview) $("st-route").textContent = msg;
  if (fit) {
    const pad = { top: 90, bottom: $("sheet").offsetHeight + 30, left: 40, right: 40 };
    if (S.preview) {
      const b = new maplibregl.LngLatBounds();
      S.routes.forEach((r) => r.coords.forEach((c) => b.extend(c)));
      S.map.fitBounds(b, { padding: pad, maxZoom: 16.5, duration: 700 });
    } else {
      S.map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(S.map.getZoom(), 15), padding: pad, duration: 700 });
    }
  }
}

function closeStation() {
  S.selected = null; S.preview = null; S.routes = [];
  setSelectedLayer(); drawRoute(null);
  showView("home");
}

/* ---------- navigation ---------- */
function makeNavigator(route) {
  return new Navigator(route, {
    onUpdate: renderNav,
    onOffRoute: reroute,
    onArrive: arrived,
    speak: (t) => Voice.say(t),
  });
}

function startNav(simulate) {
  if (!S.preview) return;
  S.navRoute = S.preview;
  S.nav = makeNavigator(S.navRoute);
  S.follow = true;
  drawAlts(); // hide the other choices while driving
  showView("nav");
  $("nav-top").hidden = false;
  $("topbar").hidden = true;
  $("hint").hidden = true;
  $("btn-recenter").hidden = true;
  S.marker.getElement().classList.add("nav");
  setVoiceButton();
  // first speech must come from a tap on iPhone
  Voice.say(`Starting route. ${S.navRoute.steps[0].say}.`, true);
  wake(true);
  renderNav({ step: S.navRoute.steps[1] || S.navRoute.steps[0], next: S.navRoute.steps[2], toNext: S.navRoute.steps[1]?.at || 0, remaining: S.navRoute.total, eta: S.navRoute.time });
  if (simulate) startSim();
  else if (S.me) { S.nav.update(S.me); followCam(S.me); }
}

function renderNav(u) {
  if (!u) return;
  $("nav-icon").innerHTML = arrowSvg(u.step.modifier, u.step.exit);
  $("nav-dist").textContent = Fmt.dist(u.toNext);
  $("nav-instr").textContent = u.step.text;
  const then = u.next && u.next.at - u.step.at < 300 && u.step.type !== "arrive";
  $("nav-then").hidden = !then;
  if (then) $("nav-then").innerHTML = `Then ${arrowSvg(u.next.modifier, u.next.exit)} <span dir="auto">${esc(u.next.text)}</span>`;
  $("nav-eta-min").textContent = Fmt.time(u.eta);
  $("nav-remaining").textContent = Fmt.dist(u.remaining);
  $("nav-arrive").textContent = Fmt.clock(new Date(Date.now() + u.eta * 1000));
  S.navSnap = u.snapped;
}

function reroute(fix) {
  if (Date.now() - S.lastReroute < 4000) return;
  S.lastReroute = Date.now();
  const st = S.navRoute.station;
  const sn = S.graph.snap(fix.lat, fix.lon, 400);
  if (!sn) { toast("You're off the map's roads. Head back to a main road."); return; }
  const heading = fix.heading != null && fix.speed > 2 ? fix.heading : null;
  const p = S.graph.path(sn, st.node, heading);
  if (!p) return;
  S.navRoute = buildRoute(S.graph, sn, p, st);
  S.nav = makeNavigator(S.navRoute);
  drawRoute(S.navRoute);
  S.reroutes = (S.reroutes || 0) + 1;
  if (Date.now() - (S.lastRerouteSpoken || 0) > 30000) { S.lastRerouteSpoken = Date.now(); Voice.say("Rerouting.", true); }
  toast(`New route: ${Fmt.time(S.navRoute.time)} · ${Fmt.dist(S.navRoute.total)}`);
  S.nav.update(fix);
}

function arrived() {
  $("nav-icon").innerHTML = arrowSvg("arrive");
  $("nav-dist").textContent = "Arrived";
  $("nav-instr").textContent = stationTitle(S.navRoute.station);
  $("nav-then").hidden = true;
  $("nav-eta-min").textContent = "0 min";
  $("nav-remaining").textContent = "0 m";
  stopSim();
}

function endNav() {
  stopSim();
  S.nav = null; S.navRoute = null;
  wake(false);
  speechSynthesis?.cancel?.();
  $("nav-top").hidden = true;
  $("topbar").hidden = false;
  $("btn-recenter").hidden = true;
  S.marker.getElement().classList.remove("nav");
  S.map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  if (S.selected) { showView("station"); computePreview(true); } else showView("home");
  if (S.gps && !S.me?.manual) setMe(S.gps);
}

function followCam(fix) {
  if (!S.follow || !S.map) return;
  const kmh = (fix.speed || 0) * 3.6;
  const zoom = kmh > 70 ? 15.6 : kmh > 40 ? 16.2 : 16.8;
  let bearing = S.map.getBearing();
  if (fix.heading != null && fix.speed > 2) bearing = fix.heading;
  else if (S.navSnap && S.navRoute) {
    const c = S.navRoute.coords, i = Math.min(S.navSnap.i, c.length - 2);
    bearing = Geo.bearing(c[i][1], c[i][0], c[i + 1][1], c[i + 1][0]);
  }
  S.map.easeTo({
    center: [fix.lon, fix.lat], bearing, pitch: 50, zoom, duration: 950, easing: (t) => t,
    padding: { top: Math.round(innerHeight * 0.42), bottom: $("sheet").offsetHeight + 10, left: 0, right: 0 },
  });
}

// "Preview drive": fake GPS fixes moving along the route, so you can see how it works at home.
function startSim() {
  stopSim();
  let along = 0;
  const speed = 14; // m/s shown; moves 2x faster than real time
  S.sim = setInterval(() => {
    const r = S.navRoute;
    if (!r) return stopSim();
    along = Math.min(r.total, along + speed);
    let i = 1;
    while (i < r.cum.length - 1 && r.cum[i] < along) i++;
    const a = r.coords[i - 1], b = r.coords[i];
    const f = r.cum[i] > r.cum[i - 1] ? (along - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1]) : 1;
    const fix = { lat: a[1] + f * (b[1] - a[1]), lon: a[0] + f * (b[0] - a[0]), accuracy: 5, speed, heading: Geo.bearing(a[1], a[0], b[1], b[0]), sim: true };
    setMe(fix);
  }, 500);
}
function stopSim() { if (S.sim) { clearInterval(S.sim); S.sim = null; } }

async function wake(on) {
  try {
    if (on && "wakeLock" in navigator) S.wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && S.wakeLock) { await S.wakeLock.release(); S.wakeLock = null; }
  } catch {}
}

function setVoiceButton() {
  $("btn-voice").innerHTML = Voice.enabled
    ? '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9zm16.6 3 2.1-2.1-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4z"/></svg>';
}

/* ---------- location ---------- */
function startGPS() {
  if (!("geolocation" in navigator)) { toast("This phone doesn't share location with the app."); return; }
  navigator.geolocation.watchPosition(onGps, (err) => {
    if (err.code === 1) {
      showHint("Location is off for this app. On iPhone: Settings → Privacy &amp; Security → Location Services → Safari Websites → While Using. You can also long-press the map to set your location.");
    }
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function onGps(pos) {
  const c = pos.coords;
  const fix = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading != null && !isNaN(c.heading) ? c.heading : null };
  const first = !S.gps;
  S.gps = fix;
  if (S.sim || (S.me?.manual && !S.nav)) return;
  setMe(fix);
  if (first && !S.selected && !S.nav) S.map?.easeTo({ center: [fix.lon, fix.lat], zoom: Math.max(S.map.getZoom(), 13.5), duration: 800 });
}
function setMe(fix) {
  S.me = fix;
  if (S.marker && S.map) {
    S.marker.setLngLat([fix.lon, fix.lat]);
    if (!S.marker._map) S.marker.addTo(S.map);
    const el = S.marker.getElement();
    el.classList.toggle("manual", !!fix.manual);
    el.classList.toggle("heading", fix.heading != null && fix.speed > 1);
    S.marker.setRotation(fix.heading != null && (fix.speed > 1 || S.nav) ? fix.heading : 0);
  }
  if (S.nav) {
    S.nav.update(fix);
    if (fix.heading == null && S.navSnap && S.navRoute) {
      const c = S.navRoute.coords, i = Math.min(S.navSnap.i, c.length - 2);
      S.marker.setRotation(Geo.bearing(c[i][1], c[i][0], c[i + 1][1], c[i + 1][0]));
    }
    followCam(fix);
    return;
  }
  maybeRank();
}

/* ---------- user stations ---------- */
function openStationDialog(existing) {
  S.editing = existing || null;
  $("dlg-title").textContent = existing ? "Edit gas station" : "Add gas station";
  $("f-name").value = existing?.name || "";
  $("f-note").value = existing?.note || "";
  $("f-gov").checked = existing ? kindOf(existing) === "gov" : true;
  $("dlg-station").showModal();
}
$("dlg-station").addEventListener("close", () => {
  if ($("dlg-station").returnValue !== "save") return;
  const name = $("f-name").value.trim(), note = $("f-note").value.trim();
  const kind = $("f-gov").checked ? "gov" : "";
  if (S.editing) {
    Object.assign(S.editing, { name, note });
    S.userKinds[S.editing.id] = kind; saveUserKinds();
    saveUserStations(); refreshStationsLayer(); renderList(); selectStation(S.editing.id);
  } else if (S.menuAt) {
    const s = { id: "u-" + Date.now().toString(36), lat: +S.menuAt.lat.toFixed(7), lon: +S.menuAt.lng.toFixed(7), name, note, user: true };
    snapStation(s);
    S.stations.push(s);
    S.userKinds[s.id] = kind; saveUserKinds();
    saveUserStations(); refreshStationsLayer();
    if (S.me) rank(); else renderList();
    toast("Gas station saved on this phone");
    selectStation(s.id);
  }
});

/* ---------- settings ---------- */
async function openSettings() {
  $("set-voice").checked = Voice.enabled;
  for (const b of $("set-lang").querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === S.lang);
  $("set-user-count").textContent = `(${S.stations.filter((s) => s.user).length})`;
  const inst = await Offline.installed().catch(() => null);
  $("set-offline").innerHTML = inst
    ? `<b>Saved for offline</b> <span class="muted">· ${(inst.total / 1e6).toFixed(1)} MB · version ${esc(inst.version.slice(0, 6))}</span>`
    : `<b>Not saved for offline yet.</b> <span class="muted">Open the app with internet and wait for “Offline ready”.</span>`;
  try { $("set-date").textContent = (await (await fetch("data/info.json")).json()).date; } catch {}
  $("dlg-settings").showModal();
}

async function runSync(manual) {
  if (!S.swOk) { setStatus("bad", "Offline not supported here"); return; }
  try {
    setStatus("busy", "Checking…");
    const r = await Offline.sync((done, total) => {
      if (total > 0) setStatus("busy", `Saving offline ${Math.floor((done / total) * 100)}%`);
    });
    setStatus("ok", "Offline ready");
    if (r.wasInstalled && r.codeChanged) showHint("A new version was downloaded.", () => location.reload());
    else if (manual) toast(r.changed ? "Updated" : "Already up to date");
  } catch (e) {
    console.warn("sync", e);
    const inst = await Offline.installed().catch(() => null);
    if (inst) { setStatus("ok", "Offline ready"); if (manual) toast("No internet – using the saved copy"); }
    else setStatus("bad", "Not saved – needs internet once");
  }
}

/* ---------- wiring ---------- */
function wire() {
  $("list").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id], li[data-place]");
    if (!li) return;
    if (li.dataset.place != null) return goToPlace(+li.dataset.place);
    endSearchMode();
    selectStation(li.dataset.id);
  });
  const search = $("search");
  search.addEventListener("focus", () => { $("sheet").classList.remove("collapsed"); $("sheet").classList.add("searching"); });
  search.addEventListener("input", () => {
    S.near = null;
    $("search-clear").hidden = !search.value;
    $("sheet").classList.add("searching");
    $("list").scrollTop = 0;
    renderList();
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search.blur(); } });
  search.addEventListener("blur", () => { if (!search.value) $("sheet").classList.remove("searching"); });
  $("search-clear").onclick = () => {
    search.value = "";
    S.near = null;
    $("search-clear").hidden = true;
    S.placeMarker?.remove(); S.placeMarker = null;
    endSearchMode();
    renderList();
  };
  setupSheetDrag();
  // tap the handle: small ↔ half; tap the list header: half ↔ full
  $("grip").addEventListener("click", () => { if (!S.sheetDragged) setSheet(sheetState() === "min" ? "mid" : "min"); });
  document.querySelector(".list-head").addEventListener("click", () => setSheet(sheetState() === "max" ? "mid" : "max"));
  $("btn-close-station").onclick = closeStation;
  $("st-alts").addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) chooseRoute(+b.dataset.i); });
  $("btn-go").onclick = () => startNav(false);
  $("btn-sim").onclick = () => startNav(true);
  $("btn-end").onclick = endNav;
  $("btn-voice").onclick = () => {
    Voice.enabled = !Voice.enabled;
    try { localStorage.setItem(LS_VOICE, Voice.enabled ? "on" : "off"); } catch {}
    if (!Voice.enabled) speechSynthesis?.cancel?.();
    setVoiceButton();
  };
  $("btn-recenter").onclick = () => { S.follow = true; $("btn-recenter").hidden = true; if (S.me) followCam(S.me); };
  $("btn-nearest").onclick = () => {
    if (!S.me) return toast("Waiting for your location… or long-press the map to set it.");
    let best = null;
    if (S.costs) for (const s of shown()) { const c = S.costs.get(s.id); if (c && (!best || c.time < best.c)) best = { s, c: c.time }; }
    if (!best) for (const s of shown()) { const d = Geo.dist(S.me.lat, S.me.lon, s.lat, s.lon); if (!best || d < best.c) best = { s, c: d }; }
    if (best) selectStation(best.s.id);
    else toast("No government stations marked yet. Switch to “All stations”.");
  };
  $("btn-locate").onclick = () => {
    if (S.me?.manual) { S.me = null; if (S.gps) setMe(S.gps); toast("Back to GPS location"); }
    if (S.nav) { S.follow = true; $("btn-recenter").hidden = true; if (S.me) followCam(S.me); return; }
    if (S.gps) S.map.easeTo({ center: [S.gps.lon, S.gps.lat], zoom: Math.max(S.map.getZoom(), 15), duration: 600 });
    else toast("Waiting for GPS… go outside for a faster fix.");
  };
  $("menu").addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    closeMenu();
    if (act === "add") openStationDialog(null);
    if (act === "here" && S.menuAt) {
      setMe({ lat: S.menuAt.lat, lon: S.menuAt.lng, accuracy: 0, speed: 0, heading: null, manual: true });
      toast("Location set. Tap ◎ to go back to GPS.");
    }
  });
  S.map.on("click", closeMenu);
  S.map.on("movestart", (e) => { if (e.originalEvent) closeMenu(); });
  $("btn-edit-station").onclick = () => S.selected?.user && openStationDialog(S.selected);
  $("btn-delete-station").onclick = () => {
    const s = S.selected;
    if (!s?.user || !confirm(`Delete “${stationTitle(s)}”?`)) return;
    S.stations = S.stations.filter((x) => x !== s);
    saveUserStations(); refreshStationsLayer(); closeStation(); if (S.me) rank(); else renderList();
  };
  $("status").onclick = openSettings;
  $("btn-settings").onclick = openSettings;
  $("set-voice").onchange = (e) => {
    Voice.enabled = e.target.checked;
    try { localStorage.setItem(LS_VOICE, Voice.enabled ? "on" : "off"); } catch {}
    if (Voice.enabled) Voice.say("Voice directions on", true);
  };
  $("btn-update").onclick = () => runSync(true);
  $("set-lang").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b && b.dataset.v !== S.lang) setLang(b.dataset.v); });
  $("kind-filter").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) setGovOnly(b.dataset.v === "gov"); });
  $("st-kind").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b && S.selected) setKind(S.selected, b.dataset.v); });
  $("btn-export").onclick = async () => {
    const data = JSON.stringify({
      stations: S.stations.filter((s) => s.user).map(({ id, lat, lon, name, note }) => ({ id, lat, lon, name, note })),
      kinds: S.userKinds,
    });
    try { await navigator.clipboard.writeText(data); toast("Copied. Paste it in Notes to keep it safe."); }
    catch { prompt("Copy this backup:", data); }
  };
  $("btn-import").onclick = () => {
    const txt = prompt("Paste your backup here:");
    if (!txt) return;
    try {
      const data = JSON.parse(txt);
      const list = Array.isArray(data) ? data : data.stations || []; // older backups were just the station list
      if (!Array.isArray(data) && data.kinds && typeof data.kinds === "object") {
        for (const [id, k] of Object.entries(data.kinds)) if (["gov", "com", ""].includes(k)) S.userKinds[id] = k;
        saveUserKinds();
      }
      let n = 0;
      for (const u of list) {
        if (typeof u.lat !== "number" || typeof u.lon !== "number" || byId(u.id)) continue;
        const s = { id: String(u.id || "u-" + Math.random().toString(36).slice(2)), lat: u.lat, lon: u.lon, name: String(u.name || ""), note: String(u.note || ""), user: true };
        snapStation(s); S.stations.push(s); n++;
      }
      saveUserStations(); refreshStationsLayer(); if (S.me) rank(); else renderList();
      toast(`Restored ${n} station${n === 1 ? "" : "s"}`);
    } catch { toast("That backup text isn't valid"); }
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.nav) wake(true); });
  new ResizeObserver(() => document.documentElement.style.setProperty("--sheet-h", $("sheet").offsetHeight + "px")).observe($("sheet"));
}

/* ---------- start ---------- */
async function boot() {
  Voice.init();
  try { Voice.enabled = localStorage.getItem(LS_VOICE) !== "off"; } catch {}
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (isIOS && !standalone) {
    showHint("<b>To use without internet:</b> tap Share → <b>Add to Home Screen</b>, then open Mosul Fuel from your Home Screen (it saves its own copy there).");
  }
  S.swOk = await Offline.register();
  try {
    await initMap();
  } catch (e) {
    console.error(e);
    setStatus("bad", "Map not saved yet");
    showHint("Couldn't load the map. Open the app once with internet so it can save everything on your phone.");
    return;
  }
  wire();
  startGPS();
  loadData().catch((e) => { console.error(e); toast("Couldn't load stations/roads: " + e.message, 6000); });
  runSync(false);
}
boot();
