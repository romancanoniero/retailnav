#!/usr/bin/env python3
"""Conservatively refine traced mall-store curves against registered full-size photos.

Stable feature IDs and existing store labels are retained. Real image edges add
vertices where legacy perimeter-relative simplification flattened curved walls.
A mismatch or invalid triangulation keeps the old shape, flagged for review.

Needs: numpy, opencv-python-headless, shapely >= 2.1
Usage:
 python scripts/refine_curved_floor.py --source B1.png --geometry B1.geometry.v2.zlib.b64 \
   --output B1.geometry.v3.zlib.b64 --report B1.curve-review.json --preview B1.curve-preview.jpg
"""
import argparse
import base64
import hashlib
import json
import zlib
from pathlib import Path

import cv2
import numpy as np
from shapely import make_valid, constrained_delaunay_triangles
from shapely.geometry import Polygon


def decode_shape(entry):
    x = y = 0
    points = []
    for dx, dy in zip(entry[3][::2], entry[3][1::2]):
        x += dx
        y += dy
        points.append((x / 2, y / 2))
    return np.asarray(points, dtype=np.float64)


def best_component_contours(image):
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    colour = np.uint8((hsv[:, :, 1] > 25) & (hsv[:, :, 2] > 65)) * 255
    background = cv2.GaussianBlur(gray, (0, 0), 5)
    dark = np.uint8(cv2.subtract(background, gray) > 20) * 255
    horizontal = cv2.morphologyEx(dark, cv2.MORPH_OPEN,
                                   np.ones((1, 9), np.uint8))
    vertical = cv2.morphologyEx(dark, cv2.MORPH_OPEN,
                                 np.ones((9, 1), np.uint8))
    border = cv2.dilate(cv2.bitwise_or(horizontal, vertical),
                        np.ones((2, 2), np.uint8), iterations=1)
    mask = cv2.bitwise_and(colour, cv2.bitwise_not(border))
    mask[:5] = mask[-5:] = 0
    mask[:, :5] = mask[:, -5:] = 0
    return cv2.connectedComponentsWithStats(mask, 8)


def triangulate_clean(polygon):
    points = np.asarray(polygon, dtype=np.float64).reshape(-1, 2)
    if len(points) < 3 or len(points) > 180:
        return None
    shape = Polygon(points)
    if not shape.is_valid:
        fixed = make_valid(shape)
        polys = ([fixed] if fixed.geom_type == 'Polygon' else
                 [part for part in getattr(fixed, 'geoms', [])
                  if part.geom_type == 'Polygon'])
        if not polys:
            return None
        shape = max(polys, key=lambda p: p.area)
        points = np.rint(np.asarray(shape.exterior.coords[:-1])).astype('int32')
        shape = Polygon(points)
    if not shape.is_valid or shape.area < 5 or len(points) > 180:
        return None
    lookup = {tuple(map(int, p)): i for i, p in enumerate(points)}
    indices = []
    for t in constrained_delaunay_triangles(shape).geoms:
        piece = []
        for pt in list(t.exterior.coords)[:3]:
            index = lookup.get(tuple(map(int, pt)))
            if index is None:
                return None
            piece.append(index)
        if len(set(piece)) == 3:
            indices.extend(piece)
    if not indices:
        return None
    return points.astype('int32'), indices


def as_feature(existing, vertices, triangles):
    result = list(existing)
    delta = []
    lastx = lasty = 0
    for px, py in vertices:
        x, y = int(round(px * 2)), int(round(py * 2))
        delta.extend((x - lastx, y - lasty))
        lastx, lasty = x, y
    result[3] = delta
    result[4] = [list(range(len(vertices)))]
    result[5] = triangles
    # Preserve the original label centroid and id so imported store codes
    # remain in the same geographic reference even when walls are refined.
    return result


