// Mosul Fuel – offline gas station map with turn-by-turn routes.
"use strict";

const $ = (id) => document.getElementById(id);
const HOME = { center: [43.14, 36.46], zoom: 10.4 };
const LS_USER = "mfuel.userStations.v1";
const LS_VOICE = "mfuel.voice";

const S = {
  map: null, graph: null, swOk: false,
  stations: [], places: [], fonts: {}, placeMarker: null,
  me: null, gps: null, costs: null, rankedAt: null,
  selected: null, preview: null, previewAt: null,
  nav: null, navRoute: null, follow: true, sim: null, lastReroute: 0, lastFix: null,
  wakeLock: null, marker: null, menuAt: null, editing: null,
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

async function loadStyle() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const flavor = dark ? "dark" : "light";
  const style = await (await fetch(`data/style-${flavor}.json`)).json();
  style.sprite = new URL(`sprites/${flavor}`, location.href).href;
  return style;
}

async function initMap() {
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
  S.map.on("mouseenter", "stations-icon", () => (S.map.getCanvas().style.cursor = "pointer"));
  S.map.on("mouseleave", "stations-icon", () => (S.map.getCanvas().style.cursor = ""));
  const stopFollow = (e) => { if (e.originalEvent && S.nav) { S.follow = false; $("btn-recenter").hidden = false; } };
  S.map.on("dragstart", stopFollow);
  S.map.on("zoomstart", stopFollow);
  S.map.on("rotatestart", stopFollow);
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", async () => S.map.setStyle(await loadStyle()));
  setupLongPress();

  const el = document.createElement("div");
  el.className = "me";
  el.innerHTML = '<div class="cone"></div><div class="core"></div><svg class="arrow" viewBox="0 0 40 40"><path d="M20 3 33 35 20 28 7 35z" fill="#1c7ed6" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>';
  S.marker = new maplibregl.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" });
}

