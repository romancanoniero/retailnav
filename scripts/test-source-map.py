"""Offline source/mesh evidence audit; no source IDs may become guessed photo joins."""
import base64
import copy
import hashlib
import json
import math
import re
import tempfile
from pathlib import Path

from source_map import attach_source_geometry

repo = Path(__file__).resolve().parents[1]
source_path = repo / 'data/official-maps/aventura.json'
source = json.loads(source_path.read_text())
mesh = json.loads((repo / 'data/official-maps/aventura-3d.json').read_text())
table = json.loads((repo / 'public/catalog/malls/aventura/stores.json').read_text())
catalog = json.loads(re.search(r'<script id="mallCatalog" type="application/json">([\s\S]+?)</script>',
                              (repo / 'public/index.html').read_text()).group(1))
mall = catalog['aventura']

assert source['schema'] == 'retailnav.source-map.v1'
assert source['mallId'] == mesh['mallId'] == table['mallId'] == 'aventura'
assert source['venueId'] == 107 and source['coordinateSpace'] == 'roveiq:107:wgs84'
assert mesh['schema'] == 'retailnav.source-mesh.v1'
assert mesh['sourceSha256'] == hashlib.sha256(source_path.read_bytes()).hexdigest()
assert mesh['coordinateSpace'] == mall['coordinateSpace'] == 'roveiq:107:local-decimeters-v1'
assert mall['sourceMapSha256'] == mesh['sourceSha256']
assert not source['routingVerified'] and not mall['navigable'] and not mall['indoorPositionCalibrated']
assert len(source['connectors']) == 17
assert sum(f['routingAudit']['segments'] for f in source['floors']) == 1224
assert sum(f['routingAudit']['missingDirection'] for f in source['floors']) == 1224
assert sum(f['routingAudit']['missingWidth'] for f in source['floors']) == 1224
assert mall['routingAudit']['verified'] is False
assert mall['routingAudit']['segments'] == 1224 and mall['routingAudit']['connectors'] == 17

assert mesh['projection'] == {'origin': [-80.14275, 25.95706],
                              'metersPerDegree': 111320, 'unitsPerMeter': 10}
assert mesh['origin'] == mall['origin'] == [0, 0]
assert mesh['scale'] == mall['scale'] == .025


def project(point):
    """Independent WGS84 -> local decimetres, quantized as the native compact format."""
    lon, lat = point
    origin_lon, origin_lat = mesh['projection']['origin']
    values = [(lon - origin_lon) * 111320 * math.cos(math.radians(origin_lat)) * 10,
              (origin_lat - lat) * 111320 * 10]
    # JavaScript Math.round rounds a half toward positive infinity, even below zero.
    return [math.floor(n * 2 + .5) / 2 for n in values]


def source_rings(feature):
    assert feature['geometry']['type'] == 'Polygon'
    rings = []
    for source_ring in feature['geometry']['coordinates']:
        points = []
        for raw in source_ring:
            point = project(raw)
            if not points or point != points[-1]:
                points.append(point)
        if points[0] == points[-1]:
            points.pop()
        assert len(points) >= 3
        rings.append(points)
    return rings


