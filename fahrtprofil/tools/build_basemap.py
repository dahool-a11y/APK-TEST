#!/usr/bin/env python3
"""Erzeugt die Offline-Vektorkarte (data/basemap.js) für Lettland.

Datenquellen:
  * OpenStreetMap-Mitwirkende (ODbL) – Geofabrik-Auszug als .osm.pbf
  * Natural Earth 1:10m (gemeinfrei) – Landflächen und Staatsgrenzen

Aufruf:
    python tools/build_basemap.py --pbf latvia-latest.osm.pbf \
        --countries ne_10m_admin_0_countries.shp

Benötigt: pip install osmium pyshp

Das Skript liest den PBF zweimal: zuerst die Wasser-Multipolygone (Relationen),
dann alle Wege mit Koordinaten. So lassen sich auch große Seen wie Lubāns
zusammensetzen, ohne die komplette Datei im Speicher zu halten.
"""
import argparse
import json
import math
import os
import time

import osmium
import shapefile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "basemap.js")

# Lettland mit etwas Rand
BBOX = (55.60, 20.85, 58.15, 28.30)

ROAD_CLASSES = {
    "motorway": "motorway", "motorway_link": "motorway",
    "trunk": "trunk", "trunk_link": "trunk",
    "primary": "primary", "primary_link": "primary",
    "secondary": "secondary", "secondary_link": "secondary",
}

# Douglas-Peucker in Grad (1° ≈ 111 km, 0.001° ≈ 110 m)
ROAD_TOL = 0.0006
RAIL_TOL = 0.0008
RIVER_TOL = 0.0009
WATER_TOL = 0.0010
LAND_TOL = 0.0030

MIN_WATER_KM2 = 0.25
MIN_LAND_KM2 = 0.5

PLACE_TYPES = ("city", "town")


def rnd(v):
    return round(v, 4)


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
        if len(cur) >= 4 and near(cur[0], cur[-1]):
            rings.append(cur)
    return rings


def simplify_ring(ring, tol):
    """Douglas-Peucker für geschlossene Ringe (an der fernsten Stelle geteilt)."""
    pts = ring[:-1] if near(ring[0], ring[-1]) else ring[:]
    if len(pts) < 4:
        return ring
    x0, y0 = pts[0]
    far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - x0, pts[i][1] - y0))
    if far < 1 or far >= len(pts) - 1:
        return ring
    a = simplify(pts[:far + 1], tol)
    b = simplify(pts[far:] + [pts[0]], tol)
    return a[:-1] + b


def area_km2(ring):
    """Überschlägige Fläche eines Rings in km² (ebene Näherung)."""
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx = 111.32 * math.cos(math.radians(lat0))
    ky = 110.57
    s = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0] * kx, ring[i][1] * ky
        x2, y2 = ring[i + 1][0] * kx, ring[i + 1][1] * ky
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def closed_ring(points):
    if len(points) < 3:
        return None
    ring = points if near(points[0], points[-1]) else points + [points[0]]
    return ring


def clean_ring(ring, tol):
    ring = simplify_ring(ring, tol)
    if len(ring) < 4 or not near(ring[0], ring[-1]):
        return None
    return ring


def water_polygon_relations(path):
    """Erster Durchgang: Wasser-Multipolygone und ihre Weg-IDs sammeln."""
    rels = {}
    fp = osmium.FileProcessor(path)
    for obj in fp:
        if not obj.is_relation():
            continue
        tags = obj.tags
        if not (tags.get("natural") == "water" or tags.get("water") in ("lake", "reservoir", "river", "pond", "basin")):
            continue
        refs = []
        for m in obj.members:
            if m.type == "w" and m.role != "inner":
                refs.append(m.ref)
        if refs:
            rels[obj.id] = [tags.get("name") or "", refs]
    return rels


