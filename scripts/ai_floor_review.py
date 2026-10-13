#!/usr/bin/env python3
"""Opt-in AI vision cross-check for high-resolution mall plan photographs.

THIS DOES NOT EDIT GEOMETRY. Suggestions of curves, walls, labels and amenities
are checked for tile bounds, stored as unverified proposals, and require human
review against source photo. Explicitly pass --enable-ai with an OPENAI_API_KEY.
The photo's pixel data is sent to the selected AI provider only when opted in.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

import cv2

SCHEMA = {
    'type': 'object',
    'properties': {
        'tileQuality': {'type': 'string', 'enum': ['clear', 'partly-readable', 'unreadable']},
        'notes': {'type': 'string'},
        'segments': {
            'type': 'array', 'items': {
                'type': 'object',
                'properties': {
                    'x1': {'type': 'number'}, 'y1': {'type': 'number'},
                    'x2': {'type': 'number'}, 'y2': {'type': 'number'},
                    'kind': {'type': 'string', 'enum': [
                        'shop-wall', 'curved-shopfront', 'corridor-edge',
                        'graphic-or-lettering', 'unsure']},
                    'confidence': {'type': 'number'},
                    'reason': {'type': 'string'}
                },
                'required': ['x1', 'y1', 'x2', 'y2', 'kind', 'confidence', 'reason'],
                'additionalProperties': False
            }
        },
        'labels': {
            'type': 'array', 'items': {
                'type': 'object',
                'properties': {
                    'x': {'type': 'number'}, 'y': {'type': 'number'},
                    'text': {'type': 'string'},
                    'kind': {'type': 'string', 'enum': ['store-code', 'store-name', 'zone-name',
                                                      'bathroom', 'stairs', 'elevator',
                                                      'exit', 'metro', 'unsure']},
                    'confidence': {'type': 'number'}
                },
                'required': ['x', 'y', 'text', 'kind', 'confidence'],
                'additionalProperties': False
            }
        }
    },
    'required': ['tileQuality', 'notes', 'segments', 'labels'],
    'additionalProperties': False
}


def image_tiles(image, width=480, height=350, overlap=80, max_tiles=8):
    h, w = image.shape[:2]
    x_starts = list(range(0, max(1, w - width + 1), width - overlap))
    y_starts = list(range(0, max(1, h - height + 1), height - overlap))
    x_starts += [max(0, w - width)]
    y_starts += [max(0, h - height)]
    items = []
    for y in sorted(set(y_starts)):
        for x in sorted(set(x_starts)):
            tile = image[y:min(h, y + height), x:min(w, x + width)]
            if tile.size and not any(item[0] == x and item[1] == y for item in items):
                items.append((x, y, tile))
    if len(items) > max_tiles:
        raise ValueError('Plan requires %s overlapping crops; raise --max-tiles explicitly' % len(items))
    return items


def request_ai(image, api_key, model, timeout=90):
    ok, encoded = cv2.imencode('.jpg', image,
                               [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not ok:
        raise ValueError('Cannot encode tile')
    photo = 'data:image/jpeg;base64,' + base64.b64encode(encoded.tobytes()).decode()
    payload = {
        'model': model,
        'store': False,
        'max_output_tokens': 1700,
        'input': [{
            'role': 'user',
            'content': [
                {'type': 'input_text', 'text': (
                    'You are auditing a SHOPPING MALL FLOOR GUIDE PHOTO. '
                    'Coordinates you return MUST be within this image tile, '
                    'origin top-left. Read labels only when clearly legible. '
                    'Identify candidate store-dividing WALLS, true CURVED storefront '
                    'borders and distinguish them from printed TEXT/LOGOS. '
                    'Produce short approximate line segments and centre points '
                    'ONLY for features visible in the pixels. Do not hallucinate. '
                    'All suggestions will undergo separate pixel-level validation; '
                    'no AI suggestion establishes a verified architectural wall. '
                    'If uncertain, say unsure or omit.')},
                {'type': 'input_image', 'image_url': photo, 'detail': 'high'}
            ]
        }],
        'text': {'format': {'type': 'json_schema', 'name': 'mall_tile_review',
                            'strict': True, 'schema': SCHEMA}}
    }
    request = urllib.request.Request(
        'https://api.openai.com/v1/responses',
        data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + api_key,
                 'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as err:
        raise RuntimeError('AI request failed with HTTP %s. Check model/key/quota.' % err.code)
    text = ''
    for item in data.get('output', []):
        if item.get('type') == 'message':
            text += ''.join(v.get('text', '') for v in item.get('content', [])
                            if v.get('type') == 'output_text')
    if not text:
        raise RuntimeError('AI returned no parsable output; no geometry was changed')
    return json.loads(text)


def normalize_tile_proposals(raw, left, top, width, height):
    results = {'segments': [], 'labels': []}
    for edge in raw.get('segments', [])[:120]:
        if not (isinstance(edge, dict) and
                all(isinstance(edge.get(k), (int, float)) for k in
                    ['x1', 'y1', 'x2', 'y2', 'confidence'])):
            continue
        if not (0 <= edge['confidence'] <= 1 and
                0 <= edge['x1'] <= width and 0 <= edge['x2'] <= width and
                0 <= edge['y1'] <= height and 0 <= edge['y2'] <= height):
            continue
        results['segments'].append({
            **edge, 'x1': left + edge['x1'], 'y1': top + edge['y1'],
            'x2': left + edge['x2'], 'y2': top + edge['y2'],
            'verified': False, 'status': 'ai-suggestion-awaiting-pixel-and-human-review'
        })
    for label in raw.get('labels', [])[:100]:
        if not (isinstance(label, dict) and
                all(isinstance(label.get(k), (int, float)) for k in ['x', 'y', 'confidence'])):
            continue
        if not (0 <= label['confidence'] <= 1 and
                0 <= label['x'] <= width and 0 <= label['y'] <= height):
            continue
        results['labels'].append({
            **label, 'x': left + label['x'], 'y': top + label['y'],
            'verified': False, 'status': 'ai-suggestion-awaiting-ocr-and-human-review'
        })
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--image', required=True)
    p.add_argument('--floor', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--enable-ai', action='store_true')
    p.add_argument('--model', default='gpt-4.1-mini')
    p.add_argument('--max-tiles', type=int, default=12)
    args = p.parse_args()
    if not args.enable_ai:
        p.error('AI must be explicitly enabled to send a photograph to an external service')
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        p.error('OPENAI_API_KEY is missing. No image was sent or geometry modified.')
    image = cv2.imread(args.image)
    if image is None:
        p.error('Reference photograph not readable')
    if not 1 <= args.max_tiles <= 40:
        p.error('max-tiles must be between 1 and 40')
    tiles = image_tiles(image, max_tiles=args.max_tiles)
    report = {'schema': 'retailnav.ai-plan-suggestions.v1',
              'sourceSHA256': hashlib.sha256(Path(args.image).read_bytes()).hexdigest(),
              'floor': args.floor, 'model': args.model,
              'status': 'unverified', 'sendsImageToExternalAI': True,
              'geometryChangesApplied': False,
              'tiles': [], 'segments': [], 'labels': []}
    for index, (x, y, tile) in enumerate(tiles):
        response = request_ai(tile, api_key, args.model)
        checked = normalize_tile_proposals(response, x, y,
                                            tile.shape[1], tile.shape[0])
        report['tiles'].append({'tileIndex': index, 'x': x, 'y': y,
                                'width': tile.shape[1], 'height': tile.shape[0],
                                'quality': response.get('tileQuality'),
                                'status': 'manual-review-required'})
        report['segments'].extend(checked['segments'])
        report['labels'].extend(checked['labels'])
    Path(args.out).write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print('AI draft complete:', len(report['segments']), 'line suggestions;',
          len(report['labels']), 'label proposals; 0 approved walls.')


if __name__ == '__main__':
    main()