"""Embed nine unverified New World City photo-vector floors in the main RetailNav viewer.

This is a photo-derived demonstration, not surveyed navigable geometry.
Historical 7-floor data/malls/ assets are intentionally preserved unchanged.
"""
import base64
import hashlib
import json
import re
import zlib
from collections import defaultdict
from pathlib import Path


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def in_triangle(p, a, b, c):
    return (cross(a, b, p) >= -1e-9 and cross(b, c, p) >= -1e-9 and
            cross(c, a, p) >= -1e-9)


def triangulate(points):
    """Ear-clip simple, concave polygons in stdlib, preserving every source vertex."""
    n = len(points)
    if n < 3 or len(set(map(tuple, points))) != n:
        raise ValueError('Invalid or duplicate photo vertices')
    area2 = sum(p[0]*q[1] - p[1]*q[0]
                for p, q in zip(points, points[1:]+points[:1]))
    if abs(area2) < 1e-9:
        raise ValueError('Zero-area photo region')
    pending = list(range(n)) if area2 > 0 else list(range(n-1, -1, -1))
    indices = []
    while len(pending) > 3:
        for i in range(len(pending)):
            a, b, c = pending[i-1], pending[i], pending[(i+1) % len(pending)]
            if cross(points[a], points[b], points[c]) <= 1e-9:
                continue
            if any(in_triangle(points[j], points[a], points[b], points[c])
                   for j in pending if j not in (a, b, c)):
                continue
            indices.extend((a, b, c))
            pending.pop(i)
            break
        else:
            raise ValueError('Cannot triangulate photo region')
    indices.extend(pending)
    return indices


def load_demo(repo):
    path = Path(repo) / 'public/newworld9/data.js'
    text = path.read_text(encoding='utf-8').strip()
    match = re.fullmatch(r'window\.__NWC9_MODEL_B64="([A-Za-z0-9+/=]+)";', text)
    if not match:
        raise ValueError('Unexpected nine-floor demo data format')
    model = json.loads(zlib.decompress(base64.b64decode(match.group(1), validate=True)))
    assert model['mallId'] == 'new-world-city-shanghai'
    assert model['navigationEnabled'] is False
    assert [x['floor'] for x in model['levels']] == [f'L{i}' for i in range(1, 10)]
    assert sum(len(x['regions']) for x in model['levels']) == 737
    return model


def webp_size(raw):
    marker = raw.find(b'\x9d\x01\x2a', 12, 100)
    if raw[:4] != b'RIFF' or raw[8:12] != b'WEBP' or marker == -1:
        raise ValueError('Bad VP8 WebP source photo')
    return [int.from_bytes(raw[marker+3:marker+5], 'little') & 0x3fff,
            int.from_bytes(raw[marker+5:marker+7], 'little') & 0x3fff]


def compact_polygon(obj):
    path = [tuple(int(v) for v in point) for point in obj['path']]
    triangles = triangulate(path)
    deltas = []
    last_x = last_y = 0
    for x, y in path:
        x2, y2 = x*2, y*2
        deltas.extend((x2-last_x, y2-last_y))
        last_x, last_y = x2, y2
    # 1 = shop. 3 = flat POI/infra footprint; NEVER render as a shop roof.
    kind = 1 if obj['kind'] == 'shop' else 3
    return [obj['id'], kind, obj.get('label') or '', deltas,
            [list(range(len(path)))], triangles, obj['xy']]


