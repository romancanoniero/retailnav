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
