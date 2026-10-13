"""Offline deterministic tests; never invoke a paid AI API in CI."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

from ai_floor_review import image_tiles, normalize_tile_proposals, SCHEMA


def run():
    image = np.zeros((620, 1440, 3), dtype=np.uint8)
    crops = image_tiles(image, max_tiles=16)
    assert 6 <= len(crops) <= 16
    assert all(tile.shape[0] >= 300 and tile.shape[1] >= 400 for _, _, tile in crops)
    assert SCHEMA['additionalProperties'] is False
    suggestion = {
        'segments': [
            {'x1': 8, 'y1': 12, 'x2': 74, 'y2': 58,
             'kind': 'curved-shopfront', 'confidence': .81,
             'reason': 'A visible arc'},
            {'x1': -40, 'y1': 12, 'x2': 100, 'y2': 60,
             'kind': 'shop-wall', 'confidence': .95, 'reason': 'Invalid out of crop'}
        ],
        'labels': [{'x': 15, 'y': 50, 'kind': 'store-code',
                    'text': 'A-11', 'confidence': .75}]
    }
    validated = normalize_tile_proposals(suggestion, 500, 100, 300, 250)
    assert len(validated['segments']) == 1
    assert validated['segments'][0]['x1'] == 508
    assert validated['segments'][0]['verified'] is False
    assert validated['labels'][0]['x'] == 515
    assert validated['labels'][0]['status'].startswith('ai-suggestion')
    with tempfile.TemporaryDirectory() as temp:
        target = Path(temp) / 'tile.png'
        cv2.imwrite(str(target), image)
        cmd = [sys.executable,
               str(Path(__file__).with_name('ai_floor_review.py')),
               '--image', str(target), '--floor', 'B1',
               '--out', str(Path(temp)/'suggestions.json'), '--enable-ai']
        env = {k: v for k, v in os.environ.items() if k != 'OPENAI_API_KEY'}
        completed = subprocess.run(cmd, capture_output=True, text=True, env=env)
        assert completed.returncode != 0
        assert 'OPENAI_API_KEY is missing' in completed.stderr
        assert not (Path(temp)/'suggestions.json').exists()
    print('PASS: opt-in AI reviewing never applies unverified geometry or calls API without key')


if __name__ == '__main__':
    run()