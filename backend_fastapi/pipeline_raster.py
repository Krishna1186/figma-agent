import base64
import io
import logging
import os

import numpy as np
from PIL import Image

from spectral_segmentation import spectral_segmentation

logger = logging.getLogger(__name__)


def _pil_to_b64(pil_img: Image.Image) -> str:
    buf = io.BytesIO()
    pil_img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def _bbox_iou(a: dict, b: dict) -> float:
    ax0, ay0 = int(a['x']), int(a['y'])
    ax1, ay1 = ax0 + int(a['w']), ay0 + int(a['h'])
    bx0, by0 = int(b['x']), int(b['y'])
    bx1, by1 = bx0 + int(b['w']), by0 + int(b['h'])
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    a_area = max(1, int(a['w']) * int(a['h']))
    b_area = max(1, int(b['w']) * int(b['h']))
    return float(inter / (a_area + b_area - inter + 1e-6))


def run_raster_pipeline(file_bytes: bytes, filename: str) -> dict:
    print('[raster] pipeline started', flush=True)
    img_pil = Image.open(io.BytesIO(file_bytes)).convert('RGBA')
    w, h = img_pil.size
    img_np = np.array(img_pil)
    rgb = img_np[:, :, :3]
    print(f'[raster] image size: {w}x{h}', flush=True)

    components = [{
        'id': 'component_001',
        'is_background': True,
        'depth_order': 1,
        'bbox': {'x': 0, 'y': 0, 'w': w, 'h': h},
        'image_bytes_b64': _pil_to_b64(img_pil),
        'image_width': w,
        'image_height': h,
    }]

    print('[raster] running spectral segmentation...', flush=True)
    os.environ['SAM_CHECKPOINT'] = ''  # force fast non-SAM spectral fallback
    segs = spectral_segmentation(rgb)
    print(f'[raster] raw segments: {len(segs)}', flush=True)

    min_area = int(0.003 * w * h)
    max_area = int(0.90 * w * h)
    filtered = []
    for s in sorted(segs, key=lambda x: int(x.get('area', 0)), reverse=True):
        bbox = s.get('bbox') or {}
        bw = int(bbox.get('w', 0))
        bh = int(bbox.get('h', 0))
        area = int(s.get('area', 0))
        if bw < 16 or bh < 16:
            continue
        if area < min_area or area > max_area:
            continue
        if any(_bbox_iou(bbox, ex.get('bbox', {})) > 0.85 for ex in filtered):
            continue
        filtered.append(s)

    print(f'[raster] usable segments: {len(filtered)}', flush=True)

    comp_id = 2
    depth = 2
    for s in filtered:
        if comp_id > 26:
            break
        mask = (s['mask'] > 0).astype(np.uint8) * 255
        b = s['bbox']
        x, y, bw, bh = int(b['x']), int(b['y']), int(b['w']), int(b['h'])
        crop_np = np.array(img_pil.crop((x, y, x + bw, y + bh)))
        crop_mask = mask[y:y + bh, x:x + bw]
        if crop_mask.shape[:2] != crop_np.shape[:2]:
            continue
        crop_np[:, :, 3] = np.minimum(crop_np[:, :, 3], crop_mask)
        crop_rgba = Image.fromarray(crop_np, 'RGBA')
        components.append({
            'id': f'component_{comp_id:03d}',
            'is_background': False,
            'depth_order': depth,
            'bbox': {'x': x, 'y': y, 'w': bw, 'h': bh},
            'image_bytes_b64': _pil_to_b64(crop_rgba),
            'image_width': bw,
            'image_height': bh,
        })
        comp_id += 1
        depth += 1

    print(f'[raster] done: {len(components)} components', flush=True)
    return {'pipeline_type': 'raster', 'width': w, 'height': h, 'components': components}