def upgrade(repo, info, old_units):
    """Produce the main embedded mall catalog entry, preserving its store search."""
    repo = Path(repo)
    model = load_demo(repo)
    floors, refs, pois = [], {}, []
    codes = defaultdict(list)
    names = {
        'toilet': ('toilet', 'Baños'),
        'elevator': ('elevator', 'Ascensor'),
        'escalator': ('vertical-uncertain', 'Escalera mecánica'),
        'exit': ('exit', 'Salida de emergencia')
    }
    for floor in model['levels']:
        fid = floor['floor']
        width, height = floor['imageSize']
        assert [width, height] == [1376, 768]
        geo = []
        for obj in floor['regions']:
            assert all(0 <= x <= width and 0 <= y <= height for x, y in obj['path'])
            geo.append(compact_polygon(obj))
            if obj['kind'] == 'shop' and obj.get('label'):
                codes[(fid, obj['label'])].append(obj)
            if obj['kind'] in names:
                category, name = names[obj['kind']]
                pois.append({
                    'id': 'nwc9-'+obj['id'], 'category': category,
                    'name': name+' · '+fid+' (posición aproximada)',
                    'floor': fid, 'x': obj['xy'][0], 'y': obj['xy'][1],
                    'confidence': 'por-revisar',
                    'source': 'photo-colour-candidate',
                    'geometryId': obj['id'],
                    'verticalConnectionVerified': False
                })
        raw = (repo/'public/newworld9'/floor['photo']).read_bytes()
        assert webp_size(raw) == [width, height]
        sha = hashlib.sha256(raw).hexdigest()
        destination = repo/'public/reference/new-world-city-shanghai'/(fid+'.webp')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
        refs[fid] = {
            'url': 'reference/new-world-city-shanghai/'+fid+'.webp',
            'sha256': sha, 'imageSize': [width, height],
            'rasterSize': [width, height], 'quality': 'compressed-preview',
            'sourceUserFile': floor['sourcePhoto'],
            'viewBox': f'0 0 {width} {height}',
            'photoSource': 'photographed mall directory, not survey-calibrated',
            'qa': {
                'status': 'pending', 'reviewer': None, 'reviewedAt': None,
                'geometrySha256': None,
                'issues': [
                    'Photo segmentation, not independently validated store boundaries',
                    'Directory codes and positions require individual inspection',
                    'Between-floor connections remain hypothetical'
                ],
                'checks': {
                    'visualPhotoOverlay': False,
                    'individualStoreWalls': False,
                    'tenantCodeMatch': False,
                    'stairsAndElevators': False,
                    'floorAlignment': False,
                    'metricScale': False
                }
            }
        }
        step = 8
        w, h = (width + step-1)//step, (height + step-1)//step
        walk = {
            'x': 0, 'y': 0, 'step': step, 'w': w, 'h': h,
            'bits': base64.b64encode(bytes((w*h+7)//8)).decode('ascii')
        }
        floors.append([fid, fid+' · '+floor['name'],
                       'Fotografía aportada: '+floor['sourcePhoto'], geo, walk])
    # Never carry over old photo coordinates: their crops have changed.
    unit_index = []
    existing = set()
    for old in old_units:
        u = dict(old)
        key = (u['floor'], u['code'])
        existing.add(key)
        matched = codes.get(key, [])
        u['x'] = u['y'] = u['polygonId'] = None
        u.pop('facade', None)
        u.pop('roof', None)
        if len(matched) == 1:
            obj = matched[0]
            u.update({
                'x': obj['xy'][0], 'y': obj['xy'][1],
                'polygonId': obj['id'],
                'relation': 'one-photo-code-in-one-region-unverified',
                'positionStatus': 'photo-centroid-provisional-not-entrance'
            })
        else:
            u.update({
                'relation': 'duplicate-number-regions-require-review' if matched
                            else 'directory-name-unplaced',
                'positionStatus': 'unplaced-pending-photo-recognition'
            })
        unit_index.append(u)
    # L8 and L9 have no matching entries in the older L1-L7 directory.
    for (fid, code), matches in sorted(codes.items()):
        if (fid, code) in existing:
            continue
        obj = matches[0] if len(matches) == 1 else None
        unit_index.append({
            'code': code, 'name': '', 'floor': fid,
            'x': obj['xy'][0] if obj else None,
            'y': obj['xy'][1] if obj else None,
            'polygonId': obj['id'] if obj else None,
            'category': 'comercio por verificar', 'tags': '', 'aliases': '',
            'source': 'user-photo-map-'+fid, 'nameStatus': 'number-only',
            'positionStatus': 'photo-centroid-provisional-not-entrance'
                              if obj else 'ambiguous-photo-numeration',
            'relation': 'one-photo-code-in-one-region-unverified'
                        if obj else 'duplicate-number-regions-require-review'
        })
    # Synthetic visitors must be located in photographic circulation
    # candidates, not on shop roofs, bathrooms, elevator/escalator footprints.
    def point_in_polygon(x, y, boundary):
        inside = False
        for i, (ax, ay) in enumerate(boundary):
            bx, by = boundary[i - 1]
            if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
                inside = not inside
        return inside

    def min_edge_distance(x, y, boundary):
        from math import hypot
        nearest = float('inf')
        for i, (ax, ay) in enumerate(boundary):
            bx, by = boundary[i-1]
            dx, dy = bx-ax, by-ay
            t = max(0, min(1, ((x-ax)*dx+(y-ay)*dy) / (dx*dx+dy*dy or 1)))
            nearest = min(nearest, hypot(x-ax-t*dx, y-ay-t*dy))
        return nearest

    demo_doc = json.loads((repo/'data/malls/new-world-city-shanghai'/
                           'demo-corridor-anchors.json').read_text(encoding='utf-8'))
    assert demo_doc['mallId'] == 'new-world-city-shanghai'
    demo_people = demo_doc['people']
    assert len(demo_people) == 18
    by_floor = {floor['floor']: floor['regions'] for floor in model['levels']}
    used = set()
    for p in demo_people:
        assert p['id'] not in used
        used.add(p['id'])
        assert p['source'] == 'mock-photo-corridor-candidate'
        assert p['verified'] is False
        assert p['floor'] in by_floor
        assert 0 < p['x'] < 1376 and 0 < p['y'] < 768
        candidate = (p['x'],p['y'])
        clearance = []
        for room in by_floor[p['floor']]:
            polygon = room['path']
            assert not point_in_polygon(*candidate,polygon), (
                p['id']+' incorrectly intersects '+room['id'])
            clearance.append(min_edge_distance(*candidate,polygon))
        assert min(clearance) >= 7.0, (
            p['id']+' is too close to a store wall or service footprint')
    assert len({p['floor'] for p in demo_people}) == 9

    # Mechanical escalators are independently digitised from the yellow
    # pictograms. Old purple/blue region segmentation omitted several banks.
    # A bank's visual axis does NOT prove an arrival floor or up/down sense.
    escalator_doc = json.loads((repo/'data/malls/new-world-city-shanghai'/
                               'escalator-fixtures.photo.json').read_text(encoding='utf-8'))
    assert escalator_doc['imageSize'] == [1376, 768]
    assert escalator_doc['levelCorrespondenceVerified'] is False
    escalator_fixtures = escalator_doc['fixtures']
    assert len(escalator_fixtures) == 25
    assert {e['floor'] for e in escalator_fixtures} == set(by_floor)
    ids = set()
    for e in escalator_fixtures:
        from math import hypot
        assert e['id'] not in ids
        ids.add(e['id'])
        assert e['floor'] in by_floor
        assert e['lanes'] in [1, 2] and e['verified'] is False
        assert e['direction'] == 'unknown'
        assert all(0 < pt[0] < 1376 and 0 < pt[1] < 768
                   for pt in [e['p0'], e['p1']])
        assert hypot(e['p1'][0]-e['p0'][0],
                     e['p1'][1]-e['p0'][1]) > 32
        e['adjacentFloorCandidate'] = (
            'L'+str(int(e['floor'][1:])+1) if e['floor'] != 'L9' else 'L8')
        e['floorPairVerified'] = False
        e['entranceExitVerified'] = False

    # Source-linked lift shaft visual hypotheses; never routing edges.
    shafts_doc = json.loads((repo/'data/malls/new-world-city-shanghai'/
                            'elevator-shafts.provisional.json').read_text(encoding='utf-8'))
    assert shafts_doc['mallId'] == 'new-world-city-shanghai'
    assert shafts_doc['canUseForRouting'] is False
    shaft_candidates = shafts_doc['candidates']
    assert len(shaft_candidates) == 3
    assert sum(bool(c['primary']) for c in shaft_candidates) == 1
    for shaft in shaft_candidates:
        assert shaft['verified'] is False
        assert shaft['correspondenceVerified'] is False
        obs = shaft['observations']
        ids_seen = set()
        for point in obs:
            fid, ident = point['floor'], point['geometryId']
            assert (fid, ident) not in ids_seen
            ids_seen.add((fid, ident))
            candidates = [feature for feature in by_floor[fid]
                          if feature['id'] == ident]
            assert len(candidates) == 1
            assert candidates[0]['kind'] == 'elevator'
            assert all(abs(a-b) < 0.1 for a,b in zip(
                point['xy'], candidates[0]['xy']))
        indexes = [int(p['floor'][1:]) for p in obs]
        assert indexes == list(range(min(indexes), max(indexes)+1))
    assert [p['floor'] for p in shaft_candidates[0]['observations']] == [
        'L'+str(i) for i in range(1, 10)]

    count = sum(len(f[3]) for f in floors)
    assert count == 737 and len(unit_index) >= 380
    experiment = dict(info['photoDigitizationExperiment'])
    experiment['unmappedFloorsFromDirectorySign'] = ['B1', 'L10', 'L11', 'L12']
    return {
        **info, 'origin': [688, 384], 'scale': 0.115,
        'status': 'vectorizado-provisional',
        'source': 'Nueve fotografías del centro comercial L1-L9. Contornos pendientes de validación arquitectónica',
        'vectorMethod': 'photo-segmentation-nine-floors-2026-10-14',
        'vectorQuality': 'PHOTO-CANDIDATES-NOT-SURVEYED',
        'vectorRegionCount': count, 'legacyPhotoVectorRegionCount': 195,
        'floors': floors, 'floorLabels': [x[0] for x in floors],
        'floorReferences': refs, 'units': unit_index, 'pois': pois,
        'demoCorridorAnchors': demo_people,
        'escalatorFixtures': escalator_fixtures,
        'verticalShaftCandidates': shaft_candidates,
        'verticalShaftMappingsVerified': False,
        'escalatorFootprintsMeasured': False,
        'navigable': False, 'floorAlignmentApproved': False,
        'verticalConnectionHypotheses': model['verticalConnectionHypotheses'],
        # Heights are working assumptions until a survey establishes them.
        # A change to one storey shifts every upper floor and its 3D connectors.
        'verticalGeometry': {
            'defaultFloorHeightMeters': 4.0,
            'floorHeightsMeters': {f'L{i}': 4.0 for i in range(1, 10)},
            'metresVerified': False,
            'horizontalCalibrationVerified': False,
            'connectionMappingsVerified': False,
            'source': 'user-estimate-New-World-City-4m-per-floor',
            'description': 'Alturas por piso editables, no topografía ni medida de obra'
        },
        'photoDigitizationExperiment': experiment,
        'warning': '737 regiones provisionales fotografiadas, no tiendas certificadas. La navegación real permanece desactivada.'
    }
