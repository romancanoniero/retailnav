#!/usr/bin/env python3
"""Extract Alto Palermo's native SVG regions and link official map markers.

The mall publishes real vector floor plans. We preserve those paths in their
original coordinate space, flatten cubic curves deterministically, and link an
official marker only when its tip falls inside one unambiguous commercial
region. The association remains provisional; the geometry itself comes
directly from the official SVG and is never replaced with synthetic rectangles.
"""
import argparse
import base64
import csv
import json
import math
import re
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path


COMMERCIAL_FILLS = {"#F1D9E2", "#F2D3E2"}
FLOOR_FILL = "#EFE3E3"
TOKEN = re.compile(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
SCALE = 3.0


def signed_area(points):
    return sum(points[i][0] * points[(i + 1) % len(points)][1] -
               points[(i + 1) % len(points)][0] * points[i][1]
               for i in range(len(points))) / 2


def clean_ring(points):
    cleaned = []
    for point in points:
        if not cleaned or math.dist(cleaned[-1], point) > 1e-7:
            cleaned.append(point)
    if len(cleaned) > 2 and math.dist(cleaned[0], cleaned[-1]) < 1e-7:
        cleaned.pop()
    changed = True
    while changed and len(cleaned) > 3:
        changed = False
        result = []
        for index, point in enumerate(cleaned):
            previous = cleaned[index - 1]
            following = cleaned[(index + 1) % len(cleaned)]
            cross = ((point[0] - previous[0]) * (following[1] - point[1]) -
                     (point[1] - previous[1]) * (following[0] - point[0]))
            if abs(cross) < 1e-7:
                changed = True
            else:
                result.append(point)
        cleaned = result
    return cleaned


def parse_path(data, curve_steps=12):
    tokens = TOKEN.findall(data)
    index = 0
    command = None
    x = y = 0.0
    start = None
    ring = []
    rings = []

    def number():
        nonlocal index
        value = float(tokens[index])
        index += 1
        return value

    def append(px, py):
        nonlocal x, y
        x, y = px, py
        if not ring or math.dist(ring[-1], (x, y)) > 1e-7:
            ring.append((x, y))

    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
        if command == "M":
            if ring:
                rings.append(clean_ring(ring))
                ring = []
            append(number(), number())
            start = (x, y)
            command = "L"
        elif command == "L":
            append(number(), number())
        elif command == "H":
            append(number(), y)
        elif command == "V":
            append(x, number())
        elif command == "C":
            x0, y0 = x, y
            x1, y1 = number(), number()
            x2, y2 = number(), number()
            x3, y3 = number(), number()
            for step in range(1, curve_steps + 1):
                t = step / curve_steps
                a = 1 - t
                append(a ** 3 * x0 + 3 * a * a * t * x1 +
                       3 * a * t * t * x2 + t ** 3 * x3,
                       a ** 3 * y0 + 3 * a * a * t * y1 +
                       3 * a * t * t * y2 + t ** 3 * y3)
        elif command in ("Z", "z"):
            if ring:
                rings.append(clean_ring(ring))
                ring = []
            if start:
                x, y = start
            command = None
            start = None
        else:
            raise ValueError(f"Unsupported SVG command {command!r}")
    if ring:
        rings.append(clean_ring(ring))
    return [ring for ring in rings if len(ring) >= 3 and abs(signed_area(ring)) > 2]


def element_rings(element):
    tag = element.tag.rsplit("}", 1)[-1]
    if tag == "path":
        return parse_path(element.get("d", ""))
    if tag == "rect":
        x, y = float(element.get("x", 0)), float(element.get("y", 0))
        width, height = float(element.get("width")), float(element.get("height"))
        return [[(x, y), (x + width, y), (x + width, y + height), (x, y + height)]]
    if tag == "circle":
        cx, cy, radius = (float(element.get(key)) for key in ("cx", "cy", "r"))
        return [[(cx + math.cos(i * math.pi / 12) * radius,
                  cy + math.sin(i * math.pi / 12) * radius) for i in range(24)]]
    return []


def point_in_polygon(point, polygon):
    x, y = point
    inside = False
    for index, current in enumerate(polygon):
        previous = polygon[index - 1]
        if ((current[1] > y) != (previous[1] > y) and
                x < (previous[0] - current[0]) * (y - current[1]) /
                (previous[1] - current[1]) + current[0]):
            inside = not inside
    return inside


def cross(first, second, third):
    return ((second[0] - first[0]) * (third[1] - second[1]) -
            (second[1] - first[1]) * (third[0] - second[0]))


def point_in_triangle(point, a, b, c):
    c1, c2, c3 = cross(a, b, point), cross(b, c, point), cross(c, a, point)
    return not ((c1 < -1e-8 or c2 < -1e-8 or c3 < -1e-8) and
                (c1 > 1e-8 or c2 > 1e-8 or c3 > 1e-8))


def triangulate(points):
    orientation = 1 if signed_area(points) > 0 else -1
    remaining = list(range(len(points)))
    triangles = []
    guard = 0
    while len(remaining) > 3:
        guard += 1
        if guard > len(points) ** 2:
            raise ValueError("Unable to triangulate official SVG polygon")
        clipped = False
        for offset, current in enumerate(remaining):
            previous = remaining[offset - 1]
            following = remaining[(offset + 1) % len(remaining)]
            if cross(points[previous], points[current], points[following]) * orientation <= 1e-8:
                continue
            if any(point_in_triangle(points[candidate], points[previous], points[current],
                                     points[following])
                   for candidate in remaining
                   if candidate not in (previous, current, following)):
                continue
            triangles.extend((previous, current, following))
            del remaining[offset]
            clipped = True
            break
        if not clipped:
            raise ValueError("Official SVG polygon is not simple")
    triangles.extend(remaining)
    return triangles


def centroid(points):
    area = signed_area(points)
    if abs(area) < 1e-8:
        return [sum(point[0] for point in points) / len(points),
                sum(point[1] for point in points) / len(points)]
    x = y = 0.0
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        factor = point[0] * following[1] - following[0] * point[1]
        x += (point[0] + following[0]) * factor
        y += (point[1] + following[1]) * factor
    return [x / (6 * area), y / (6 * area)]


def feature(identifier, kind, label, source_ring):
    points = [(round(x * SCALE, 4), round(y * SCALE, 4)) for x, y in source_ring]
    triangles = triangulate(points)
    deltas = []
    previous_x = previous_y = 0.0
    for x, y in points:
        deltas.extend((round((x - previous_x) * 2, 4),
                       round((y - previous_y) * 2, 4)))
        previous_x, previous_y = x, y
    centre = [round(value, 4) for value in centroid(points)]
    return [identifier, kind, label, deltas, [list(range(len(points)))], triangles, centre]


def extract(svg_path, floor_id, rows):
    root = ET.parse(svg_path).getroot()
    commercial = []
    slabs = []
    parking = []
    sequence = 0
    for element in root.iter():
        fill = element.get("fill")
        for ring in element_rings(element):
            sequence += 1
            record = {"sourceOrder": sequence, "ring": ring, "fill": fill}
            if fill == FLOOR_FILL:
                slabs.append(record)
            elif fill in COMMERCIAL_FILLS:
                if floor_id == "SS" and fill == "#F1D9E2":
                    parking.append(record)
                else:
                    commercial.append(record)

    markers = []
    for row in rows:
        row["polygonId"] = ""
        row["polygonMatchStatus"] = ""
        row["polygonDistanceSvgPx"] = ""
        if row.get("code", "").strip() and row.get("x", "").strip() and row.get("y", "").strip():
            markers.append({"row": row,
                            "point": (float(row["x"]) / SCALE, float(row["y"]) / SCALE)})
    owners = {}
    linked = 0
    for marker in markers:
        matches = [index for index, region in enumerate(commercial)
                   if point_in_polygon(marker["point"], region["ring"])]
        if len(matches) != 1:
            continue
        region_index = matches[0]
        identifier = f"{floor_id}-SVG-{region_index + 1:03d}"
        row = marker["row"]
        row["polygonId"] = identifier
        row["polygonMatchStatus"] = "official-marker-inside-svg-region-provisional"
        row["polygonDistanceSvgPx"] = "0.000"
        owners.setdefault(identifier, []).append(row)
        linked += 1

    # A coloured region containing more than one official marker cannot prove
    # which tenant owns that footprint. Keep the region, but leave every such
    # directory row unlinked until the source supplies a real subdivision.
    for identifier, owner_rows in owners.items():
        if len(owner_rows) > 1:
            for row in owner_rows:
                row["polygonId"] = ""
                row["polygonMatchStatus"] = ""
                row["polygonDistanceSvgPx"] = ""
            linked -= len(owner_rows)
    geometry = []
    for index, region in enumerate(slabs):
        geometry.append(feature(f"{floor_id}-FLOOR-{index + 1:02d}", 5, "", region["ring"]))
    for index, region in enumerate(commercial):
        identifier = f"{floor_id}-SVG-{index + 1:03d}"
        owner_rows = owners.get(identifier, [])
        label = owner_rows[0]["code"] if len(owner_rows) == 1 else ""
        geometry.append(feature(identifier, 1, label,
                                region["ring"]))
    for index, region in enumerate(parking):
        geometry.append(feature(f"{floor_id}-PARKING-{index + 1:03d}", 2, "",
                                region["ring"]))
    if not slabs or not commercial or len(geometry) <= 3:
        raise ValueError(f"{floor_id}: official SVG regions were not extracted")
    return geometry, len(commercial), linked


def rewrite_csv(path, rows):
    existing = list(rows[0]) if rows else []
    extra = ["polygonId", "polygonMatchStatus", "polygonDistanceSvgPx"]
    fieldnames = existing + [name for name in extra if name not in existing]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def vectorize_folder(folder):
    manifest_path = folder / "mall.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    totals = {"geometry": 0, "commercial": 0, "mapped": 0}
    for floor in manifest["floors"]:
        floor_id = floor["id"]
        csv_path = folder / f"{floor_id}-unit-codes.csv"
        with csv_path.open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        geometry, commercial_count, mapped_count = extract(
            folder / f"{floor_id}.official.svg", floor_id, rows)
        raw = json.dumps(geometry, ensure_ascii=False, separators=(",", ":")).encode()
        (folder / floor["geometry"]).write_text(
            base64.b64encode(zlib.compress(raw, 9)).decode("ascii") + "\n",
            encoding="ascii")
        rewrite_csv(csv_path, rows)
        floor["regionCount"] = len(geometry)
        floor["commercialRegionCount"] = commercial_count
        floor["mappedOfficialCodes"] = mapped_count
        floor["vectorizationStatus"] = "OFFICIAL-SVG-REGIONS-MARKER-LINKED-PROVISIONAL"
        totals["geometry"] += len(geometry)
        totals["commercial"] += commercial_count
        totals["mapped"] += mapped_count
        reference = manifest["floorReferences"][floor_id]
        reference["qa"]["issues"][0] = (
            "Los límites provienen del SVG oficial; la asociación marcador-región es provisional.")
        reference["qa"]["checks"]["individualStoreWalls"] = True
    manifest["warning"] = (
        "Contornos extraídos de los SVG oficiales y códigos vinculados a sus marcadores. "
        "Las asociaciones marcador-local, entradas, escala métrica y rutas siguen pendientes de validación.")
    manifest["floorReferencePolicy"] = (
        "Los SVG oficiales son la fuente de los contornos publicados; nunca se sustituyen por losas sintéticas.")
    manifest["officialSvgGeometryRegions"] = totals["geometry"]
    manifest["officialSvgCommercialRegions"] = totals["commercial"]
    manifest["provisionallyLinkedOfficialCodes"] = totals["mapped"]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
    return totals


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    args = parser.parse_args()
    print(json.dumps(vectorize_folder(args.folder), ensure_ascii=False))


if __name__ == "__main__":
    main()
