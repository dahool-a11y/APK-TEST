#!/usr/bin/env python3
"""Erzeugt eine kleine Offline-Vektorkarte (JS) aus OpenStreetMap-Daten.

Datenquelle: Overpass API (ODbL). Das Ergebnis wird als
data/basemap.js gespeichert und von der App ohne Internet geladen.

Aufruf:
    python tools/build_basemap.py
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, "cache", "osm_raw.json")
OUT = os.path.join(ROOT, "data", "basemap.js")

# Demo-Region: München – Starnberg – Herrsching – Ammersee
BBOX = (47.86, 11.10, 48.17, 11.62)
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "Fahrtprofil-Offline-Demo/1.0 (private project)"

ROAD_CLASSES = {
    "motorway": "motorway", "motorway_link": "motorway",
    "trunk": "trunk", "trunk_link": "trunk",
    "primary": "primary", "primary_link": "primary",
    "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary",
    "residential": "minor", "unclassified": "minor", "living_street": "minor",
}

QUERY = """
[out:json][timeout:240];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)(_link)?$"]({bbox});
  way["railway"="rail"]({bbox});
  way["natural"="water"]({bbox});
  relation["natural"="water"]({bbox});
  way["waterway"~"^(river|canal)$"]({bbox});
  way["leisure"="park"]({bbox});
  way["landuse"="forest"]({bbox});
  node["place"~"^(city|town|village)$"]({bbox});
);
out geom;
"""


def fetch():
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    if os.path.exists(CACHE) and os.path.getsize(CACHE) > 10000:
        print("Nutze Cache:", CACHE)
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    bbox = ",".join(str(v) for v in BBOX)
    data = urllib.parse.urlencode({"data": QUERY.format(bbox=bbox)}).encode()
    req = urllib.request.Request(OVERPASS, data=data, headers={"User-Agent": UA})
    print("Lade OSM-Daten …")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=400) as r:
        raw = r.read()
    print("  %.1f MB in %.0f s" % (len(raw) / 1e6, time.time() - t0))
    with open(CACHE, "wb") as f:
        f.write(raw)
    return json.loads(raw)


def rnd(v):
    return round(v, 5)


def simplify(points, tol):
    """Douglas-Peucker, input/output [[lng,lat],...]"""
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    norm = math.hypot(dx, dy)
    best_i, best_d = 0, -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if norm == 0:
            d = math.hypot(px - a[0], py - a[1])
        else:
            d = abs(dy * px - dx * py + b[0] * a[1] - b[1] * a[0]) / norm
        if d > best_d:
            best_i, best_d = i, d
    if best_d > tol:
        left = simplify(points[:best_i + 1], tol)
        right = simplify(points[best_i:], tol)
        return left[:-1] + right
    return [a, b]


def near(a, b, eps=1e-6):
    return abs(a[0] - b[0]) <= eps and abs(a[1] - b[1]) <= eps


def stitch_rings(segments):
    segs = [s[:] for s in segments if len(s) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and not near(cur[0], cur[-1]):
            changed = False
            for i, s in enumerate(segs):
                if near(cur[-1], s[0]):
                    cur.extend(s[1:]); segs.pop(i); changed = True; break
                if near(cur[-1], s[-1]):
                    cur.extend(reversed(s[:-1])); segs.pop(i); changed = True; break
                if near(cur[0], s[-1]):
                    cur = s[:-1] + cur; segs.pop(i); changed = True; break
                if near(cur[0], s[0]):
                    cur = list(reversed(s[1:])) + cur; segs.pop(i); changed = True; break
        if len(cur) >= 4:
            rings.append(cur)
    return rings


def main():
    raw = fetch()
    roads, rails, rivers = [], [], []
    water, green = [], []
    places = []

    for el in raw.get("elements", []):
        tags = el.get("tags", {})
        kind = el.get("type")

        if kind == "node" and tags.get("place") in ("city", "town", "village"):
            name = tags.get("name")
            if name:
                places.append({"n": name, "t": tags["place"], "lat": rnd(el["lat"]), "lng": rnd(el["lon"])})
            continue

        if kind == "way":
            geom = el.get("geometry") or []
            pts = [[rnd(p["lon"]), rnd(p["lat"])] for p in geom if p]
            if len(pts) < 2:
                continue

            hw = tags.get("highway")
            if hw in ROAD_CLASSES:
                line = simplify(pts, 0.00003)
                if len(line) >= 2:
                    roads.append({"c": ROAD_CLASSES[hw], "g": line})
                continue

            if tags.get("railway") == "rail":
                rails.append(simplify(pts, 0.00005))
                continue

            if tags.get("waterway") in ("river", "canal"):
                rivers.append(simplify(pts, 0.00006))
                continue

            if tags.get("natural") == "water" or tags.get("leisure") == "park" or tags.get("landuse") == "forest":
                ring = pts
                if not near(ring[0], ring[-1]):
                    ring = ring + [ring[0]]
                ring = simplify(ring, 0.00008)
                if len(ring) >= 4:
                    target = water if tags.get("natural") == "water" else green
                    target.append(ring)

        elif kind == "relation" and tags.get("natural") == "water":
            segs = []
            for m in el.get("members", []):
                if m.get("type") != "way" or m.get("role") == "inner":
                    continue
                g = m.get("geometry") or []
                if len(g) >= 2:
                    segs.append([[rnd(p["lon"]), rnd(p["lat"])] for p in g if p])
            for ring in stitch_rings(segs):
                ring = simplify(ring, 0.00008)
                if len(ring) >= 4:
                    water.append(ring)

    # Deduplizieren (gleiche Wege können in Way- und Relation-Queries auftauchen)
    def dedupe(items, keyfunc):
        seen, out = set(), []
        for it in items:
            k = keyfunc(it)
            if k in seen:
                continue
            seen.add(k)
            out.append(it)
        return out

    water = dedupe(water, lambda r: (len(r), tuple(r[0]), tuple(r[len(r) // 2])))
    green = dedupe(green, lambda r: (len(r), tuple(r[0]), tuple(r[len(r) // 2])))
    places = dedupe(places, lambda p: (p["n"], p["t"]))

    data = {
        "meta": {
            "source": "OpenStreetMap contributors",
            "license": "ODbL 1.0",
            "bbox": BBOX,
            "built": time.strftime("%Y-%m-%d"),
        },
        "roads": roads,
        "rails": rails,
        "rivers": rivers,
        "water": water,
        "green": green,
        "places": places,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    js = "window.BASEMAP=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)

    print("Geschrieben:", OUT, "(%.2f MB)" % (len(js.encode("utf-8")) / 1e6))
    print("  Straßen: %d | Wasser: %d | Grün: %d | Flüsse: %d | Bahn: %d | Orte: %d"
          % (len(roads), len(water), len(green), len(rivers), len(rails), len(places)))


if __name__ == "__main__":
    main()
