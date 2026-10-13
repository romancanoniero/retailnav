"""Attach codes read from a mall's floor guide to provisional polygons.

A code is linked to geometry only when its text position is contained in exactly
one polygon. Ambiguous labels are preserved for search without fictitious tenancy.
"""
import csv
from pathlib import Path

def inside(point, feature):
    x = y = 0
    points = []
    for dx, dy in zip(feature[3][::2], feature[3][1::2]):
        x += dx
        y += dy
        points.append((x / 2, y / 2))
    px, py = point
    flag = False
    for i, a in enumerate(points):
        b = points[(i + 1) % len(points)]
        if (a[1] > py) != (b[1] > py):
            if px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]:
                flag = not flag
    return flag

def attach(folder, level, geometry):
    file = Path(folder) / (level + "-unit-codes.csv")
    if not file.exists():
        return []
    labels = []
    owners = {}
    with file.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            code = row["code"].strip()
            at = (float(row["x"]), float(row["y"]))
            matches = [f[0] for f in geometry if inside(at, f)]
            polygon_id = matches[0] if len(matches) == 1 else None
            label = {"code": code, "name": row.get("name", "").strip(),
                "floor": level, "x": at[0], "y": at[1],
                "polygonId": polygon_id,
                "source": row.get("source", "unknown"),
                "relation": "inside-one-component" if polygon_id else "pending"}
            labels.append(label)
            if polygon_id:
                owners.setdefault(polygon_id, []).append(label)
    for feature in geometry:
        matches = owners.get(feature[0], [])
        if len(matches) == 1 and not feature[2]:
            feature[2] = matches[0]["name"] or matches[0]["code"]
    return labels
