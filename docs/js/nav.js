// Turns a graph path into a drivable route with turn instructions, and tracks progress while driving.
"use strict";

const Fmt = {
  dist(m) {
    if (m < 50) return `${Math.max(0, Math.round(m / 5) * 5)} m`;
    if (m < 1000) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  },
  distSpoken(m) {
    if (m < 1000) return `${Math.max(10, Math.round(m / (m > 300 ? 50 : 10)) * (m > 300 ? 50 : 10))} meters`;
    const km = Math.round(m / 100) / 10;
    return km === 1 ? "1 kilometer" : `${km} kilometers`;
  },
  time(s) {
    const min = Math.max(1, Math.round(s / 60));
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${min % 60} min`;
  },
  clock(d) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  },
};

const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const isLatin = (s) => /^[\x00-ɏ\s.'’-]+$/.test(s);

function buildRoute(graph, startSnap, p, station, destSnap) {
  const G = graph;
  // Geometry: start point on the road, then road nodes, then the station itself.
  const coords = [[startSnap.lon, startSnap.lat]];
  const segWay = [];
  const nodeAt = [-1]; // graph node for each coordinate (-1 = not a node)
  const e0 = G.edge(p.firstFrom, p.nodes[0]);
  segWay.push(e0 >= 0 ? G.way[e0] : -1);
  p.nodes.forEach((v, i) => {
    coords.push([G.lon[v], G.lat[v]]);
    nodeAt.push(v);
    if (i < p.nodes.length - 1) {
      const e = G.edge(v, p.nodes[i + 1]);
      segWay.push(e >= 0 ? G.way[e] : -1);
    }
  });
  // drop a zero-length first segment (start exactly on a node)
  if (coords.length > 2 && Geo.dist(coords[0][1], coords[0][0], coords[1][1], coords[1][0]) < 0.5) {
    coords.shift(); nodeAt.shift(); segWay.shift(); nodeAt[0] = -1;
  }
  const roadEnd = coords.length - 1;
  const stationDist = Geo.dist(coords[roadEnd][1], coords[roadEnd][0], station.lat, station.lon);
  if (stationDist > 3) { coords.push([station.lon, station.lat]); nodeAt.push(-1); segWay.push(-1); }

  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + Geo.dist(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  const total = cum[cum.length - 1];
  const route = { coords, segWay, nodeAt, cum, total, roadEnd, time: p.time, station, steps: [] };

  // Bearing of the route around coordinate j, looking `d` metres back or ahead (smooths curvy geometry).
  const pointAt = (s) => {
    s = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = cum[i] > cum[i - 1] ? (s - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
    return [coords[i - 1][1] + f * (coords[i][1] - coords[i - 1][1]), coords[i - 1][0] + f * (coords[i][0] - coords[i - 1][0])];
  };
  const bearingIn = (j) => { const a = pointAt(cum[j] - 20); return Geo.bearing(a[0], a[1], coords[j][1], coords[j][0]); };
  const bearingOut = (j) => {
    const lim = j < roadEnd ? cum[roadEnd] : total;
    const b = pointAt(Math.min(cum[j] + 20, lim));
    return Geo.bearing(coords[j][1], coords[j][0], b[0], b[1]);
  };
  const label = (wi) => (wi >= 0 ? G.wayLabel(wi) : "");
  const spokenLabel = (wi) => {
    if (wi < 0) return "";
    const w = G.ways[wi];
    if (w.nameEn) return w.nameEn;
    if (w.name && isLatin(w.name)) return w.name;
    return w.ref ? `road ${w.ref}` : "";
  };
  const roadKey = (wi) => { if (wi < 0) return ""; const w = G.ways[wi]; return w.name || w.ref || w.nameEn || ""; };

  // Depart
  const b0 = bearingOut(0);
  const depName = label(segWay[0]);
  route.steps.push({
    j: 0, type: "depart", angle: 0,
    text: `Head ${COMPASS[Math.round(b0 / 45) % 8]}${depName ? " on " + depName : ""}`,
    say: `Head ${COMPASS[Math.round(b0 / 45) % 8]}${spokenLabel(segWay[0]) ? " on " + spokenLabel(segWay[0]) : ""}`,
  });

  const raw = [];
  for (let j = 1; j < roadEnd; j++) {
    const wIn = segWay[j - 1], wOut = segWay[j];
    const raIn = wIn >= 0 && G.ways[wIn].ra, raOut = wOut >= 0 && G.ways[wOut].ra;
    if (!raIn && raOut) {
      // Entering a roundabout: count exits until we leave it.
      let k = j + 1, exits = 0;
      for (; k <= roadEnd; k++) {
        const v = nodeAt[k];
        if (v >= 0) {
          for (let e = G.first[v]; e < G.first[v + 1]; e++) {
            if (!G.ways[G.way[e]].ra) { exits++; break; }
          }
        }
        const wk = segWay[k];
        if (k === roadEnd || wk < 0 || !G.ways[wk].ra) break;
      }
      exits = Math.max(1, Math.min(exits, 8));
      const after = k < segWay.length ? segWay[k] : -1;
      raw.push({ j, type: "roundabout", exit: exits, exitJ: k, angle: Geo.turn(bearingIn(j), bearingOut(Math.min(k, roadEnd - 1))), name: label(after), sayName: spokenLabel(after) });
      j = k;
      continue;
    }
    if (raIn) continue;
    const v = nodeAt[j];
    const deg = v >= 0 ? G.degree[v] : 2;
    const angle = Geo.turn(bearingIn(j), bearingOut(j));
    const refIn = wIn >= 0 ? G.ways[wIn].ref : "", refOut = wOut >= 0 ? G.ways[wOut].ref : "";
    const nameChange = roadKey(wIn) !== roadKey(wOut) && roadKey(wOut) !== "" && !(refIn && refIn === refOut);
    const a = Math.abs(angle);
    if (deg < 3 && !(nameChange && a > 40)) continue;
    if (a < 25 && !nameChange) continue;
    if (a < 40 && roadKey(wIn) !== "" && !nameChange) continue; // road just bends
    raw.push({ j, type: a < 25 ? "continue" : "turn", angle, name: label(wOut), sayName: spokenLabel(wOut) });
  }

  // Merge maneuvers that are very close together (e.g. U-turn through a median gap).
  const merged = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === "turn" && s.type === "turn" && cum[s.j] - cum[last.j] < 30 && Math.sign(s.angle) === Math.sign(last.angle)) {
      // measure the whole manoeuvre: heading before the first turn vs. heading after the second
      const total = Geo.turn(bearingIn(last.j), bearingOut(s.j));
      last.angle = Math.abs(total) >= 150 ? Math.sign(last.angle) * Math.abs(total) : total;
      last.name = s.name; last.sayName = s.sayName;
      continue;
    }
    merged.push(s);
  }

  for (const s of merged) {
    let verb;
    const a = Math.abs(s.angle), side = s.angle > 0 ? "right" : "left";
    if (s.type === "roundabout") {
      verb = `At the roundabout, take the ${ORDINAL[s.exit]} exit`;
      s.modifier = "roundabout";
    } else if (s.type === "continue") {
      verb = "Continue"; s.modifier = "straight";
    } else if (a >= 150) {
      verb = "Make a U-turn"; s.modifier = "uturn";
    } else if (a >= 120) {
      verb = `Turn sharp ${side}`; s.modifier = "sharp-" + side;
    } else if (a >= 55) {
      verb = `Turn ${side}`; s.modifier = side;
    } else {
      verb = `Keep ${side}`; s.modifier = "slight-" + side;
    }
    s.text = verb + (s.name ? ` onto ${s.name}` : "");
    s.say = verb + (s.sayName ? ` onto ${s.sayName}` : "");
    route.steps.push(s);
  }

  // Arrive: say which side of the road the station is on.
  let sideTxt = "";
  if (roadEnd >= 1 && stationDist > 8) {
    const br = Geo.bearing(coords[roadEnd - 1][1], coords[roadEnd - 1][0], coords[roadEnd][1], coords[roadEnd][0]);
    const toSt = Geo.bearing(coords[roadEnd][1], coords[roadEnd][0], station.lat, station.lon);
    const t = Geo.turn(br, toSt);
    if (Math.abs(t) > 20 && Math.abs(t) < 160) sideTxt = t > 0 ? "on your right" : "on your left";
  }
  route.steps.push({ j: roadEnd, type: "arrive", modifier: "arrive", angle: 0, text: `Arrive at the gas station${sideTxt ? ", " + sideTxt : ""}`, say: `You have arrived. The gas station is ${sideTxt || "here"}.` });
  route.steps.forEach((s) => { s.at = cum[s.j]; });
  route.walk = stationDist; // last bit from the road to the pump
  return route;
}

// Follows GPS fixes along a route and decides what to show and say.
class Navigator {
  constructor(route, { onUpdate, onOffRoute, onArrive, speak }) {
    this.route = route;
    this.onUpdate = onUpdate; this.onOffRoute = onOffRoute; this.onArrive = onArrive; this.speak = speak;
    this.seg = 0;
    this.along = 0;
    this.offCount = 0;
    this.spoken = new Map(); // step index -> stage spoken (1 = early, 2 = now)
    this.arrived = false;
  }

  // index of the route segment that contains distance s
  _segAt(s) {
    const cum = this.route.cum;
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
    return Math.max(0, lo);
  }

  // Project a fix onto the route near where we were last time (or anywhere on it, if `whole`).
  _project(lat, lon, whole = false) {
    const { coords, cum } = this.route;
    let best = { d: Infinity, dist: Infinity };
    const from = whole ? 0 : this._segAt(this.along - 300);
    const to = whole ? coords.length - 2 : Math.min(coords.length - 2, this._segAt(this.along + 1500) + 1);
    const jump = 200 + (this.speed || 10) * 3; // further ahead than we could have driven since the last fix
    for (let i = from; i <= to; i++) {
      const ax = (coords[i][0] - lon) * Geo.KX, ay = (coords[i][1] - lat) * Geo.KY;
      const bx = (coords[i + 1][0] - lon) * Geo.KX, by = (coords[i + 1][1] - lat) * Geo.KY;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      const along = cum[i] + t * (cum[i + 1] - cum[i]);
      // where the route passes near itself, prefer the part we are actually on: no jumping back, no leaping ahead
      const score = d + (along < this.along - 20 ? 25 : 0) + (!whole && along > this.along + jump ? 40 : 0);
      if (score < best.d) best = { d: score, dist: d, i, t, along };
    }
    return best;
  }

  update(fix) {
    if (this.arrived) return;
    const r = this.route;
    if (fix.speed != null && fix.speed >= 0) this.speed = fix.speed;
    const tol = Math.max(35, Math.min(fix.accuracy || 0, 60) * 1.2);
    let p = this._project(fix.lat, fix.lon);
    if (p.dist > tol) {
      // before calling it off-route, check whether we're on another part of the route
      const q = this._project(fix.lat, fix.lon, true);
      if (q.dist <= tol) p = q;
    }
    if (p.dist > tol) {
      this.offCount++;
      if (this.offCount >= 2) { this.offCount = 0; this.onOffRoute(fix); return; }
    } else {
      this.offCount = 0;
      this.seg = p.i;
      // ignore small backward GPS jitter, but accept a real correction
      this.along = p.along >= this.along - 30 ? Math.max(this.along - 5, p.along) : p.along;
    }
    const remaining = Math.max(0, r.total - this.along);
    const toStation = Geo.dist(fix.lat, fix.lon, r.station.lat, r.station.lon);
    if (toStation < 30 || remaining < 15) {
      this.arrived = true;
      this.speak(r.steps[r.steps.length - 1].say);
      this.onArrive();
      return;
    }
    let k = r.steps.findIndex((s, i) => i > 0 && s.at > this.along + 3);
    if (k < 0) k = r.steps.length - 1;
    const step = r.steps[k];
    const toNext = step.at - this.along;
    const speed = fix.speed != null && fix.speed > 0 ? fix.speed : 10;
    const early = Math.min(700, Math.max(180, speed * 22));
    const now = Math.min(120, Math.max(35, speed * 5));
    const stage = this.spoken.get(k) || 0;
    if (step.type === "continue") {
      // road just changes name: shown on screen, not spoken
    } else if (step.type !== "arrive") {
      if (toNext <= now && stage < 2) {
        this.spoken.set(k, 2);
        const next = r.steps[k + 1];
        const then = next && next.type !== "arrive" && next.at - step.at < 150 ? `, then ${next.say.charAt(0).toLowerCase() + next.say.slice(1)}` : "";
        this.speak(step.say + then);
      } else if (toNext <= early && toNext > now + 40 && stage < 1) {
        this.spoken.set(k, 1);
        this.speak(`In ${Fmt.distSpoken(toNext)}, ${step.say.charAt(0).toLowerCase() + step.say.slice(1)}`);
      }
    } else if (toNext < 250 && stage < 1) {
      this.spoken.set(k, 1);
      this.speak(`The gas station is in ${Fmt.distSpoken(toNext)}`);
    }
    const avgSpeed = r.total / Math.max(1, r.time);
    this.onUpdate({ step, next: r.steps[k + 1], toNext, remaining, eta: remaining / avgSpeed, snapped: p, along: this.along });
  }
}

// Text-to-speech using the phone's built-in voices (works offline).
const Voice = {
  enabled: true,
  voice: null,
  init() {
    if (!("speechSynthesis" in window)) { this.enabled = false; return; }
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      this.voice = vs.find((v) => v.lang === "en-US" && v.localService) || vs.find((v) => v.lang.startsWith("en") && v.localService) || vs.find((v) => v.lang.startsWith("en")) || null;
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  },
  say(text, interrupt = false) {
    if (!this.enabled || !("speechSynthesis" in window) || !text) return;
    if (interrupt || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice ? this.voice.lang : "en-US";
    u.rate = 1;
    speechSynthesis.speak(u);
  },
};