def refine(source_image, features, max_error_px=1.25,
           minimum_iou=.65, area_ratio_min=.74, area_ratio_max=1.48):
    height, width = source_image.shape[:2]
    _, labels, _, _ = best_component_contours(source_image)
    results, notes, matched_ids = [], [], set()
    for feature in features:
        old = decode_shape(feature)
        mask = np.zeros((height, width), np.uint8)
        cv2.fillPoly(mask, [old.astype('int32')], 255)
        values = labels[mask > 0]
        labels_inside, counts = np.unique(values[values > 0], return_counts=True)
        if not len(labels_inside):
            results.append(feature)
            notes.append({'id': feature[0], 'status': 'unmatched'});
            continue
        component = int(labels_inside[np.argmax(counts)])
        if component in matched_ids:
            results.append(feature)
            notes.append({'id': feature[0], 'status': 'ambiguous-shared-component'})
            continue
        matched_ids.add(component)
        contours, _ = cv2.findContours(
            np.uint8(labels == component) * 255,
            cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            results.append(feature)
            notes.append({'id': feature[0], 'status': 'no-contour'})
            continue
        trace = max(contours, key=cv2.contourArea)
        candidate = None
        for epsilon in [max_error_px, max_error_px * 1.2,
                        max_error_px * 1.5, max_error_px * 1.9]:
            approximation = cv2.approxPolyDP(trace, epsilon, True)[:, 0, :]
            fitted = triangulate_clean(approximation)
            if fitted is not None:
                candidate = (fitted[0], fitted[1], epsilon)
                break
        if candidate is None:
            results.append(feature)
            notes.append({'id': feature[0], 'status': 'triangulation-uncertain'})
            continue
        polygon, triangles, epsilon = candidate
        overlay = np.zeros_like(mask)
        cv2.fillPoly(overlay, [polygon.astype('int32')], 255)
        union = np.count_nonzero((mask > 0) | (overlay > 0))
        intersection = np.count_nonzero((mask > 0) & (overlay > 0))
        iou = intersection / max(1, union)
        area_ratio = cv2.contourArea(polygon.astype('float32')) / max(
            1, cv2.contourArea(old.astype('float32')))
        if not (minimum_iou <= iou and
                area_ratio_min <= area_ratio <= area_ratio_max):
            results.append(feature)
            notes.append({'id': feature[0], 'status': 'photo-mismatch',
                          'iou': round(iou, 3),
                          'areaRatio': round(area_ratio, 3)})
            continue
        updated = as_feature(feature, polygon, triangles)
        results.append(updated)
        notes.append({'id': feature[0], 'status': 'refined-provisionally',
                      'oldVertices': len(old), 'newVertices': len(polygon),
                      'iou': round(iou, 3),
                      'areaRatio': round(area_ratio, 3),
                      'maxCurveErrorPx': round(epsilon, 3)})
    return results, notes


def read_geometry(path):
    return json.loads(zlib.decompress(base64.b64decode(
        Path(path).read_text(encoding='ascii'))))


def write_geometry(path, features):
    payload = json.dumps(features, ensure_ascii=False,
                         separators=(',', ':')).encode('utf8')
    Path(path).write_text(base64.b64encode(zlib.compress(payload, 9))
                          .decode('ascii') + '\n', encoding='ascii')
    return hashlib.sha256(payload).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source', required=True)
    ap.add_argument('--geometry', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--report', required=True)
    ap.add_argument('--preview', required=True)
    ap.add_argument('--max-curve-error-px', type=float, default=1.25)
    args = ap.parse_args()
    if not .4 <= args.max_curve_error_px <= 3:
        ap.error('Curve error must be between 0.4 and 3 source-image pixels')
    image = cv2.imread(args.source)
    if image is None:
        ap.error('Cannot read full-size reference image')
    original = read_geometry(args.geometry)
    refined, notes = refine(image, original, args.max_curve_error_px)
    digest = write_geometry(args.output, refined)
    rendered = image.copy()
    for item in refined:
        pts = decode_shape(item).astype('int32')
        cv2.polylines(rendered, [pts], True, (14, 235, 31), 1, cv2.LINE_AA)
    cv2.imwrite(args.preview, rendered)
    report = {
        'schema': 'retailnav.curve-refinement-review.v1',
        'sourceSHA256': hashlib.sha256(Path(args.source).read_bytes()).hexdigest(),
        'geometrySHA256': digest,
        'featuresBefore': len(original), 'featuresAfter': len(refined),
        'verticesBefore': sum(len(f[3]) // 2 for f in original),
        'verticesAfter': sum(len(f[3]) // 2 for f in refined),
        'curvedRegionsEnriched': sum(r['status'] == 'refined-provisionally'
                                    and r['newVertices'] > r['oldVertices'] + 3
                                    for r in notes),
        'unresolvedRegions': sum(r['status'] != 'refined-provisionally'
                                 for r in notes),
        'qa': 'provisional-human-review-required',
        'aiReview': 'not-executed-by-this-geometric-step',
        'regions': notes
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False,
                                           indent=2) + '\n', encoding='utf8')
    print(json.dumps({k: v for k, v in report.items() if k != 'regions'}, indent=2))


if __name__ == '__main__':
    main()