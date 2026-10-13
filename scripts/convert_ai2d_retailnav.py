#!/usr/bin/env python3
"""Promote *unapproved* AP Plaza AI2D candidates to RetailNav mesh data.

Read only the frozen experimental GeoJSON, validate each original polygon,
triangulate constrained interior (never convex hull), preserve code provenance,
and keep navigation approval disabled. This is a display format conversion,
NOT recognition or survey certification.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import zlib

from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

EXPECTED_PHOTO = "8053ccfa86129533d693a05271efbe2b3bfcd3d7674fb8753bd54f914ce9e063"


def read_geojson(path):
    data = Path(path).read_bytes()
    if str(path).endswith('.zlib.b64'):
        data = zlib.decompress(base64.b64decode(data))
    return json.loads(data)


def convert(data):
    meta = data.get('metadata', {})
    if meta.get('photoSHA256') != EXPECTED_PHOTO or [meta.get('width'), meta.get('height')] != [1440, 620]:
        raise ValueError('AI2D source is not registered to the exact B1 photograph')
    if data.get('type') != 'FeatureCollection' or len(data.get('features', [])) != 197:
        raise ValueError('Expected exactly 197 provisional candidate polygons')
    out=[]
    seen=set()
    source_area=0.0
    output_area=0.0
    known_codes={}
    for item in data['features']:
        props=item['properties']
        identifier=props['id']
        if not identifier.startswith('AI2D-B1-') or identifier in seen:
            raise ValueError('Invalid/duplicated candidate ID: '+identifier)
        seen.add(identifier)
        geom=shape(item['geometry'])
        if not isinstance(geom,Polygon) or not geom.is_valid or geom.area < 15 or len(geom.interiors):
            raise ValueError('Invalid polygon (do not auto-repair): '+identifier)
        points=list(geom.exterior.coords)[:-1]
        if len(points)<3 or len(points)>180:
            raise ValueError('Unsupported number of points: '+identifier)
        quantized=[]
        for x,y in points:
            if not (0<=x<=1440 and 0<=y<=620):
                raise ValueError('Pixel beyond native reference image')
            quantized.append((int(round(x*2)), int(round(y*2))))
        if len(quantized) != len(set(quantized)):
            raise ValueError('Geometry has duplicated quantized vertices')
        decoded=[(x/2,y/2) for x,y in quantized]
        qpoly=Polygon(decoded)
        if not qpoly.is_valid or abs(qpoly.area-geom.area) > max(4.0, .01 * geom.area):
            raise ValueError('Pixel quantization changed topology: '+identifier)
        indices=[]
        lookup={pt:i for i,pt in enumerate(decoded)}
        area=0.0
        for triangle in constrained_delaunay_triangles(qpoly).geoms:
            vertices=list(triangle.exterior.coords)[:-1]
            if len(vertices)!=3:
                raise ValueError('Non-triangle in constrained tessellation')
            tri_ids=[]
            for vertex in vertices:
                key=(float(vertex[0]),float(vertex[1]))
                if key not in lookup:
                    raise ValueError('Tessellation introduced vertex outside polygon: '+identifier)
                tri_ids.append(lookup[key])
            if len(set(tri_ids))!=3:
                raise ValueError('Degenerate polygon triangle')
            indices.extend(tri_ids)
            area+=triangle.area
        if abs(area-qpoly.area)>max(0.1,.0002*qpoly.area):
            raise ValueError('Constrained triangulation leaked out of concave polygon: '+identifier)
        delta=[]
        px=py=0
        for x,y in quantized:
            delta.extend((x-px,y-py))
            px,py=x,y
        code=props.get('storeCode')
        label=(props.get('storeName') or code or '').strip()
        kind=0 if code in {'A-01','7-ELEVEN','STARBUCKS','KFC','MCDONALDS'} else 1
        if code:
            if code in known_codes:
                raise ValueError('One verified code mapped to two candidates')
            known_codes[code]=identifier
        rep=qpoly.representative_point()
        out.append([identifier,kind,label,delta,[list(range(len(decoded)))],indices,[round(rep.x,2),round(rep.y,2)]])
        source_area+=geom.area
        output_area+=qpoly.area
    overlap=sum(shape(f['geometry']).area for f in data['features'])-unary_union([shape(f['geometry']) for f in data['features']]).area
    if overlap > .5 or abs(source_area-output_area)>max(20, .001*source_area):
        raise ValueError('Overlapping or distorted source polygons')
    return out, {'features':len(out),'vertices':sum(len(x[3])//2 for x in out),
                 'triangles':sum(len(x[5])//3 for x in out),'codes':len(known_codes),
                 'overlapPx2':round(overlap,6),'areasPx2':round(output_area,2),
                 'referenceSHA256':meta['photoSHA256'],
                 'navigationApproved':False,'status':'PROVISIONAL-NOT-VERIFIED'}


def main():
    cli=argparse.ArgumentParser()
    cli.add_argument('--input',required=True)
    cli.add_argument('--output',required=True)
    cli.add_argument('--report',required=True)
    a=cli.parse_args()
    geom,report=convert(read_geojson(a.input))
    raw=json.dumps(geom,ensure_ascii=False,separators=(',',':')).encode('utf8')
    Path(a.output).write_text(base64.b64encode(zlib.compress(raw,9)).decode('ascii')+'\n')
    report['geometrySHA256']=hashlib.sha256(raw).hexdigest()
    Path(a.report).write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()