def build_from_osm(path):
    rels = water_polygon_relations(path)
    wanted = set()
    for _, refs in rels.values():
        wanted.update(refs)
    print("  Wasser-Relationen: %d, benötigte Wege: %d" % (len(rels), len(wanted)))

    roads, rails, rivers, water = [], [], [], []
    places = []
    rel_geom = {}

    fp = osmium.FileProcessor(path).with_locations()
    for obj in fp:
        if obj.is_node():
            tags = obj.tags
            if tags.get("place") in PLACE_TYPES and tags.get("name"):
                places.append({
                    "n": tags["name"], "t": tags["place"],
                    "lat": rnd(obj.location.lat), "lng": rnd(obj.location.lon),
                })
            continue
        if not obj.is_way():
            continue

        tags = obj.tags
        pts = [[rnd(n.lon), rnd(n.lat)] for n in obj.nodes if n.location.valid()]
        if len(pts) < 2:
            continue

        if obj.id in wanted:
            rel_geom[obj.id] = pts

        hw = tags.get("highway")
        if hw in ROAD_CLASSES:
            roads.append({"c": ROAD_CLASSES[hw], "g": simplify(pts, ROAD_TOL)})
            continue

        if tags.get("railway") == "rail":
            if tags.get("service") is None:
                rails.append(simplify(pts, RAIL_TOL))
            continue

        if tags.get("waterway") in ("river", "canal"):
            rivers.append(simplify(pts, RIVER_TOL))
            continue

        if tags.get("natural") == "water":
            ring = closed_ring(pts)
            ring = clean_ring(ring, WATER_TOL) if ring else None
            if ring and area_km2(ring) >= MIN_WATER_KM2:
                water.append(ring)

    for name, refs in rels.values():
        segs = [rel_geom[r] for r in refs if r in rel_geom]
        for ring in stitch_rings(segs):
            ring = clean_ring(ring, WATER_TOL)
            if ring and area_km2(ring) >= MIN_WATER_KM2:
                water.append(ring)

    return roads, rails, rivers, water, places


def clip_polygon(poly, bbox):
    """Sutherland-Hodgman gegen das BBOX-Rechteck."""
    minx, miny, maxx, maxy = bbox[1], bbox[0], bbox[3], bbox[2]
    edges = (
        (lambda p: p[0] >= minx, lambda a, b: (minx, a[1] + (b[1] - a[1]) * (minx - a[0]) / (b[0] - a[0]))),
        (lambda p: p[0] <= maxx, lambda a, b: (maxx, a[1] + (b[1] - a[1]) * (maxx - a[0]) / (b[0] - a[0]))),
        (lambda p: p[1] >= miny, lambda a, b: (a[0] + (b[0] - a[0]) * (miny - a[1]) / (b[1] - a[1]), miny)),
        (lambda p: p[1] <= maxy, lambda a, b: (a[0] + (b[0] - a[0]) * (maxy - a[1]) / (b[1] - a[1]), maxy)),
    )
    out = poly
    for inside, cut in edges:
        if not out:
            break
        src, out = out, []
        prev = src[-1]
        prev_in = inside(prev)
        for cur in src:
            cur_in = inside(cur)
            if cur_in:
                if not prev_in:
                    out.append(cut(prev, cur))
                out.append(cur)
            elif prev_in:
                out.append(cut(prev, cur))
            prev, prev_in = cur, cur_in
    return out


def clip_line(points, bbox):
    """Schneidet eine Linie am BBOX-Rechteck (Liang-Barsky) und liefert Teilstücke."""
    minx, miny, maxx, maxy = bbox[1], bbox[0], bbox[3], bbox[2]

    def seg(a, b):
        x1, y1 = a
        dx, dy = b[0] - x1, b[1] - y1
        t0, t1 = 0.0, 1.0
        for p, q in ((-dx, x1 - minx), (dx, maxx - x1), (-dy, y1 - miny), (dy, maxy - y1)):
            if p == 0:
                if q < 0:
                    return None
                continue
            t = q / p
            if p < 0:
                if t > t1:
                    return None
                t0 = max(t0, t)
            else:
                if t < t0:
                    return None
                t1 = min(t1, t)
        return ((x1 + dx * t0, y1 + dy * t0), (x1 + dx * t1, y1 + dy * t1))

    pieces, cur = [], []
    for i in range(len(points) - 1):
        r = seg(points[i], points[i + 1])
        if not r:
            if len(cur) >= 2:
                pieces.append(cur)
            cur = []
            continue
        a, b = r
        if not cur or near(cur[-1], a, 1e-9):
            if not cur:
                cur = [a]
            cur.append(b)
        else:
            if len(cur) >= 2:
                pieces.append(cur)
            cur = [a, b]
    if len(cur) >= 2:
        pieces.append(cur)
    return pieces


