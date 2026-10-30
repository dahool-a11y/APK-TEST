#!/usr/bin/env python3
"""Erzeugt die PWA-Icons für Fahrtprofil."""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "icons")
os.makedirs(OUT, exist_ok=True)

S = 1024
BG = (10, 16, 23, 255)
GREEN = (61, 220, 132)
AMBER = (255, 209, 102)
RED = (255, 92, 92)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def color(t):
    if t < 0.5:
        return lerp(GREEN, AMBER, t / 0.5)
    return lerp(AMBER, RED, (t - 0.5) / 0.5)


def bezier(p0, p1, p2, p3, steps=140):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0]
        y = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]
        pts.append((x, y))
    return pts


def make(size, maskable=False):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=0 if maskable else 210, fill=BG)

    # dezenter Radial-Schein
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([180, 180, 840, 840], fill=(255, 209, 102, 18))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    img.alpha_composite(glow)

    pts = bezier((300, 760), (300, 430), (724, 590), (724, 264))
    scale = 0.82 if maskable else 1.0
    cx = cy = S / 2
    pts = [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in pts]

    # weicher Schatten / Glow
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for i in range(len(pts) - 1):
        sd.line([pts[i], pts[i + 1]], fill=color(i / (len(pts) - 1)) + (110,), width=110)
    shadow = shadow.filter(ImageFilter.GaussianBlur(34))
    img.alpha_composite(shadow)

    # Route
    for i in range(len(pts) - 1):
        d.line([pts[i], pts[i + 1]], fill=color(i / (len(pts) - 1)) + (255,), width=64)

    # Endpunkte
    def dot(p, fill, r):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(10, 16, 23, 255))
        rr = r - 10
        d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=fill)

    dot(pts[0], GREEN, 54)
    dot(pts[-1], RED, 54)

    img = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, f"icon-{size}{'-maskable' if maskable else ''}.png")
    img.save(path, optimize=True)
    print("geschrieben:", path)


make(192)
make(512)
make(512, maskable=True)