function addAppLayers() {
  const map = S.map;
  for (const [id, color] of [["fuel-osm", "#f08c00"], ["fuel-user", "#7048e8"], ["fuel-sel", "#e03131"]]) {
    if (!map.hasImage(id)) map.addImage(id, fuelIcon(color), { pixelRatio: 2 });
  }
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
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

  map.addSource("stations", { type: "geojson", data: stationsGeoJSON() });
  map.addLayer({ id: "stations-icon", type: "symbol", source: "stations",
    layout: {
      "icon-image": ["case", ["get", "user"], "fuel-user", "fuel-osm"],
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
  return { type: "FeatureCollection", features: S.stations.map((s) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: { id: s.id, label: stationTitle(s), user: !!s.user },
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
function drawRoute(r) { S.map?.getSource("route")?.setData(routeGeoJSON(r)); }

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
  const [stations, ways, buf, places] = await Promise.all([
    fetch("data/stations.json").then((r) => r.json()),
    fetch("data/graph-ways.json").then((r) => r.json()),
    fetch("data/graph.bin").then((r) => r.arrayBuffer()),
    fetch("data/places.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  S.places = places;
  S.stations = stations.concat(loadUserStations().map((s) => ({ ...s, user: true })));
  refreshStationsLayer();
  renderList();
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
  S.stations.map((s) => [Geo.dist(lat, lon, s.lat, s.lon), s]).sort((x, y) => x[0] - y[0]).slice(0, 3).forEach(([, s]) => b.extend([s.lon, s.lat]));
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
  let stations = S.stations;
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
    $("list-title").textContent = `Gas stations (${S.stations.length})`;
    $("list-sub").textContent = S.costs ? "by road from you" : S.me ? (S.graph ? "straight line · you're away from the roads" : "straight line") : "waiting for location…";
  }
  const empty = match && !rows.length && !placeRows ? `<li class="empty">Nothing found. Try the Arabic or English spelling.</li>` : "";
  $("list").innerHTML = placeRows + empty + rows.map(({ s, c, d, dn }) => {
    const second = s.nameEn && s.nameEn !== s.name ? s.nameEn : s.user ? (s.note || "Added by you") : (s.street || s.brand || s.nameAr || "");
    const dist = dn != null ? `<b>${Fmt.dist(dn)}</b><span>from there</span>`
      : c ? `<b>${Fmt.time(c.time)}</b><span>${Fmt.dist(c.meters)}</span>`
      : d != null ? `<b>${Fmt.dist(d)}</b><span>straight</span>` : "";
    return `<li data-id="${esc(s.id)}"><div class="ico ${s.user ? "user" : ""}">${PUMP_SVG}</div>
      <div class="names"><div class="n1" dir="auto">${esc(stationTitle(s))}</div><div class="n2" dir="auto">${esc(second)}</div></div>
      <div class="d">${dist}</div></li>`;
  }).join("");
}

/* ---------- station view & route preview ---------- */
function showView(name) {
  for (const v of ["home", "station", "nav"]) $("view-" + v).hidden = v !== name;
  $("sheet").classList.toggle("nav", name === "nav");
  $("sheet").classList.remove("expanded");
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
  $("st-user-actions").hidden = !s.user;
  showView("station");
  computePreview(true);
}

function computePreview(fit) {
  const s = S.selected;
  if (!s) return;
  S.preview = null;
  let msg = "";
  if (!S.graph) msg = "Loading roads…";
  else if (!S.me) msg = "Turn on location (or long-press the map → “Set my location here”) to get a route.";
  else {
    const sn = S.graph.snap(S.me.lat, S.me.lon, 400);
    if (!sn) msg = `${Fmt.dist(Geo.dist(S.me.lat, S.me.lon, s.lat, s.lon))} away in a straight line. You're outside the road map (Mosul – Tel Kaif – Bozan), so no route.`;
    else if (s.node < 0) msg = "This station is too far from any mapped road to route to.";
    else {
      const p = S.graph.path(sn, s.node);
      if (p) S.preview = buildRoute(S.graph, sn, p, s);
      else msg = "No road route found.";
    }
    S.previewAt = { lat: S.me.lat, lon: S.me.lon };
  }
  drawRoute(S.preview);
  $("btn-go").disabled = $("btn-sim").disabled = !S.preview;
  $("btn-go").style.opacity = $("btn-sim").style.opacity = S.preview ? 1 : 0.45;
  $("st-steps-wrap").hidden = !S.preview;
  if (S.preview) {
    const r = S.preview;
    $("st-route").innerHTML = `<b>${Fmt.time(r.time)}</b> · ${Fmt.dist(r.total)} by road`;
    $("st-steps").innerHTML = r.steps.map((st, i) => {
      const len = i < r.steps.length - 1 ? r.steps[i + 1].at - st.at : 0;
      return `<li dir="auto">${esc(st.text)}${len ? `<span>${Fmt.dist(len)}</span>` : ""}</li>`;
    }).join("");
  } else {
    $("st-route").textContent = msg;
  }
  if (fit) {
    const pad = { top: 90, bottom: $("sheet").offsetHeight + 30, left: 40, right: 40 };
    if (S.preview) {
      const b = new maplibregl.LngLatBounds();
      S.preview.coords.forEach((c) => b.extend(c));
      S.map.fitBounds(b, { padding: pad, maxZoom: 16.5, duration: 700 });
    } else {
      S.map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(S.map.getZoom(), 15), padding: pad, duration: 700 });
    }
  }
}

function closeStation() {
  S.selected = null; S.preview = null;
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
  Voice.say("Rerouting.", true);
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
  $("dlg-station").showModal();
}
$("dlg-station").addEventListener("close", () => {
  if ($("dlg-station").returnValue !== "save") return;
  const name = $("f-name").value.trim(), note = $("f-note").value.trim();
  if (S.editing) {
    Object.assign(S.editing, { name, note });
    saveUserStations(); refreshStationsLayer(); renderList(); selectStation(S.editing.id);
  } else if (S.menuAt) {
    const s = { id: "u-" + Date.now().toString(36), lat: +S.menuAt.lat.toFixed(7), lon: +S.menuAt.lng.toFixed(7), name, note, user: true };
    snapStation(s);
    S.stations.push(s);
    saveUserStations(); refreshStationsLayer();
    if (S.me) rank(); else renderList();
    toast("Gas station saved on this phone");
    selectStation(s.id);
  }
});

/* ---------- settings ---------- */
async function openSettings() {
  $("set-voice").checked = Voice.enabled;
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
  search.addEventListener("focus", () => $("sheet").classList.add("searching"));
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
  $("grip").addEventListener("click", () => $("sheet").classList.toggle("expanded"));
  document.querySelector(".list-head").addEventListener("click", () => $("sheet").classList.toggle("expanded"));
  $("btn-close-station").onclick = closeStation;
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
    if (S.costs) for (const s of S.stations) { const c = S.costs.get(s.id); if (c && (!best || c.time < best.c)) best = { s, c: c.time }; }
    if (!best) for (const s of S.stations) { const d = Geo.dist(S.me.lat, S.me.lon, s.lat, s.lon); if (!best || d < best.c) best = { s, c: d }; }
    if (best) selectStation(best.s.id);
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
  $("btn-export").onclick = async () => {
    const data = JSON.stringify(S.stations.filter((s) => s.user).map(({ id, lat, lon, name, note }) => ({ id, lat, lon, name, note })));
    try { await navigator.clipboard.writeText(data); toast("Copied. Paste it in Notes to keep it safe."); }
    catch { prompt("Copy this backup:", data); }
  };
  $("btn-import").onclick = () => {
    const txt = prompt("Paste your backup here:");
    if (!txt) return;
    try {
      const list = JSON.parse(txt);
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
