// Offline road router: loads graph.bin, snaps points to roads, and runs Dijkstra / A* on the phone.
"use strict";

const Geo = (() => {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  function dist(lat1, lon1, lat2, lon2) {
    const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  // signed turn angle from bearing a to bearing b, in (-180, 180], positive = right
  function turn(a, b) {
    let d = (b - a + 540) % 360 - 180;
    return d === -180 ? 180 : d;
  }
  // metres per degree near Mosul, for fast local projection
  const KY = 110950, KX = 111320 * Math.cos(rad(36.38));
  return { dist, bearing, turn, KX, KY };
})();

class MinHeap {
  constructor() { this.keys = []; this.vals = []; }
  get size() { return this.keys.length; }
  push(k, v) {
    const K = this.keys, V = this.vals;
    let i = K.length;
    K.push(k); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.keys, V = this.vals;
    const top = V[0], topK = K[0];
    const k = K.pop(), v = V.pop();
    const n = K.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= k) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = k; V[i] = v;
    }
    this.lastKey = topK;
    return top;
  }
}

class RoadGraph {
  constructor(buffer, ways) {
    const dv = new DataView(buffer);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== "MFG1") throw new Error("Bad graph file");
    const n = dv.getUint32(4, true), m = dv.getUint32(8, true);
    let o = 12;
    const lat = new Int32Array(buffer, o, n); o += 4 * n;
    const lon = new Int32Array(buffer, o, n); o += 4 * n;
    this.first = new Uint32Array(buffer, o, n + 1); o += 4 * (n + 1);
    this.target = new Uint32Array(buffer, o, m); o += 4 * m;
    this.len = new Float32Array(buffer, o, m); o += 4 * m;
    this.way = new Uint16Array(buffer, o, m);
    this.n = n; this.m = m;
    this.lat = new Float64Array(n); this.lon = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.lat[i] = lat[i] / 1e7; this.lon[i] = lon[i] / 1e7; }
    this.ways = ways.map(([name, nameEn, ref, cls, kmh, ra]) => ({ name, nameEn, ref, cls, speed: kmh / 3.6, ra: !!ra }));
    this.time = new Float32Array(m);
    let vmax = 0;
    for (let e = 0; e < m; e++) {
      const w = this.ways[this.way[e]];
      this.time[e] = this.len[e] / w.speed;
      if (w.speed > vmax) vmax = w.speed;
    }
    this.vmax = vmax;
    this.dist = new Float64Array(n);
    this.meters = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.done = new Uint8Array(n);
    this._buildIndex();
  }

  edge(u, v) {
    for (let e = this.first[u], end = this.first[u + 1]; e < end; e++) if (this.target[e] === v) return e;
    return -1;
  }

  _buildIndex() {
    // Undirected road segments in a grid, plus each node's number of distinct neighbours.
    const { n, first, target, lat, lon } = this;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < n; i++) {
      if (lat[i] < minLat) minLat = lat[i]; if (lat[i] > maxLat) maxLat = lat[i];
      if (lon[i] < minLon) minLon = lon[i]; if (lon[i] > maxLon) maxLon = lon[i];
    }
    const cs = 0.0025;
    this.grid = { minLat, minLon, cs, W: Math.ceil((maxLon - minLon) / cs) + 1, H: Math.ceil((maxLat - minLat) / cs) + 1 };
    const cells = new Array(this.grid.W * this.grid.H);
    const segA = [], segB = [];
    this.degree = new Uint8Array(n);
    for (let a = 0; a < n; a++) {
      for (let e = first[a]; e < first[a + 1]; e++) {
        const b = target[e];
        if (a > b && this.edge(b, a) >= 0) continue; // already added from b
        const s = segA.length;
        segA.push(a); segB.push(b);
        if (this.degree[a] < 255) this.degree[a]++;
        if (this.degree[b] < 255) this.degree[b]++;
        const x0 = Math.floor((Math.min(lon[a], lon[b]) - minLon) / cs), x1 = Math.floor((Math.max(lon[a], lon[b]) - minLon) / cs);
        const y0 = Math.floor((Math.min(lat[a], lat[b]) - minLat) / cs), y1 = Math.floor((Math.max(lat[a], lat[b]) - minLat) / cs);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const c = y * this.grid.W + x;
          (cells[c] || (cells[c] = [])).push(s);
        }
      }
    }
    this.cells = cells; this.segA = segA; this.segB = segB;
  }

  // Nearest point on any road. Returns {a, b, t, dist, lat, lon} or null.
  snap(plat, plon, maxDist = 400) {
    const { minLat, minLon, cs, W, H } = this.grid;
    const cx = Math.floor((plon - minLon) / cs), cy = Math.floor((plat - minLat) / cs);
    const r = Math.ceil(maxDist / (cs * Geo.KX)) + 1;
    let best = null, bestD = maxDist;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        const list = this.cells[y * W + x];
        if (!list) continue;
        for (const s of list) {
          const a = this.segA[s], b = this.segB[s];
          const ax = (this.lon[a] - plon) * Geo.KX, ay = (this.lat[a] - plat) * Geo.KY;
          const bx = (this.lon[b] - plon) * Geo.KX, by = (this.lat[b] - plat) * Geo.KY;
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + t * dx, py = ay + t * dy;
          const d = Math.hypot(px, py);
          if (d < bestD) { bestD = d; best = { a, b, t, dist: d }; }
        }
      }
    }
    if (!best) return null;
    best.lat = this.lat[best.a] + best.t * (this.lat[best.b] - this.lat[best.a]);
    best.lon = this.lon[best.a] + best.t * (this.lon[best.b] - this.lon[best.a]);
    return best;
  }

  // Road node a car should stop at for a destination snapped onto segment (a,b).
  destNode(sn) { return sn.t < 0.5 ? sn.a : sn.b; }

  // Shortest-time search from a snapped start. With `goal` it is A* and stops at the goal;
  // without it, it settles the whole network (used to rank all stations by driving time).
  _search(start, goal = -1, headingDeg = null) {
    const { n, first, target, time, len, dist, meters, prev, done } = this;
    dist.fill(Infinity); meters.fill(0); prev.fill(-1); done.fill(0);
    const heap = new MinHeap();
    const hasGoal = goal >= 0;
    const gLat = hasGoal ? this.lat[goal] : 0, gLon = hasGoal ? this.lon[goal] : 0;
    const h = (v) => hasGoal ? Math.hypot((this.lon[v] - gLon) * Geo.KX, (this.lat[v] - gLat) * Geo.KY) / (this.vmax + 1) : 0;
    const seed = (from, to, frac) => {
      const e = this.edge(from, to);
      if (e < 0) return;
      let c = frac * time[e];
      if (headingDeg != null) {
        const br = Geo.bearing(this.lat[from], this.lon[from], this.lat[to], this.lon[to]);
        if (Math.abs(Geo.turn(headingDeg, br)) > 110) c += 60; // discourage U-turns while driving
      }
      if (c < dist[to]) {
        dist[to] = c; meters[to] = frac * len[e]; prev[to] = -2 - from; // negative = start edge
        heap.push(c + h(to), to);
      }
    };
    seed(start.a, start.b, 1 - start.t);
    seed(start.b, start.a, start.t);
    while (heap.size) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === goal) break;
      const du = dist[u];
      for (let e = first[u], end = first[u + 1]; e < end; e++) {
        const v = target[e];
        if (done[v]) continue;
        const nd = du + time[e];
        if (nd < dist[v]) {
          dist[v] = nd; meters[v] = meters[u] + len[e]; prev[v] = u;
          heap.push(nd + h(v), v);
        }
      }
    }
  }

  // Driving time/distance from a start to many destination nodes at once.
  costsTo(start, nodes) {
    this._search(start);
    return nodes.map((v) => (v >= 0 && this.done[v] ? { time: this.dist[v], meters: this.meters[v] } : null));
  }

  // Full route from a snapped start to a node. Returns {nodes, startPoint, firstFrom} or null.
  path(start, goal, headingDeg = null) {
    this._search(start, goal, headingDeg);
    if (!this.done[goal]) return null;
    const nodes = [];
    let v = goal, firstFrom = -1;
    while (v >= 0) {
      nodes.push(v);
      const p = this.prev[v];
      if (p <= -2) { firstFrom = -2 - p; break; }
      v = p;
    }
    nodes.reverse();
    return { nodes, firstFrom, time: this.dist[goal], meters: this.meters[goal] };
  }

  wayLabel(wi) {
    const w = this.ways[wi];
    return w ? (w.nameEn || w.name || w.ref || "") : "";
  }
}
