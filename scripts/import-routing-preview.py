#!/usr/bin/env python3
"""Compile conservative same-floor previews from the pinned public source map.

Usage: python3 scripts/import-routing-preview.py /path/to/original-map.json
The raw download must match data/official-maps/aventura.json's recorded SHA256.
No nearest-neighbour bridges, inferred doors, inter-floor links, or walkable grid
are created. Even retained source segments remain an unverified preview.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / 'data/official-maps/aventura.json'
OUTPUT = ROOT / 'data/official-maps/aventura-routing-preview.json'
ORIGIN = (-80.14275, 25.95706)
TOLERANCE_METERS = .15
EPS = 1e-7


def project(p):
    return ((p[0] - ORIGIN[0]) * 111320 * math.cos(math.radians(ORIGIN[1])),
            (ORIGIN[1] - p[1]) * 111320)


def dm(p):
    return [round(x * 10, 8) for x in p]


def inside_ring(p, ring):
    x, y = p
    result = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


def inside(p, rings):
    return inside_ring(p, rings[0]) and not any(inside_ring(p, r) for r in rings[1:])


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def boundaries(a, b, rings):
    r = (b[0] - a[0], b[1] - a[1])
    ts = [0., 1.]
    for ring in rings:
        for c, d in zip(ring, ring[1:] + ring[:1]):
            s = (d[0] - c[0], d[1] - c[1])
            den = cross(r, s)
            if abs(den) < EPS:
                continue
            ca = (c[0] - a[0], c[1] - a[1])
            t, u = cross(ca, s) / den, cross(ca, r) / den
            if 0 <= t <= 1 and 0 <= u <= 1:
                ts.append(t)
    return ts


def at(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def polygon(feature):
    assert feature['geometry']['type'] == 'Polygon', feature['id']
    rings = [[project(p) for p in r] for r in feature['geometry']['coordinates']]
    points = rings[0]
    bbox = (min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points))
    return {'id': feature['id'], 'rings': rings, 'bbox': bbox}


def hit_bbox(a, b, bbox):
    return not (max(a[0], b[0]) < bbox[0] or min(a[0], b[0]) > bbox[2]
                or max(a[1], b[1]) < bbox[1] or min(a[1], b[1]) > bbox[3])


def blocked_intervals(a, b, obstacles, surfaces):
    local = [p for p in obstacles if hit_bbox(a, b, p['bbox'])]
    local_surfaces = [p for p in surfaces if hit_bbox(a, b, p['bbox'])]
    ts = sorted(set(t for p in local + local_surfaces for t in boundaries(a, b, p['rings'])) | {0., 1.})
    result = []
    for lo, hi in zip(ts, ts[1:]):
        if (hi - lo) * math.dist(a, b) < EPS:
            continue
        point = at(a, b, (lo + hi) / 2)
        hits = [p['id'] for p in local if inside(point, p['rings'])]
        if not any(inside(point, p['rings']) for p in local_surfaces):
            hits.append('outside-source-floor-surface')
        if hits:
            result.append((lo, hi, hits))
    return result


def nearest(p, a, b):
    length2 = sum((b[i] - a[i]) ** 2 for i in (0, 1))
    t = max(0., min(1., sum((p[i] - a[i]) * (b[i] - a[i]) for i in (0, 1)) / length2)) if length2 else 0.
    return math.dist(p, at(a, b, t)), t


def compile_floor(floor, snapshot_floor, suites):
    obstacles = [polygon(f) for f in floor['structures_dataset']['data']['features']]
    unit_ids = {p['id'] for p in obstacles}
    units_by_id = {p['id']: p for p in obstacles}
    grass_ids = set()
    surfaces = []
    for dataset in floor['style_dataset']:
        title = dataset['title'].lower()
        for feature in dataset['data']['features']:
            if 'wall' in title or 'grass' in title:
                obstacles.append(polygon(feature))
                if 'grass' in title:
                    grass_ids.add(feature['id'])
            if feature.get('properties', {}).get('class') == 'noclick-floor':
                surfaces.append(polygon(feature))
    assert surfaces, 'No source floor surface'
    nodes, node_ids = [], {}
    edges, raw_edges = [], []

    def node(point):
        if point not in node_ids:
            node_ids[point] = len(nodes)
            nodes.append(dm(point))
        return node_ids[point]

    for feature in floor['routing_dataset']['data']['features']:
        assert feature['geometry']['type'] == 'LineString'
        coords = feature['geometry']['coordinates']
        for i, (a, b) in enumerate(zip(coords, coords[1:])):
            a, b = project(a), project(b)
            if math.dist(a, b) < EPS:
                continue
            blocked = blocked_intervals(a, b, obstacles, surfaces)
            eid = feature['id'] + ':' + str(i)
            raw_edges.append({'a': a, 'b': b, 'id': eid, 'blocked': blocked})
            if not blocked:
                edges.append([node(a), node(b), eid])

    terminals = []
    unconnected_entrances = 0
    for feature in snapshot_floor['features']:
        suite = suites.get(feature['id'])
        if not suite:
            continue
        for entrance_index, entrance in enumerate(suite.get('settings', {}).get('entrances', [])):
            if floor['id'] not in entrance.get('floor_ids', []):
                continue
            point = project((entrance['lng'], entrance['lat']))
            own_polygon = units_by_id[feature['id']]
            boundary_distance = min(nearest(point, a, b)[0] for ring in own_polygon['rings']
                                    for a, b in zip(ring, ring[1:] + ring[:1]))
            if not inside(point, own_polygon['rings']) and boundary_distance > TOLERANCE_METERS:
                unconnected_entrances += 1
                continue
            candidates = [(nearest(point, e['a'], e['b'])[0], e, nearest(point, e['a'], e['b'])[1]) for e in raw_edges]
            distance, edge, entrance_t = min(candidates, key=lambda item: item[0])
            if distance > TOLERANCE_METERS:
                unconnected_entrances += 1
                continue
            # Only the recorded source access segment may approach this store.
            # Stop on that segment before its first obstacle; no line to the door.
            for start_t, endpoint in [(0., edge['a']), (1., edge['b'])]:
                if endpoint not in node_ids:
                    continue
                lo, hi = sorted((start_t, entrance_t))
                blocked = [(max(a, lo), min(b, hi), hits) for a, b, hits in edge['blocked']
                           if b > lo + EPS and a < hi - EPS]
                # A source access which first crosses another store, grass or
                # a gap outside the source floor is not this store's frontage.
                forbidden_ids = (unit_ids - {feature['id']}) | grass_ids | {'outside-source-floor-surface'}
                if any(forbidden_ids.intersection(hits) for _, _, hits in blocked):
                    continue
                obstruction = [(a, b) for a, b, _ in blocked]
                if obstruction:
                    # The first wall must form one continuous obstacle region
                    # with the destination. Never label an unrelated barrier
                    # farther along an access segment as the store's frontage.
                    if not any(feature['id'] in hits for _, _, hits in blocked):
                        continue
                    merged = sorted(obstruction)
                    if any(merged[i + 1][0] - merged[i][1] > EPS for i in range(len(merged) - 1)):
                        continue
                    cutoff = min(a for a, _ in obstruction) if start_t == 0 else max(b for _, b in obstruction)
                    # A small source-line setback keeps the rendered dot off the wall.
                    setback_t = .20 / math.dist(edge['a'], edge['b'])
                    end_t = max(0., cutoff - setback_t) if start_t == 0 else min(1., cutoff + setback_t)
                else:
                    if boundary_distance > TOLERANCE_METERS:
                        continue
                    end_t = entrance_t
                end = at(edge['a'], edge['b'], end_t)
                if blocked_intervals(endpoint, end, obstacles, surfaces):
                    continue
                # If the obstruction starts at the network node, there is no
                # source-supported approach from this end of the access segment.
                if math.dist(endpoint, end) < EPS and abs(start_t - entrance_t) > EPS:
                    continue
                terminals.append({'polygonId': feature['id'], 'locationId': feature.get('locationId'),
                                  'node': node_ids[endpoint], 'point': dm(end),
                                  'entrance': dm(point), 'entranceIndex': entrance_index,
                                  'sourceSegmentId': edge['id'], 'sourceEntranceOffsetMeters': round(distance, 6),
                                  'stopsBeforeObstacle': bool(obstruction)})
    return {'id': snapshot_floor['id'], 'sourceFloorId': floor['id'], 'nodes': nodes, 'edges': edges,
            'terminals': terminals, 'audit': {'sourceSegments': len(raw_edges), 'retainedSegments': len(edges),
                                            'excludedSegments': len(raw_edges) - len(edges),
                                            'obstaclePolygons': len(obstacles),
                                            'sourceFloorSurfaces': len(surfaces),
                                            'unconnectedEntrances': unconnected_entrances}}


def main():
    source = json.loads(SNAPSHOT.read_text())
    raw = Path(sys.argv[1]).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == source['sources']['map']['sha256'], 'Source hash does not match the pinned official map'
    doc = json.loads(raw)
    floors = {f['sourceFloorId']: f for f in source['floors']}
    suites = {s['suite_id']: s for s in doc['map_suites']}
    result = {'schema': 'retailnav.routing-preview.v1', 'mallId': 'aventura',
              'coordinateSpace': 'roveiq:107:local-decimeters-v1', 'routingVerified': False,
              'source': {'url': source['sources']['map']['url'], 'sha256': digest},
              'projection': {'origin': list(ORIGIN), 'metersPerDegree': 111320, 'unitsPerMeter': 10},
              'originToleranceMeters': TOLERANCE_METERS,
              'policy': 'same-source-segments-only; no local/wall/grass crossings; no off-surface segments; no gap bridges; stop before source obstacles',
              'floors': [compile_floor(f, floors[f['id']], suites) for f in doc['floors']]}
    OUTPUT.write_text(json.dumps(result, separators=(',', ':'), ensure_ascii=False) + '\n')
    print(json.dumps({f['id']: {**f['audit'], 'terminals': len(f['terminals'])} for f in result['floors']}, indent=2))


if __name__ == '__main__':
    main()