def decode(deltas):
    assert len(deltas) >= 6 and len(deltas) % 2 == 0
    assert all(isinstance(n, int) for n in deltas)
    x = y = 0
    points = []
    for dx, dy in zip(deltas[::2], deltas[1::2]):
        x, y = x + dx, y + dy
        points.append([x / 2, y / 2])
    return points


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def inside(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


source_floors = {f['id']: f for f in source['floors']}
assert [f[0] for f in mesh['floors']] == ['LL', 'UL', 'L3']
assert [(f['id'], f['sourceFloorId']) for f in source['floors']] == [('LL', 361), ('UL', 362), ('L3', 363)]
features = {}
shop_count = surface_count = hole_count = 0
for floor_id, _, _, polygons, walk in mesh['floors']:
    floor = source_floors[floor_id]
    expected = {feature['id']: (feature, 1) for feature in floor['features']}
    expected.update({'surface:' + feature['id']: (feature, 5) for feature in floor['surfaces']})
    assert len(expected) == len(polygons)
    assert {p[0] for p in polygons} == set(expected)
    assert all(byte == 0 for byte in base64.b64decode(walk['bits'])), 'No fabricated walking grid'
    for polygon in polygons:
        identifier, kind, _, deltas, indices, triangles, center = polygon
        original, expected_kind = expected[identifier]
        assert kind == expected_kind
        shop_count += kind == 1
        surface_count += kind == 5
        points = decode(deltas)
        rings = source_rings(original)
        assert len(indices) == len(rings)
        assert [points[i] for ring in indices for i in ring] == [p for ring in rings for p in ring]
        assert [i for ring in indices for i in ring] == list(range(len(points)))
        assert [[points[i] for i in ring] for ring in indices] == rings
        assert triangles and len(triangles) % 3 == 0
        assert all(isinstance(i, int) and 0 <= i < len(points) for i in triangles)
        expected_area = area(rings[0]) - sum(area(ring) for ring in rings[1:])
        assert expected_area > 0
        triangle_area = 0
        for offset in range(0, len(triangles), 3):
            triangle = [points[i] for i in triangles[offset:offset + 3]]
            triangle_area += area(triangle)
            if area(triangle) > 1e-8:
                midpoint = [sum(p[k] for p in triangle) / 3 for k in (0, 1)]
                assert inside(midpoint, rings[0]), (floor_id, identifier, 'triangle outside footprint')
                assert not any(inside(midpoint, ring) for ring in rings[1:]), (floor_id, identifier, 'hole filled')
        assert abs(triangle_area - expected_area) / expected_area < .00001, (floor_id, identifier)
        assert all(math.isfinite(n) for n in center)
        assert inside(center, rings[0]) and not any(inside(center, ring) for ring in rings[1:])
        hole_count += len(rings) - 1
        features[(floor_id, identifier)] = polygon
assert (shop_count, surface_count) == (607, 9)
assert hole_count >= 3, 'Keep the source interior holes; triangulation cannot fill atria'

for floor_id, floor in source_floors.items():
    assert mesh['circulation'][floor_id] == [[project(p) for p in line['coordinates']]
                                           for line in floor['circulation']]
    assert all(line['type'] == 'LineString' for line in floor['circulation'])
connector_pairs = {(c['id'], floor): c for c in source['connectors'] for floor in c['floors']}
assert len(mesh['connectors']) == len(connector_pairs) == 42
assert len({c['id'] for c in mesh['connectors']}) == 42
for connector in mesh['connectors']:
    original = connector_pairs[(connector['sourceConnectorId'], connector['floor'])]
    assert [connector['x'], connector['y']] == project([original['longitude'], original['latitude']])
    assert connector['id'] == 'source-connector:' + str(original['id']) + ':' + connector['floor']
    assert connector['source'] == 'official-map-connector' and not connector['routingVerified']
    assert connector['confidence'] == 'por-revisar'

# The native bundle uses the new local frame. The old photos and their vectors
# remain available together, but cannot accidentally highlight a current shop.
package = json.loads((repo / 'public' / mall['mapAsset']['url']).read_text())
assert package['floors'] == mesh['floors']
photo_path = repo / 'public' / mall['photoMapAsset']['url']
assert hashlib.sha256(photo_path.read_bytes()).hexdigest() == mall['photoMapAsset']['sha256']
photo_floors = json.loads(photo_path.read_text())
photo_polygons = {}
for floor in photo_floors:
    original = json.loads((repo / 'public/maps' / (floor[0] + '.json')).read_text())
    assert floor == [original['id'], original['name'], original['source'], original['geometry'], original['walkGrid']]
    photo_polygons.update({(floor[0], polygon[0]): polygon for polygon in floor[3]})
assert len(photo_polygons) == 235 and not set(photo_polygons).intersection(features)

records = table['records']
assert len(records) == 469 and mall['units'] == records
directory = [s for s in records if s['source'] == 'aventura-official-directory']
archived = [s for s in records if s['source'] != 'aventura-official-directory']
assert len(directory) == 338 and len(archived) == 131
assert sum(bool(s.get('sourceGeometry')) for s in directory) == 294
coffee = [s for s in records if 'food.coffee' in s.get('conceptIds', [])]
assert len(coffee) == 15 and sum(bool(s.get('sourceGeometry')) for s in coffee) == 11
assert len({s['storeId'] for s in records}) == len(records)
for store in records:
    assert store['mallId'] == 'aventura' and store['storeId'].startswith('aventura:')
    assert store['polygonId'] is None, 'Source bindings must never reuse the photo polygonId field'
    binding = store.get('sourceGeometry')
    if not binding:
        assert store['x'] is None and store['y'] is None
        continue
    assert store['source'] == 'aventura-official-directory' and not store.get('photoReference')
    assert binding['storeId'] == store['storeId'] and binding['mallId'] == 'aventura'
    assert binding['coordinateSpace'] == source['coordinateSpace']
    assert binding['sourceSha256'] == mesh['sourceSha256']
    assert binding['evidence'] == 'official-location-suite-and-polygon-id' and not binding['surveyVerified']
    assert store['coordinateSpace'] == mesh['coordinateSpace']
    location = next(l for l in source['locations'] if l['id'] == binding['locationId'])
    centers = []
    for p in binding['polygons']:
        floor = source_floors[p['floor']]
        feature = next(f for f in floor['features'] if f['id'] == p['polygonId'])
        assert feature['locationId'] == binding['locationId'] and p['polygonId'] in location['suiteIds']
        assert p['sourceFloorId'] == floor['sourceFloorId'] and p['datasetId'] == floor['datasetId']
        if p['floor'] == store['floor']:
            centers.append(features[(p['floor'], p['polygonId'])][6])
    assert [store['x'], store['y']] in centers
for store in archived:
    assert store['activeMap'] is False and not store.get('sourceGeometry')
    old = store['photoReference']
    assert (old['floor'], old['polygonId']) in photo_polygons
    assert [old['x'], old['y']] == photo_polygons[(old['floor'], old['polygonId'])][6]

# Negative join cases prove that an ID, a matching name, or one half of the
# source suite relationship alone is insufficient evidence.
wrong = {'source': 'aventura-official-directory', 'name': 'Starbucks',
         'officialMapLocationId': '20680', 'storeId': 'aventura:directory:starbucks'}
attach_source_geometry(repo, 'aventura', [wrong])
assert not wrong.get('sourceGeometry')
joe = next(s for s in directory if s.get('officialMapLocationId') == '20680')
for mutation in ('duplicate-location-name', 'missing-suite-membership', 'conflicting-location-id'):
    fixture = copy.deepcopy(source)
    candidate = {k: v for k, v in joe.items() if k != 'sourceGeometry'}
    location = next(l for l in fixture['locations'] if l['id'] == '20680')
    if mutation == 'duplicate-location-name':
        candidate.pop('officialMapLocationId')
        fixture['locations'].append({**location, 'id': 'ambiguous-location'})
    elif mutation == 'missing-suite-membership':
        location['suiteIds'] = []
    else:
        for floor in fixture['floors']:
            for feature in floor['features']:
                if feature['locationId'] == '20680':
                    feature['locationId'] = 'conflicting-location'
    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary) / 'data/official-maps'
        folder.mkdir(parents=True)
        (folder / 'aventura.json').write_text(json.dumps(fixture))
        attach_source_geometry(Path(temporary), 'aventura', [candidate])
    assert not candidate.get('sourceGeometry'), mutation

print('PASS native 3D: 607 source shop meshes + 9 surfaces; exact projection, holes, triangles and interior centers')
print('PASS 294 source bindings (11 Coffee), 131 isolated photo references, 1224 unverified segments and 17 connectors')
