import logging
from typing import Dict, List, Tuple

import cv2
import numpy as np
from scipy import ndimage as ndi

logger = logging.getLogger('decomposer')


def _rgb_channels(image_rgb: np.ndarray) -> List[np.ndarray]:
    r, g, b = cv2.split(image_rgb)
    return [r, g, b]


def _hsv_channels(image_rgb: np.ndarray) -> List[np.ndarray]:
    hsv = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2HSV)
    h, s, v = cv2.split(hsv)
    return [h, s, v]


def _lab_channels(image_rgb: np.ndarray) -> List[np.ndarray]:
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    return [l, a, b]


def _sobel_magnitude(channel: np.ndarray) -> np.ndarray:
    gx = cv2.Sobel(channel, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(channel, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    mag = mag / (np.max(mag) + 1e-6)
    return mag


def _canny_edges(channel: np.ndarray, low: int, high: int) -> np.ndarray:
    edges = cv2.Canny(channel, low, high)
    return (edges > 0).astype(np.float32)


def _fft_vote(gray: np.ndarray) -> np.ndarray:
    h, w = gray.shape
    f = np.fft.fft2(gray)
    fshift = np.fft.fftshift(f)
    mag = np.abs(fshift)
    y, x = np.ogrid[:h, :w]
    cy, cx = h / 2, w / 2
    radius = np.sqrt((y - cy) ** 2 + (x - cx) ** 2)
    max_r = np.max(radius) + 1e-6
    high_mask = radius > (0.5 * max_r)
    low_mask = radius < (0.15 * max_r)

    high = mag * high_mask
    low = mag * low_mask

    high_ifft = np.abs(np.fft.ifft2(np.fft.ifftshift(high)))
    low_ifft = np.abs(np.fft.ifft2(np.fft.ifftshift(low)))

    high_ifft = high_ifft / (np.max(high_ifft) + 1e-6)
    low_ifft = low_ifft / (np.max(low_ifft) + 1e-6)

    return 0.5 * (high_ifft + low_ifft)


def build_boundary_vote_map(image_rgb: np.ndarray) -> np.ndarray:
    channels = []
    channels.extend(_rgb_channels(image_rgb))
    channels.extend(_hsv_channels(image_rgb))
    channels.extend(_lab_channels(image_rgb))

    vote = np.zeros(image_rgb.shape[:2], dtype=np.float32)

    for ch in channels:
        vote += _canny_edges(ch, 30, 60)
        vote += _canny_edges(ch, 80, 160)
        vote += _sobel_magnitude(ch)

    vote = vote / (np.max(vote) + 1e-6)

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    vote += _fft_vote(gray)
    vote = vote / (np.max(vote) + 1e-6)
    return vote


def _boundary_alignment_score(mask: np.ndarray, vote_map: np.ndarray, thresh: float = 0.4) -> float:
    edges = cv2.Canny((mask * 255).astype(np.uint8), 50, 150)
    boundary = edges > 0
    if np.sum(boundary) == 0:
        return 0.0
    aligned = np.sum((vote_map >= thresh) & boundary)
    return float(aligned / (np.sum(boundary) + 1e-6))


def _watershed_split(image_rgb: np.ndarray, mask: np.ndarray) -> List[np.ndarray]:
    dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    _, sure_fg = cv2.threshold(dist, 0.4 * dist.max(), 255, 0)
    sure_fg = sure_fg.astype(np.uint8)
    sure_bg = cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2)
    unknown = cv2.subtract(sure_bg, sure_fg)

    ret, markers = cv2.connectedComponents(sure_fg)
    markers = markers + 1
    markers[unknown == 255] = 0

    color = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    markers = cv2.watershed(color, markers)

    masks = []
    for idx in range(2, ret + 2):
        m = (markers == idx).astype(np.uint8)
        if np.sum(m) > 0:
            masks.append(m)
    if not masks:
        masks.append(mask.astype(np.uint8))
    return masks


def _mask_mean_color(image_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    pixels = image_rgb[mask > 0]
    if pixels.size == 0:
        return np.array([0.0, 0.0, 0.0], dtype=np.float32)
    return np.mean(pixels, axis=0).astype(np.float32)


def _are_masks_adjacent(mask_a: np.ndarray, mask_b: np.ndarray, max_gap: int = 5) -> bool:
    kernel = np.ones((max_gap * 2 + 1, max_gap * 2 + 1), np.uint8)
    dilated_a = cv2.dilate(mask_a.astype(np.uint8), kernel, iterations=1)
    return bool(np.any((dilated_a > 0) & (mask_b > 0)))


def _merge_sam_masks(image_rgb: np.ndarray, masks: List[np.ndarray]) -> List[np.ndarray]:
    if len(masks) < 2:
        return masks

    h, w = image_rgb.shape[:2]
    max_merge_area = int(0.30 * h * w)
    merged = [m.astype(np.uint8) for m in masks]

    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(merged):
            j = i + 1
            while j < len(merged):
                m1 = merged[i]
                m2 = merged[j]
                if not _are_masks_adjacent(m1, m2, max_gap=5):
                    j += 1
                    continue

                union = np.logical_or(m1 > 0, m2 > 0).astype(np.uint8)
                union_area = int(np.sum(union))
                if union_area > max_merge_area:
                    j += 1
                    continue

                c1 = _mask_mean_color(image_rgb, m1)
                c2 = _mask_mean_color(image_rgb, m2)
                color_diff = float(np.linalg.norm(c1 - c2))
                if color_diff >= 20.0:
                    j += 1
                    continue

                merged[i] = union
                merged.pop(j)
                changed = True
                break
            if changed:
                break
            i += 1

    return merged


def _sam_masks(image_rgb: np.ndarray) -> List[np.ndarray]:
    try:
        from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
        import os

        checkpoint = os.environ.get('SAM_CHECKPOINT', './sam_vit_h_4b8939.pth')
        model_type = os.environ.get('SAM_MODEL_TYPE', 'vit_h')
        if not checkpoint:
            raise RuntimeError('SAM_CHECKPOINT not set')

        sam = sam_model_registry[model_type](checkpoint=checkpoint)
        mask_gen = SamAutomaticMaskGenerator(
            sam,
            points_per_side=16,
            pred_iou_thresh=0.92,
            stability_score_thresh=0.92,
        )
        generated = mask_gen.generate(image_rgb)

        h, w = image_rgb.shape[:2]
        min_area = int(0.005 * h * w)
        masks = [m['segmentation'].astype(np.uint8) for m in generated if int(np.sum(m['segmentation'])) >= min_area]
        masks = _merge_sam_masks(image_rgb, masks)
        return masks
    except Exception as e:
        logger.warning('SAM/SAM2 not available, falling back to CC masks: %s', e)
        return []


def spectral_segmentation(image_rgb: np.ndarray) -> List[Dict[str, object]]:
    """
    Multi-space spectral segmentation pipeline.
    Returns list of dicts: {mask, bbox, area, boundary_alignment_score}.
    """
    vote_map = build_boundary_vote_map(image_rgb)
    boundary_mask = vote_map >= 0.4
    inv = (~boundary_mask).astype(np.uint8)

    labeled, num = ndi.label(inv)
    cc_masks = []
    for i in range(1, num + 1):
        m = (labeled == i).astype(np.uint8)
        if np.sum(m) > 0:
            cc_masks.append(m)

    sam_masks = _sam_masks(image_rgb)
    use_sam = len(sam_masks) > 0
    base_masks = sam_masks if use_sam else cc_masks

    final = []
    for m in base_masks:
        score = _boundary_alignment_score(m, vote_map)
        masks_to_add = [m]
        # Keep SAM masks intact to avoid re-fragmenting already segmented regions.
        if not use_sam and score < 0.6:
            masks_to_add = _watershed_split(image_rgb, m)
        for sm in masks_to_add:
            ys, xs = np.where(sm > 0)
            if len(xs) == 0 or len(ys) == 0:
                continue
            x0, x1 = int(xs.min()), int(xs.max())
            y0, y1 = int(ys.min()), int(ys.max())
            bbox = {'x': x0, 'y': y0, 'w': x1 - x0 + 1, 'h': y1 - y0 + 1}
            final.append({
                'mask': sm,
                'bbox': bbox,
                'area': int(np.sum(sm)),
                'boundary_alignment_score': float(_boundary_alignment_score(sm, vote_map)),
            })

    return final
