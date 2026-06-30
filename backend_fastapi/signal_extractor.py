import logging
import os
from typing import Dict, Tuple

os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

import cv2
import numpy as np
from paddleocr import PaddleOCR

logger = logging.getLogger('decomposer')

_ocr_instance = None


def get_ocr() -> PaddleOCR:
    global _ocr_instance
    if _ocr_instance is None:
        _ocr_instance = PaddleOCR(use_angle_cls=True, lang='en')
    return _ocr_instance


def _mask_bbox(mask: np.ndarray) -> Tuple[int, int, int, int]:
    ys, xs = np.where(mask > 0)
    if len(xs) == 0 or len(ys) == 0:
        return 0, 0, mask.shape[1], mask.shape[0]
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return x0, y0, x1 - x0 + 1, y1 - y0 + 1


def _quantize_colors(rgb: np.ndarray) -> np.ndarray:
    return (rgb // 32).astype(np.uint8)


def _fft_high_freq_ratio(gray: np.ndarray) -> float:
    h, w = gray.shape
    f = np.fft.fft2(gray)
    fshift = np.fft.fftshift(f)
    mag = np.abs(fshift)
    y, x = np.ogrid[:h, :w]
    cy, cx = h / 2, w / 2
    radius = np.sqrt((y - cy) ** 2 + (x - cx) ** 2)
    max_r = np.max(radius)
    high_mask = radius > (0.5 * max_r)
    total = np.sum(mag) + 1e-6
    high = np.sum(mag[high_mask])
    return float(high / total)


def _edge_density(gray: np.ndarray) -> float:
    edges = cv2.Canny(gray, 80, 160)
    return float(np.sum(edges > 0) / edges.size)


def _circularity(mask: np.ndarray) -> float:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0.0
    cnt = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(cnt)
    perimeter = cv2.arcLength(cnt, True) + 1e-6
    return float((4 * np.pi * area) / (perimeter * perimeter))


def _n_vertices(mask: np.ndarray) -> int:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0
    cnt = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
    return int(len(approx))


def _ensure_numpy_image(crop: object) -> np.ndarray:
    if isinstance(crop, bytes):
        nparr = np.frombuffer(crop, np.uint8)
        dec = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if dec is None:
            raise ValueError('Failed to decode crop bytes')
        return cv2.cvtColor(dec, cv2.COLOR_BGR2RGB)
    if isinstance(crop, np.ndarray):
        return crop
    if hasattr(crop, 'tobytes'):
        return np.array(crop)
    raise TypeError(f'Unsupported crop type: {type(crop)}')


def extract_signals(image_rgb: np.ndarray, mask: np.ndarray, crop_override: object = None) -> Dict[str, float]:
    """
    Compute normalized signals for a component mask.

    Each signal has a docstring-like note below:
    - area_ratio: higher = larger component relative to image (background likely high)
    - aspect_ratio: >1 wide, <1 tall
    - rectangularity: 1.0 = fills its bounding box (rectangles/dividers high)
    - center_x / center_y: normalized position, 0..1
    - is_top_area: 1 if near top (logos/headers often true)
    - is_centered: 1 if horizontally centered
    - color_std: higher = more color variation (photos/illustrations higher)
    - unique_colors: higher = more complex color palette
    - mean_saturation: higher = vivid colors (logos often higher)
    - mean_value: higher = brighter region
    - high_freq_ratio: higher = more texture detail (photographs higher)
    - edge_density: higher = more edges (text/illustration higher)
    - circularity: higher = more circular shapes (logos/icons higher)
    - n_vertices: higher = more complex contour (illustrations higher)
    - ocr_confidence: higher = text presence
    - text_coverage: higher = more of crop covered by text boxes
    """
    h, w = image_rgb.shape[:2]
    mask_bin = (mask > 0).astype(np.uint8)
    x, y, bw, bh = _mask_bbox(mask_bin)
    bbox_area = max(1, bw * bh)
    area = int(np.sum(mask_bin))
    area_ratio = float(area / (h * w + 1e-6))
    aspect_ratio = float(bw / (bh + 1e-6))
    rectangularity = float(area / bbox_area)
    center_x = float((x + bw / 2) / (w + 1e-6))
    center_y = float((y + bh / 2) / (h + 1e-6))
    is_top_area = 1.0 if center_y < 0.2 else 0.0
    is_centered = 1.0 if 0.3 < center_x < 0.7 else 0.0

    if crop_override is None:
        crop = image_rgb[y:y + bh, x:x + bw]
    else:
        crop = _ensure_numpy_image(crop_override)
        if crop.ndim == 2:
            crop = cv2.cvtColor(crop, cv2.COLOR_GRAY2RGB)
        elif crop.ndim == 3 and crop.shape[2] == 4:
            crop = cv2.cvtColor(crop, cv2.COLOR_RGBA2RGB)

    mask_crop = mask_bin[y:y + bh, x:x + bw]
    if crop.shape[:2] != mask_crop.shape[:2]:
        crop = image_rgb[y:y + bh, x:x + bw]

    if crop.size == 0:
        return {
            'area_ratio': area_ratio,
            'aspect_ratio': aspect_ratio,
            'rectangularity': rectangularity,
            'center_x': center_x,
            'center_y': center_y,
            'is_top_area': is_top_area,
            'is_centered': is_centered,
            'color_std': 0.0,
            'unique_colors': 0.0,
            'mean_saturation': 0.0,
            'mean_value': 0.0,
            'high_freq_ratio': 0.0,
            'edge_density': 0.0,
            'circularity': 0.0,
            'n_vertices': 0.0,
            'ocr_confidence': 0.0,
            'text_coverage': 0.0,
        }

    flat = crop[mask_crop.astype(bool)]
    if flat.size == 0:
        flat = crop.reshape(-1, 3)

    color_std = float(np.mean(np.std(flat.astype(np.float32), axis=0)))
    quant = _quantize_colors(flat)
    unique_colors = float(len({tuple(c.tolist()) for c in quant}))

    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    mean_saturation = float(np.mean(hsv[..., 1][mask_crop > 0])) if np.any(mask_crop) else float(np.mean(hsv[..., 1]))
    mean_value = float(np.mean(hsv[..., 2][mask_crop > 0])) if np.any(mask_crop) else float(np.mean(hsv[..., 2]))

    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    high_freq_ratio = _fft_high_freq_ratio(gray)
    edge_density = _edge_density(gray)

    circularity = _circularity(mask_crop)
    n_vertices = float(_n_vertices(mask_crop))

    ocr_confidence = 0.0
    text_coverage = 0.0
    try:
        ocr = get_ocr()
        crop_for_ocr = _ensure_numpy_image(crop)
        if crop_for_ocr.ndim == 2:
            crop_for_ocr = cv2.cvtColor(crop_for_ocr, cv2.COLOR_GRAY2RGB)
        elif crop_for_ocr.ndim == 3 and crop_for_ocr.shape[2] == 4:
            crop_for_ocr = cv2.cvtColor(crop_for_ocr, cv2.COLOR_RGBA2RGB)
        crop_for_ocr = np.ascontiguousarray(crop_for_ocr, dtype=np.uint8)
        ocr_res = ocr.ocr(crop_for_ocr)
        if ocr_res and len(ocr_res[0]) > 0:
            confs = [line[1][1] for line in ocr_res[0] if line and line[1]]
            ocr_confidence = float(np.mean(confs)) if confs else 0.0
            total_area = crop.shape[0] * crop.shape[1]
            covered = 0.0
            for line in ocr_res[0]:
                box = line[0]
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                covered += (max(xs) - min(xs)) * (max(ys) - min(ys))
            text_coverage = float(covered / (total_area + 1e-6))
    except Exception:
        return {
            'area_ratio': area_ratio,
            'aspect_ratio': aspect_ratio,
            'rectangularity': rectangularity,
            'center_x': center_x,
            'center_y': center_y,
            'is_top_area': is_top_area,
            'is_centered': is_centered,
            'color_std': color_std,
            'unique_colors': unique_colors,
            'mean_saturation': mean_saturation,
            'mean_value': mean_value,
            'high_freq_ratio': high_freq_ratio,
            'edge_density': edge_density,
            'circularity': circularity,
            'n_vertices': n_vertices,
            'ocr_confidence': 0.0,
            'text_coverage': 0.0,
        }

    return {
        'area_ratio': area_ratio,
        'aspect_ratio': aspect_ratio,
        'rectangularity': rectangularity,
        'center_x': center_x,
        'center_y': center_y,
        'is_top_area': is_top_area,
        'is_centered': is_centered,
        'color_std': color_std,
        'unique_colors': unique_colors,
        'mean_saturation': mean_saturation,
        'mean_value': mean_value,
        'high_freq_ratio': high_freq_ratio,
        'edge_density': edge_density,
        'circularity': circularity,
        'n_vertices': n_vertices,
        'ocr_confidence': ocr_confidence,
        'text_coverage': text_coverage,
    }
