"""Evidence invariants: ID joins cannot cross source coordinate spaces."""
import json
from pathlib import Path
from source_map import attach_source_geometry
repo=Path(__file__).resolve().parents[1]
table=json.loads((repo/'public/catalog/malls/aventura/stores.json').read_text())
source=json.loads((repo/'data/official-maps/aventura.json').read_text())
assert len(source['connectors'])==17 and not source['routingVerified']
assert sum(f['routingAudit']['segments'] for f in source['floors'])==1224
coffee=[s for s in table['records'] if 'food.coffee' in s.get('conceptIds',[])]
assert len(coffee)==15
assert len([s for s in coffee if s.get('sourceGeometry')])==11
for store in table['records']:
 b=store.get('sourceGeometry')
 if not b:continue
 assert store['polygonId'] is None # Never mix official WGS84 and photo pixels.
 assert b['storeId']==store['storeId'] and b['mallId']=='aventura'
 assert not b['surveyVerified']
 for p in b['polygons']:
  floor=next(f for f in source['floors'] if f['id']==p['floor'])
  feature=next(f for f in floor['features'] if f['id']==p['polygonId'])
  assert feature['locationId']==b['locationId']
  loc=next(l for l in source['locations'] if l['id']==b['locationId'])
  assert p['polygonId'] in loc['suiteIds']
wrong={'source':'aventura-official-directory','name':'Starbucks','officialMapLocationId':'20680','storeId':'aventura:directory:starbucks'}
attach_source_geometry(repo,'aventura',[wrong]);assert not wrong.get('sourceGeometry')
print('PASS official venue/store/floor/polygon joins, 11 Coffee geometries, 1224 unverified segments, 17 connectors')
