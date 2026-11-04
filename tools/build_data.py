"""Build the offline routing graph and gas-station list from OpenStreetMap downloads.

Inputs  (data/):  roads.json, fuel.json   (Overpass API JSON)
Outputs (docs/data/): graph.bin, graph-ways.json, stations.json

graph.bin layout (little-endian):
  char[4]  magic "MFG1"
  uint32   nNodes, nEdges
  int32    lat[nNodes]   (degrees * 1e7)
  int32    lon[nNodes]
  uint32   first[nNodes+1]   CSR offsets into the edge arrays
  uint32   target[nEdges]
  float32  length[nEdges]    metres
  uint16   way[nEdges]       index into graph-ways.json
"""
import json
import math
import struct
import sys
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data"
OUT = ROOT / "docs" / "data"

SPEED = {  # km/h, deliberately conservative for city traffic
    "motorway": 90, "motorway_link": 45, "trunk": 70, "trunk_link": 40,
    "primary": 50, "primary_link": 35, "secondary": 40, "secondary_link": 30,
    "tertiary": 35, "tertiary_link": 25, "unclassified": 30, "road": 25,
    "residential": 22, "living_street": 10, "service": 12,
}
CLASS_RANK = {k: i for i, k in enumerate([
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "road",
    "residential", "living_street", "service", "motorway_link", "trunk_link",
    "primary_link", "secondary_link", "tertiary_link"])}


def haversine(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def parse_speed(tag):
    if not tag:
        return None
    try:
        v = float(tag.split()[0])
    except ValueError:
        return None
    if "mph" in tag:
        v *= 1.609
    return v if 5 <= v <= 140 else None


def build_graph():
    ways = json.load(open(RAW / "roads.json", encoding="utf-8"))["elements"]
    coords = {}
    way_attrs, way_index = [], {}
    raw_edges = []  # (a_osm, b_osm, way_attr_idx)

    for w in ways:
        t = w.get("tags", {})
        hw = t.get("highway")
        if hw not in SPEED:
            continue
        access = t.get("motor_vehicle") or t.get("motorcar") or t.get("vehicle") or t.get("access")
        if access in ("no", "private"):
            continue
        roundabout = t.get("junction") in ("roundabout", "circular")
        ow = t.get("oneway")
        if ow in ("yes", "true", "1"):
            fwd, bwd = True, False
        elif ow in ("-1", "reverse"):
            fwd, bwd = False, True
        elif ow == "no":
            fwd = bwd = True
        elif roundabout or hw == "motorway":
            fwd, bwd = True, False
        else:
            fwd = bwd = True

        speed = SPEED[hw]
        ms = parse_speed(t.get("maxspeed"))
        if ms:
            speed = min(speed * 1.2, ms * 0.85)
        name = t.get("name", "")
        name_en = t.get("name:en", "")
        attr = (name, name_en, t.get("ref", ""), CLASS_RANK[hw], round(speed, 1), 1 if roundabout else 0)
        if attr not in way_index:
            way_index[attr] = len(way_attrs)
            way_attrs.append(attr)
        ai = way_index[attr]

        nodes, geom = w["nodes"], w["geometry"]
        for nid, g in zip(nodes, geom):
            if g:
                coords[nid] = (g["lat"], g["lon"])
        for a, b in zip(nodes, nodes[1:]):
            if a not in coords or b not in coords or a == b:
                continue
            if fwd:
                raw_edges.append((a, b, ai))
            if bwd:
                raw_edges.append((b, a, ai))

    # Keep only the largest strongly connected component, so every snapped
    # point can reach every station and come back (no dead islands).
    ids = sorted({n for e in raw_edges for n in e[:2]})
    idx = {n: i for i, n in enumerate(ids)}
    n = len(ids)
    adj = [[] for _ in range(n)]
    for a, b, _ in raw_edges:
        adj[idx[a]].append(idx[b])
    comp = tarjan_scc(n, adj)
    sizes = {}
    for c in comp:
        sizes[c] = sizes.get(c, 0) + 1
    main = max(sizes, key=sizes.get)
    keep_ids = [ids[i] for i in range(n) if comp[i] == main]
    print(f"nodes {n} -> kept {len(keep_ids)} in main component ({len(sizes)} components)")

    new = {nid: i for i, nid in enumerate(keep_ids)}
    out_adj = [dict() for _ in keep_ids]
    for a, b, ai in raw_edges:
        if a in new and b in new:
            ia, ib = new[a], new[b]
            if ib not in out_adj[ia]:
                out_adj[ia][ib] = ai
    lat = array("i", (round(coords[i][0] * 1e7) for i in keep_ids))
    lon = array("i", (round(coords[i][1] * 1e7) for i in keep_ids))
    first, target, length, way = array("I", [0]), array("I"), array("f"), array("H")
    for ia, nbrs in enumerate(out_adj):
        la, lo = coords[keep_ids[ia]]
        for ib, ai in nbrs.items():
            lb, lob = coords[keep_ids[ib]]
            target.append(ib)
            length.append(haversine(la, lo, lb, lob))
            way.append(ai)
        first.append(len(target))
    assert len(way_attrs) < 65535

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "graph.bin", "wb") as f:
        f.write(b"MFG1")
        f.write(struct.pack("<II", len(keep_ids), len(target)))
        for arr in (lat, lon, first, target, length, way):
            if sys.byteorder != "little":
                arr.byteswap()
            f.write(arr.tobytes())
        if len(way) % 2:
            f.write(b"\0\0")
    # ways: [name, name_en, ref, classRank, speedKmh, roundabout]
    with open(OUT / "graph-ways.json", "w", encoding="utf-8") as f:
        json.dump([list(a) for a in way_attrs], f, ensure_ascii=False, separators=(",", ":"))
    print(f"edges {len(target)}, way kinds {len(way_attrs)}")