def build_land(countries_path):
    """Landflächen und Grenzlinien aus Natural Earth (1:10m)."""
    land, borders = [], []
    reader = shapefile.Reader(countries_path, encoding="utf-8")
    box = (BBOX[1], BBOX[0], BBOX[3], BBOX[2])
    for shape in reader.shapes():
        if (shape.bbox[2] < box[0] or shape.bbox[0] > box[2] or
                shape.bbox[3] < box[1] or shape.bbox[1] > box[3]):
            continue
        parts = list(shape.parts) + [len(shape.points)]
        for i in range(len(shape.parts)):
            part = shape.points[parts[i]:parts[i + 1]]
            if len(part) < 4:
                continue
            poly = clip_polygon(part, BBOX)
            if len(poly) < 4:
                continue
            ring = clean_ring([[rnd(p[0]), rnd(p[1])] for p in poly], LAND_TOL)
            if ring and area_km2(ring) >= MIN_LAND_KM2:
                land.append(ring)

            # Grenzlinie ohne die Schnittkanten des Rechtecks
            for piece in clip_line([[p[0], p[1]] for p in part], BBOX):
                line = simplify([[rnd(p[0]), rnd(p[1])] for p in piece], LAND_TOL)
                if len(line) >= 2:
                    borders.append(line)
    return land, borders


def dedupe(items, keyfunc):
    seen, out = set(), []
    for it in items:
        k = keyfunc(it)
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True, help="Geofabrik .osm.pbf (z. B. latvia-latest.osm.pbf)")
    ap.add_argument("--countries", help="Natural Earth ne_10m_admin_0_countries.shp (optional)")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    t0 = time.time()
    print("Lese Straßen, Wasser, Orte …")
    roads, rails, rivers, water, places = build_from_osm(args.pbf)

    land, borders = ([], [])
    if args.countries:
        print("Lese Landflächen …")
        land, borders = build_land(args.countries)

    water = dedupe(water, lambda r: (len(r), tuple(r[0]), tuple(r[len(r) // 2])))
    places = dedupe(places, lambda p: (p["n"], p["t"]))

    def sort_key(cls):
        return {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3}.get(cls, 9)

    roads.sort(key=lambda r: sort_key(r["c"]))
    places.sort(key=lambda p: (0 if p["t"] == "city" else 1, p["n"]))
    water.sort(key=lambda r: -area_km2(r))

    data = {
        "meta": {
            "source": "OpenStreetMap contributors",
            "license": "ODbL 1.0",
            "region": "Latvia",
            "bbox": BBOX,
            "built": time.strftime("%Y-%m-%d"),
        },
        "roads": roads,
        "rails": rails,
        "rivers": rivers,
        "water": water,
        "green": [],
        "land": land,
        "borders": borders,
        "places": places,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    js = "window.BASEMAP=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(js)

    def layer_mb(key):
        return len(json.dumps(data[key], ensure_ascii=False, separators=(",", ":")).encode("utf-8")) / 1e6

    print("Geschrieben:", args.out, "(%.2f MB) in %.0f s" % (len(js.encode("utf-8")) / 1e6, time.time() - t0))
    print("  Straßen: %d (%.2f MB) | Wasser: %d (%.2f MB) | Flüsse: %d"
          % (len(roads), layer_mb("roads"), len(water), layer_mb("water"), len(rivers)))
    print("  Bahn: %d | Orte: %d | Land: %d (%.2f MB) | Grenzen: %d"
          % (len(rails), len(places), len(land), layer_mb("land"), len(borders)))


if __name__ == "__main__":
    main()
