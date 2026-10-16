"""Join official IDs to their own source polygons, never to photo coordinates."""
import hashlib
import json
import re
import unicodedata


def name_key(value):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', value.lower()).replace('&', 'and'))


def attach_source_geometry(repo, mall_id, records):
    path = repo / 'data/official-maps' / (mall_id + '.json')
    if not path.exists():
        return
    source = json.loads(path.read_text())
    assert source['mallId'] == mall_id and source['venueId'] == 107
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    locations = source['locations']
    for store in records:
        if store.get('source') != 'aventura-official-directory':
            continue
        location_id = store.get('officialMapLocationId')
        matches = [l for l in locations if l['id'] == str(location_id)] if location_id else [
            l for l in locations if name_key(l['name']) == name_key(store['name'])]
        # An ID with a different name is a source conflict, not a usable match.
        if len(matches) != 1 or name_key(matches[0]['name']) != name_key(store['name']):
            continue
        location = matches[0]
        geometry = []
        for floor in source['floors']:
            for feature in floor['features']:
                if feature['locationId'] == location['id'] and feature['id'] in location['suiteIds']:
                    geometry.append({'floor': floor['id'], 'sourceFloorId': floor['sourceFloorId'],
                                     'polygonId': feature['id'], 'datasetId': floor['datasetId']})
        if geometry:
            store['sourceGeometry'] = {'mallId': mall_id, 'storeId': store['storeId'],
                'locationId': location['id'], 'coordinateSpace': source['coordinateSpace'],
                'sourceSha256': digest, 'evidence': 'official-location-suite-and-polygon-id',
                'polygons': geometry, 'surveyVerified': False}


def activate_native_mesh(repo, mall_id, mall, records):
    """Use source polygons in the existing 3D renderer; never align two frames by guesswork."""
    if mall_id != 'aventura':
        return
    source_path = repo / 'data/official-maps/aventura.json'
    mesh = json.loads((repo / 'data/official-maps/aventura-3d.json').read_text())
    assert mesh['sourceSha256'] == hashlib.sha256(source_path.read_bytes()).hexdigest()
    features = {(f[0], p[0]): p for f in mesh['floors'] for p in f[3]}
    # Keep the supplied vectorizations available in the original photo review.
    reference = repo / 'public/maps/aventura-photo-reference.json'
    reference.write_text(json.dumps(mall['floors'], separators=(',', ':')))
    mall['photoMapAsset'] = {'url': 'maps/aventura-photo-reference.json',
        'sha256': hashlib.sha256(reference.read_bytes()).hexdigest()}
    for store in records:
        binding = store.get('sourceGeometry')
        if binding:
            polygons = binding['polygons']
            for p in polygons:
                assert (p['floor'], p['polygonId']) in features
            primary = next((p for p in polygons if p['floor'] == store.get('floor')), polygons[0])
            store['floor'] = primary['floor']
            store['x'], store['y'] = features[(primary['floor'], primary['polygonId'])][6]
            store['coordinateSpace'] = mesh['coordinateSpace']
        elif store.get('source') != 'aventura-official-directory':
            store['photoReference'] = {k: store.get(k) for k in ('floor','polygonId','x','y')}
            store.update(activeMap=False, polygonId=None, x=None, y=None)
    mall.update(floors=mesh['floors'], origin=mesh['origin'], scale=mesh['scale'],
        coordinateSpace=mesh['coordinateSpace'], sourceMapSha256=mesh['sourceSha256'],
        source='Geometría vectorial del mapa oficial de Aventura', status='source-linked',
        navigable=False, indoorPositionCalibrated=False, pois=mesh['connectors'],
        routingAudit={'verified': False, 'segments': 1224, 'connectors': 17,
            'reason': 'Sin grafo de puertas, sentidos y continuidad peatonal verificados'})
    mall['demoCorridorAnchors'] = [dict(floor=floor, x=line[0][0], y=line[0][1])
        for floor, lines in mesh['circulation'].items() for line in lines[:3]]
