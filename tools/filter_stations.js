// Keeps only the gas stations the trip needs: Mosul city, plus stations along the road
// from Bozan through Tel Kaif to Mosul. Runs after build_data.py and rewrites docs/data/stations.json.
// Run: node tools/filter_stations.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const DOCS = path.resolve(__dirname, "..", "docs");
const MOSUL_BOX = { south: 36.26, north: 36.44, west: 43.02, east: 43.24 }; // Mosul city and its edge
const ROUTE_FROM = [36.73452, 43.12915]; // Bozan
const ROUTE_TO = [36.345, 43.13];        // central Mosul
const CORRIDOR_M = 1500;                 // how far from that road a station may be
const NOT_FOR_CARS = /معمل|غاز المنزلي/;  // LPG bottling plants / household gas shops
const ALSO_KEEP = new Set([
  "osm-n8956425717", // Alqosh (محطة تعبئة القوش): nearest station to Bozan, 2 km off the road
]);

const ctx = { console, Math, Date, performance, window: {}, setTimeout };
vm.createContext(ctx);
for (const f of ["js/router.js", "js/nav.js"]) {
  vm.runInContext(fs.readFileSync(path.join(DOCS, f), "utf8") + "\nthis.Geo = Geo; this.RoadGraph = RoadGraph;", ctx);
}
const buf = fs.readFileSync(path.join(DOCS, "data/graph.bin"));
const G = new ctx.RoadGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
  JSON.parse(fs.readFileSync(path.join(DOCS, "data/graph-ways.json"), "utf8")));

const start = G.snap(ROUTE_FROM[0], ROUTE_FROM[1], 1000);
const goal = G.destNode(G.snap(ROUTE_TO[0], ROUTE_TO[1], 1000));
const route = G.path(start, goal);
if (!route) throw new Error("No route from Bozan to Mosul");
const pts = route.nodes.map((v) => [G.lat[v], G.lon[v]]);
const nearRoad = (s) => pts.some(([la, lo]) => ctx.Geo.dist(s.lat, s.lon, la, lo) <= CORRIDOR_M);
const inMosul = (s) => s.lat >= MOSUL_BOX.south && s.lat <= MOSUL_BOX.north && s.lon >= MOSUL_BOX.west && s.lon <= MOSUL_BOX.east;

const file = path.join(DOCS, "data/stations.json");
const all = JSON.parse(fs.readFileSync(file, "utf8"));
const keep = all.filter((s) => ALSO_KEEP.has(s.id) || ((inMosul(s) || nearRoad(s)) && !NOT_FOR_CARS.test(s.name || "")));
fs.writeFileSync(file, JSON.stringify(keep));
console.log(`stations: kept ${keep.length} of ${all.length} (Mosul + Bozan–Tel Kaif–Mosul road); route ${(route.meters / 1000).toFixed(1)} km`);
