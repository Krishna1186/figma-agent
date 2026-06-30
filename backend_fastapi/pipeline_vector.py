import base64
import io
import logging
import uuid
from typing import Dict, List

import fitz  # PyMuPDF
import numpy as np
from PIL import Image

from classifier import classify_component
from signal_extractor import extract_signals

logger = logging.getLogger('decomposer')


def _hex_from_int(color: int) -> str:
    r = (color >> 16) & 0xFF
    g = (color >> 8) & 0xFF
    b = color & 0xFF
    return f'#{r:02X}{g:02X}{b:02X}'


def _drawing_to_svg(drawing: Dict, page_w: float, page_h: float) -> str:
    path_parts = []
    n_vertices = 0
    for item in drawing.get('items', []):
        cmd = item[0]
        pts = item[1]
        if cmd == 'l':
            if len(pts) >= 2:
                x, y = pts[0], pts[1]
                path_parts.append(f'L {x} {y}')
                n_vertices += 1
        elif cmd == 'm':
            if len(pts) >= 2:
                x, y = pts[0], pts[1]
                path_parts.append(f'M {x} {y}')
                n_vertices += 1
        elif cmd == 'c':
            if len(pts) >= 6:
                x1, y1, x2, y2, x3, y3 = pts[:6]
                path_parts.append(f'C {x1} {y1} {x2} {y2} {x3} {y3}')
                n_vertices += 3
        elif cmd == 're':
            if len(pts) >= 4:
                x, y, w, h = pts[:4]
                path_parts.append(f'M {x} {y} L {x + w} {y} L {x + w} {y + h} L {x} {y + h} Z')
                n_vertices += 4
        elif cmd == 'qu':
            if len(pts) >= 8:
                x1, y1, x2, y2, x3, y3, x4, y4 = pts[:8]
                path_parts.append(f'M {x1} {y1} L {x2} {y2} L {x3} {y3} L {x4} {y4} Z')
                n_vertices += 4
        elif cmd == 'h':
            path_parts.append('Z')
    d = ' '.join(path_parts) if path_parts else ''
    stroke = drawing.get('color')
    fill = drawing.get('fill')
    stroke_hex = _hex_from_int(stroke) if isinstance(stroke, int) else '#000000'
    fill_hex = _hex_from_int(fill) if isinstance(fill, int) else 'none'
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{page_w}" height="{page_h}">'
        f'<path d="{d}" fill="{fill_hex}" stroke="{stroke_hex}" />'
        '</svg>'
    )
    return svg, n_vertices


def _text_role(font_size: float) -> str:
    if font_size > 24:
        return 'heading'
    if font_size > 14:
        return 'subheading'
    return 'body'


def _image_role_for_rect(rect: fitz.Rect, page_w: float, page_h: float) -> str:
    area_ratio = (rect.width * rect.height) / max(1.0, (page_w * page_h))
    in_corner = (
        (rect.x0 < page_w * 0.15 and rect.y0 < page_h * 0.15)
        or (rect.x1 > page_w * 0.85 and rect.y0 < page_h * 0.15)
        or (rect.x0 < page_w * 0.15 and rect.y1 > page_h * 0.85)
        or (rect.x1 > page_w * 0.85 and rect.y1 > page_h * 0.85)
    )
    if area_ratio < 0.05 and in_corner:
        return 'logo'
    if area_ratio > 0.30:
        return 'illustration'
    if 0.05 <= area_ratio <= 0.30 and rect.x0 < page_w * 0.35:
        return 'photo'
    return 'photo'


