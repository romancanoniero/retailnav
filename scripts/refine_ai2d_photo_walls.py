#!/usr/bin/env python3
"""Conservative photo-supported correction of a VISUAL 2D calque.

Input polygons are candidate geometry extracted from a visual AI tracing.
This code does NOT run a vision model or certify navigation geometry.
A split is only proposed when a corresponding ink seam exists in the
UNEDITED reference photograph, separates known code anchors, and
preserves all original anchor records without overlaps.

Example:
  python scripts/refine_ai2d_photo_walls.py --photo public/reference/ap-plaza/B1.webp \
    --input B1.ai2d.candidates.geojson --output B1.ai2d.photo-refined.geojson \
    --review B1.ai2d.photo-refined.review.json
"""
import argparse
import base64
import zlib
import hashlib
import json
from copy import deepcopy
from pathlib import Path

import cv2
import numpy as np
from shapely import contains_xy
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import split, unary_union


def wall_images(photo):
    gray = cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY)
    # Black-hat is oriented perpendicular to each candidate seam; this
    # prevents counting a uniformly dark pink shop fill as a black wall.
    return {
        "h": cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT,
                             np.ones((11, 1), np.uint8)),
        "v": cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT,
                             np.ones((1, 11), np.uint8)),
    }


def distribute_anchors(polygons, anchors, tolerance=1.01):
    """Every label must have one unique owner, including near-edge labels."""
    groups = [[] for _ in polygons]
    for anchor in anchors:
        point = Point(float(anchor["x"]), float(anchor["y"]))
        distances = [p.distance(point) for p in polygons]
        smallest = min(distances)
        owners = [i for i, distance in enumerate(distances)
                  if abs(distance - smallest) < .03]
        if smallest > tolerance or len(owners) != 1:
            return None
        groups[owners[0]].append(anchor)
    return groups


def possible_seams(anchors, bounds):
    for orientation, key, low, high in [
        ("h", "y", bounds[1], bounds[3]),
        ("v", "x", bounds[0], bounds[2]),
    ]:
        coordinates = sorted(set(round(float(a[key]), 2) for a in anchors))
        clusters = []
        for coordinate in coordinates:
            if clusters and coordinate - clusters[-1][-1] < 9:
                clusters[-1].append(coordinate)
            else:
                clusters.append([coordinate])
        means = [sum(c) / len(c) for c in clusters]
        for left, right in zip(means, means[1:]):
            if right - left < 10:
                continue
            midpoint = (left + right) / 2
            start = max(int(np.ceil(left + 3)),
                        int(np.floor(midpoint - 8)), int(low + 4))
            stop = min(int(np.floor(right - 3)),
                       int(np.ceil(midpoint + 8)), int(high - 4))
            if start <= stop:
                yield orientation, (left, right), range(start, stop + 1)


def wall_score(polygon, ink, orientation, position):
    x0, y0, x1, y1 = map(int, polygon.bounds)
    if orientation == "h":
        if not y0 + 3 < position < y1 - 3:
            return None
        xs = np.arange(x0 + 3, x1 - 3)
        ys = np.full_like(xs, position)
    else:
        if not x0 + 3 < position < x1 - 3:
            return None
        ys = np.arange(y0 + 3, y1 - 3)
        xs = np.full_like(ys, position)
    if len(xs) < 10:
        return None
    inside = contains_xy(polygon, xs + .5, ys + .5)
    xs, ys = xs[inside], ys[inside]
    if len(xs) < 10:
        return None
    samples = ink[ys, xs]
    is_ink = samples >= 26
    longest = current = 0
    for present in is_ink:
        current = current + 1 if present else 0
        longest = max(longest, current)
    return {"support": round(float(is_ink.mean()), 4),
            "run": int(longest), "length": int(len(xs))}


def best_photo_division(polygon, anchors, walls, min_support=.51):
    if len(anchors) < 2:
        return None
    best = None
    x0, y0, x1, y1 = polygon.bounds
    for orientation, anchor_span, locations in possible_seams(anchors, polygon.bounds):
        for position in locations:
            ink = wall_score(polygon, walls[orientation], orientation, position)
            if not ink or ink["support"] < min_support:
                continue
            if ink["run"] < max(4, .25 * ink["length"]):
                continue
            line = (LineString([(x0 - 2, position), (x1 + 2, position)])
                    if orientation == "h" else
                    LineString([(position, y0 - 2), (position, y1 + 2)]))
            parts = [part for part in split(polygon, line).geoms
                     if isinstance(part, Polygon) and part.area > 25]
            if len(parts) != 2 or min(p.area for p in parts) < 40:
                continue
            groups = distribute_anchors(parts, anchors)
            if groups is None or not all(groups):
                continue
            if max(map(len, groups)) >= len(anchors):
                continue
            if abs(sum(p.area for p in parts) - polygon.area) > 1e-4:
                continue
            quality = (ink["support"] + .08 * ink["run"] / ink["length"]
                       - .002 * abs(position - sum(anchor_span) / 2))
            if best is None or quality > best["quality"]:
                best = {"orientation": orientation, "position": int(position),
                        "photoInkEvidence": ink, "parts": parts, "groups": groups,
                        "quality": quality}
    return best


