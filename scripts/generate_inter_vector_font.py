#!/usr/bin/env python3
"""Flatten the exact Inter source into resolution-independent glyph contours.

Requires FontTools only when regenerating this checked-in asset. Runtime and CI
consume the generated mesh and do not rasterize text into pixel blocks.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont


class FlattenPen(BasePen):
    def __init__(self, glyph_set, curve_steps=24):
        super().__init__(glyph_set)
        self.steps = curve_steps
        self.contours = []
        self.current = []

    def _moveTo(self, point):
        self._finish()
        self.current = [point]

    def _lineTo(self, point):
        self.current.append(point)

    def _qCurveToOne(self, control, end):
        start = self.current[-1]
        for index in range(1, self.steps + 1):
            t = index / self.steps
            a = 1 - t
            self.current.append((a*a*start[0] + 2*a*t*control[0] + t*t*end[0],
                                 a*a*start[1] + 2*a*t*control[1] + t*t*end[1]))

    def _curveToOne(self, first, second, end):
        start = self.current[-1]
        for index in range(1, self.steps + 1):
            t = index / self.steps
            a = 1 - t
            self.current.append((a**3*start[0] + 3*a*a*t*first[0] +
                                 3*a*t*t*second[0] + t**3*end[0],
                                 a**3*start[1] + 3*a*a*t*first[1] +
                                 3*a*t*t*second[1] + t**3*end[1]))

    def _closePath(self):
        self._finish()

    def _endPath(self):
        self._finish()

    def _finish(self):
        points = []
        for point in self.current:
            if not points or math.dist(points[-1], point) > 0.01:
                points.append(point)
        if len(points) > 2 and math.dist(points[0], points[-1]) < 0.01:
            points.pop()
        if len(points) >= 3:
            self.contours.append(points)
        self.current = []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--font", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    records = json.loads(args.catalog.read_text(encoding="utf-8"))["stores"]
    characters = set(" ?ÁÉÍÓÚÑÜÇáéíóúñüç")
    for row in records:
        characters.update(row.get("name") or "")
        characters.update(row.get("local_number") or "")

    font = TTFont(args.font)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    units = font["head"].unitsPerEm
    metrics = font["hmtx"].metrics
    glyphs = {}
    for character in sorted(characters):
        name = cmap.get(ord(character))
        if not name:
            raise ValueError(f"Inter source lacks required glyph {character!r}")
        pen = FlattenPen(glyph_set, 24)
        glyph_set[name].draw(pen)
        pen._finish()
        glyphs[character] = {
            "a": round(metrics[name][0] / units, 6),
            "contours": [[[round(x / units, 6), round(y / units, 6)]
                          for x, y in contour] for contour in pen.contours],
        }
    payload = {
        "schema": "retailnav.vector-font-contours.v1", "family": "Inter",
        "weight": 500, "sourceSha256": hashlib.sha256(args.font.read_bytes()).hexdigest(),
        "unitsPerEm": units, "ascender": round(font["hhea"].ascent / units, 6),
        "descender": round(font["hhea"].descent / units, 6),
        "curveSegmentsPerQuadratic": 24, "glyphs": glyphs,
    }
    args.out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