def tarjan_scc(n, adj):
    index = [-1] * n
    low = [0] * n
    on = [False] * n
    comp = [-1] * n
    stack, counter, c = [], 0, 0
    for root in range(n):
        if index[root] != -1:
            continue
        work = [(root, 0)]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on[root] = True
        while work:
            v, i = work[-1]
            if i < len(adj[v]):
                work[-1] = (v, i + 1)
                w = adj[v][i]
                if index[w] == -1:
                    index[w] = low[w] = counter
                    counter += 1
                    stack.append(w)
                    on[w] = True
                    work.append((w, 0))
                elif on[w]:
                    low[v] = min(low[v], index[w])
            else:
                work.pop()
                if work:
                    u = work[-1][0]
                    low[u] = min(low[u], low[v])
                if low[v] == index[v]:
                    while True:
                        w = stack.pop()
                        on[w] = False
                        comp[w] = c
                        if w == v:
                            break
                    c += 1
    return comp


def build_stations():
    els = json.load(open(RAW / "fuel.json", encoding="utf-8"))["elements"]
    out = []
    for e in els:
        t = e.get("tags", {})
        if e["type"] == "node":
            lat, lon = e["lat"], e["lon"]
        else:
            lat, lon = e["center"]["lat"], e["center"]["lon"]
        fuels = sorted(k[5:] for k, v in t.items() if k.startswith("fuel:") and v == "yes")
        s = {
            "id": f"osm-{e['type'][0]}{e['id']}",
            "lat": round(lat, 7), "lon": round(lon, 7),
            "name": t.get("name") or t.get("name:ar") or t.get("name:en") or "",
            "nameEn": t.get("name:en", ""),
            "nameAr": t.get("name:ar", ""),
        }
        for k_out, k_in in (("brand", "brand"), ("operator", "operator"), ("hours", "opening_hours"), ("street", "addr:street")):
            if t.get(k_in):
                s[k_out] = t[k_in]
        if fuels:
            s["fuels"] = fuels
        out.append(s)
    out.sort(key=lambda s: (-s["lat"], s["lon"]))
    with open(OUT / "stations.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"stations {len(out)}")


def write_info():
    import datetime
    stamp = datetime.datetime.fromtimestamp((RAW / "roads.json").stat().st_mtime)
    with open(OUT / "info.json", "w", encoding="utf-8") as f:
        json.dump({"date": stamp.strftime("%Y-%m-%d"), "area": "Mosul - Tel Kaif"}, f)


if __name__ == "__main__":
    build_graph()
    build_stations()
    write_info()