def extract_vector_manifest(pdf_bytes: bytes) -> Dict[str, object]:
    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    pages_out = []

    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        page_w, page_h = page.rect.width, page.rect.height
        components = []

        words = page.get_text('words')
        word_items = []
        for w in words:
            if len(w) < 5:
                continue
            x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
            if not text or not str(text).strip():
                continue
            font_size = max(1.0, float(y1 - y0))
            word_items.append({
                'x0': float(x0),
                'y0': float(y0),
                'x1': float(x1),
                'y1': float(y1),
                'text': str(text),
                'font_size': font_size,
            })

        word_items.sort(key=lambda w: (w['y0'], w['x0']))
        lines = []
        for w in word_items:
            if not lines:
                lines.append({'words': [w], 'y0': w['y0'], 'y1': w['y1'], 'font_size': w['font_size']})
                continue
            line = lines[-1]
            if abs(w['y0'] - line['y0']) <= (line['font_size'] * 0.5):
                line['words'].append(w)
                line['y0'] = min(line['y0'], w['y0'])
                line['y1'] = max(line['y1'], w['y1'])
                line['font_size'] = max(line['font_size'], w['font_size'])
            else:
                lines.append({'words': [w], 'y0': w['y0'], 'y1': w['y1'], 'font_size': w['font_size']})

        segments = []
        for line in lines:
            words_sorted = sorted(line['words'], key=lambda w: w['x0'])
            seg = []
            prev = None
            for w in words_sorted:
                if prev is None:
                    seg = [w]
                else:
                    gap = w['x0'] - prev['x1']
                    if gap > line['font_size'] * 1.5:
                        segments.append(seg)
                        seg = [w]
                    else:
                        seg.append(w)
                prev = w
            if seg:
                segments.append(seg)

        line_segments = []
        for seg in segments:
            seg_text = ' '.join([s['text'] for s in seg]).strip()
            if not seg_text:
                continue
            x0 = min(s['x0'] for s in seg)
            y0 = min(s['y0'] for s in seg)
            x1 = max(s['x1'] for s in seg)
            y1 = max(s['y1'] for s in seg)
            font_size = max(s['font_size'] for s in seg)
            line_segments.append({
                'text': seg_text,
                'x0': x0,
                'y0': y0,
                'x1': x1,
                'y1': y1,
                'font_size': font_size,
            })

        line_segments.sort(key=lambda s: (s['y0'], s['x0']))
        blocks = []
        current = []
        for seg in line_segments:
            if not current:
                current = [seg]
                continue
            prev = current[-1]
            y_gap = seg['y0'] - prev['y1']
            same_line = abs(seg['y0'] - prev['y0']) <= (prev['font_size'] * 0.5)
            x_gap = seg['x0'] - prev['x1']
            if y_gap > prev['font_size'] * 1.5 or (same_line and x_gap > prev['font_size'] * 1.5):
                blocks.append(current)
                current = [seg]
            else:
                current.append(seg)
        if current:
            blocks.append(current)

        for block in blocks:
            block_sorted = sorted(block, key=lambda s: (s['y0'], s['x0']))
            content_parts = []
            prev = None
            for seg in block_sorted:
                if prev is None:
                    content_parts.append(seg['text'])
                else:
                    y_gap = seg['y0'] - prev['y1']
                    if y_gap > prev['font_size'] * 0.5:
                        content_parts.append('\n' + seg['text'])
                    else:
                        content_parts.append(' ' + seg['text'])
                prev = seg
            content = ''.join(content_parts).strip()
            if not content:
                continue
            x0 = min(s['x0'] for s in block)
            y0 = min(s['y0'] for s in block)
            x1 = max(s['x1'] for s in block)
            y1 = max(s['y1'] for s in block)
            font_size = max(s['font_size'] for s in block)
            role = _text_role(font_size)
            comp = {
                'id': str(uuid.uuid4()),
                'type': 'text',
                'role': role,
                'bbox': {'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0},
                'content': content,
                'style': {
                    'font_name': '',
                    'font_size': float(font_size),
                    'color': '#000000',
                },
            }
            components.append(comp)

        image_list = page.get_images(full=True)
        seen_xrefs = set()
        for img in image_list:
            try:
                xref = img[0]
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)
                base_image = doc.extract_image(xref)
                image_bytes = base_image.get('image')
                if not image_bytes:
                    continue
                width = int(base_image.get('width', 0))
                height = int(base_image.get('height', 0))
                rects = page.get_image_rects(xref)
                for rect in rects:
                    rect_w = float(rect.width)
                    rect_h = float(rect.height)
                    area = rect_w * rect_h
                    if area < 500:
                        continue
                    if rect_h > 0 and (rect_w / rect_h) > 15:
                        continue
                    if rect_w > page_w * 0.8:
                        continue
                    if rect.x0 < 10 and rect_w > page_w * 0.5:
                        continue
                    role = _image_role_for_rect(rect, page_w, page_h)
                    comp = {
                        'id': str(uuid.uuid4()),
                        'type': 'image',
                        'role': role,
                        'bbox': {'x': float(rect.x0), 'y': float(rect.y0), 'w': rect_w, 'h': rect_h},
                        'image_bytes_b64': base64.b64encode(image_bytes).decode('ascii'),
                        'image_width': width,
                        'image_height': height,
                        'classification_confidence': 0.9,
                    }
                    components.append(comp)
            except Exception as e:
                logger.warning('Image extract failed: %s', e)
        drawings = page.get_drawings()
        for draw in drawings:
            bbox = draw.get('rect')
            if not bbox:
                continue
            x0, y0, x1, y1 = bbox
            svg, n_vertices = _drawing_to_svg(draw, page_w, page_h)
            w, h = x1 - x0, y1 - y0
            area = w * h
            role = 'decorative_shape'
            if n_vertices <= 4 and (w < 5 or h < 5):
                role = 'divider'
            elif area < (page_w * page_h * 0.05) and n_vertices > 10:
                role = 'logo'
            elif area > (page_w * page_h * 0.3):
                role = 'decorative_shape'

            comp = {
                'id': str(uuid.uuid4()),
                'type': 'vector',
                'role': role,
                'bbox': {'x': x0, 'y': y0, 'w': w, 'h': h},
                'svg_path': svg,
                'classification_confidence': 0.9,
            }
            components.append(comp)

        pages_out.append({
            'page_index': page_index,
            'width': page_w,
            'height': page_h,
            'components': components,
        })

    return {
        'pipeline_type': 'vector',
        'pages': pages_out,
    }