def refine_collection(collection, photo, photo_sha, min_support=.51):
    walls = wall_images(photo)
    new_features = []
    divisions = []
    unresolved = []
    for original in collection["features"]:
        props = original["properties"]
        polygon = shape(original["geometry"])
        anchors = [a for a in props.get("codeCandidates", [])
                   if a.get("code") != "TOYcPLAY"]
        if not polygon.is_valid or len(anchors) < 2:
            new_features.append(original)
            continue
        pending = [(polygon, anchors, [])]
        finished = []
        changes = 0
        while pending:
            current, labels, history = pending.pop(0)
            div = (best_photo_division(current, labels, walls, min_support)
                   if changes < 8 else None)
            if div is None:
                finished.append((current, labels, history))
                continue
            changes += 1
            evidence = {"parentID": props["id"],
                        "orientation": div["orientation"],
                        "position": div["position"],
                        "photoInkEvidence": div["photoInkEvidence"],
                        "anchorGroups": [[a["code"] for a in group]
                                         for group in div["groups"]]}
            divisions.append(evidence)
            for part, group in zip(div["parts"], div["groups"]):
                pending.append((part, group, history + [evidence]))
        if not changes:
            new_features.append(original)
            unresolved.append({"id": props["id"],
                               "codes": [a["code"] for a in anchors],
                               "reason": "insufficient original-photo wall evidence"})
            continue
        for index, (geometry, labels, history) in enumerate(
                sorted(finished, key=lambda row: (row[0].centroid.y, row[0].centroid.x)), 1):
            record = deepcopy(props)
            record["parentRegionId"] = props["id"]
            record["id"] = f'{props["id"]}-P{index:02d}'
            record["codeCandidates"] = labels
            # An anchor merely *near* a boundary is not a confirmed code.
            confirmed = (len(labels) == 1 and
                         labels[0].get("association") == "inside" and
                         geometry.distance(Point(labels[0]["x"], labels[0]["y"])) < .01)
            record["storeCode"] = labels[0]["code"] if confirmed else None
            record["storeCodeTentative"] = (labels[0]["code"]
                                            if len(labels) == 1 and not confirmed else None)
            record["storeName"] = labels[0].get("name") if len(labels) == 1 else None
            record["areaPx2"] = round(geometry.area, 1)
            record["status"] = "CANDIDATE-PHOTO-SUPPORTED-NOT-APPROVED"
            record["photoReviewedWalls"] = history
            record["issue"] = "Photo-supported division awaiting human approval"
            new_features.append({"type": "Feature", "properties": record,
                                 "geometry": mapping(geometry)})
    before = sum(len(f["properties"].get("codeCandidates", []))
                 for f in collection["features"])
    after = sum(len(f["properties"].get("codeCandidates", []))
                for f in new_features)
    if before != after:
        raise AssertionError("A source label was lost during geometry refinement")
    polygons = [shape(f["geometry"]) for f in new_features]
    if any(not p.is_valid or p.area <= 0 for p in polygons):
        raise AssertionError("Invalid output geometry")
    overlap = sum(p.area for p in polygons) - unary_union(polygons).area
    if overlap > 2:
        raise AssertionError(f"Overlapping geometry: {overlap:.3f} square pixels")
    result = deepcopy(collection)
    result["features"] = new_features
    result.setdefault("metadata", {})["status"] = "PROVISIONAL-NO-NAVIGATION"
    result["metadata"]["photoCheckedRefinement"] = "v2-experimental"
    report = {
        "schema": "retailnav.ai2d-photo-wall-review.v2",
        "status": "PROVISIONAL-NO-NAVIGATION",
        "photoSHA256": photo_sha,
        "featuresBefore": len(collection["features"]),
        "featuresAfter": len(new_features),
        "sourceAnchorsBefore": before, "sourceAnchorsAfter": after,
        "codesBefore": sum(bool(f["properties"].get("storeCode"))
                           for f in collection["features"]),
        "codesAfter": sum(bool(f["properties"].get("storeCode")) for f in new_features),
        "splits": divisions, "unresolved": unresolved,
        "polygonOverlapPx2": round(overlap, 3),
        "photographicApproved": False, "publishAllowed": False,
    }
    return result, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--photo", required=True)
    parser.add_argument("--input", required=True, help="Experimental AI2D candidate GeoJSON")
    parser.add_argument("--output", required=True)
    parser.add_argument("--review", required=True)
    parser.add_argument("--min-support", type=float, default=.51)
    args = parser.parse_args()
    if not .45 <= args.min_support <= .90:
        parser.error("min-support must be between 0.45 and 0.90")
    photo_bytes = Path(args.photo).read_bytes()
    photo = cv2.imdecode(np.frombuffer(photo_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if photo is None:
        parser.error("Cannot decode reference photograph")
    input_text = Path(args.input).read_text(encoding="utf8").strip()
    if args.input.endswith(".zlib.b64"):
        input_text = zlib.decompress(base64.b64decode(input_text)).decode("utf8")
    collection = json.loads(input_text)
    source_hash = hashlib.sha256(photo_bytes).hexdigest()
    expected_hash = collection.get("metadata", {}).get("photoSHA256")
    if expected_hash and source_hash != expected_hash:
        parser.error("Photo does not match candidate geometry sourceSHA256")
    out, report = refine_collection(collection, photo, source_hash, args.min_support)
    output_text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    if args.output.endswith(".zlib.b64"):
        output_text = base64.b64encode(zlib.compress(output_text.encode("utf8"), 9)).decode("ascii")
    Path(args.output).write_text(output_text + "\n", encoding="utf8")
    Path(args.review).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                 encoding="utf8")
    print(json.dumps({key: value for key, value in report.items()
                      if not isinstance(value, list)}, indent=2))


if __name__ == "__main__":
    main()
