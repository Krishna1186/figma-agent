import io
import logging
import os
from typing import Dict, Tuple

import numpy as np
from PIL import Image

from training_logger import count_records
from utils import safe_json_loads

logger = logging.getLogger('decomposer')

LABELS = ['background', 'text', 'logo', 'photograph', 'illustration', 'decorative_shape']
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'data', 'classifier.joblib')


def heuristic_scores(signals: Dict[str, float]) -> Dict[str, float]:
    scores = {label: 0.0 for label in LABELS}

    area_ratio = signals.get('area_ratio', 0.0)
    color_std = signals.get('color_std', 0.0)
    high_freq_ratio = signals.get('high_freq_ratio', 0.0)
    is_centered = signals.get('is_centered', 0.0) > 0.5
    ocr_confidence = signals.get('ocr_confidence', 0.0)
    text_coverage = signals.get('text_coverage', 0.0)
    aspect_ratio = signals.get('aspect_ratio', 0.0)
    edge_density = signals.get('edge_density', 0.0)
    mean_saturation = signals.get('mean_saturation', 0.0)
    circularity = signals.get('circularity', 0.0)
    n_vertices = signals.get('n_vertices', 0.0)
    unique_colors = signals.get('unique_colors', 0.0)
    mean_value = signals.get('mean_value', 0.0)
    rectangularity = signals.get('rectangularity', 0.0)
    is_top_area = signals.get('is_top_area', 0.0) > 0.5

    # Background
    if area_ratio > 0.35:
        scores['background'] += 3.0
    if color_std < 20:
        scores['background'] += 1.5
    if high_freq_ratio < 0.25:
        scores['background'] += 1.0
    if is_centered and area_ratio > 0.3:
        scores['background'] += 1.0

    # Text
    if ocr_confidence > 0.7:
        scores['text'] += 4.0
    if text_coverage > 0.4:
        scores['text'] += 2.0
    if aspect_ratio > 4:
        scores['text'] += 1.5
    if edge_density > 0.08 and area_ratio < 0.1:
        scores['text'] += 1.0

    # Logo
    if area_ratio < 0.06 and mean_saturation > 150:
        scores['logo'] += 2.0
    if circularity > 0.6 or n_vertices <= 8:
        scores['logo'] += 1.5
    if is_top_area and is_centered:
        scores['logo'] += 1.0
    if unique_colors < 30 and area_ratio < 0.08:
        scores['logo'] += 1.0

    # Photograph
    if high_freq_ratio > 0.55:
        scores['photograph'] += 2.5
    if unique_colors > 300:
        scores['photograph'] += 2.0
    if area_ratio > 0.15 and edge_density < 0.08:
        scores['photograph'] += 1.0

    # Illustration
    if unique_colors > 100 and high_freq_ratio < 0.4:
        scores['illustration'] += 2.0
    if n_vertices > 15 and color_std > 30:
        scores['illustration'] += 1.5

    # Decorative shape
    if n_vertices <= 6 and area_ratio < 0.1:
        scores['decorative_shape'] += 2.5
    if color_std < 10:
        scores['decorative_shape'] += 1.5
    if rectangularity > 0.85 and aspect_ratio > 3:
        scores['decorative_shape'] += 1.5

    return scores


def _scores_to_prediction(scores: Dict[str, float]) -> Tuple[str, float]:
    total = sum(scores.values())
    if total <= 1e-6:
        return 'decorative_shape', 0.01
    label = max(scores, key=scores.get)
    confidence = float(scores[label] / total)
    return label, confidence


def _load_model():
    if not os.path.exists(MODEL_PATH):
        return None
    try:
        import joblib
        return joblib.load(MODEL_PATH)
    except Exception as e:
        logger.warning('Failed to load model: %s', e)
        return None


def _model_predict(signals: Dict[str, float]) -> Tuple[str, float]:
    bundle = _load_model()
    if bundle is None:
        return '', 0.0
    model = bundle.get('model')
    encoder = bundle.get('label_encoder')
    feature_keys = bundle.get('feature_keys')
    if model is None or encoder is None or feature_keys is None:
        return '', 0.0
    vec = np.array([[signals.get(k, 0.0) for k in feature_keys]], dtype=np.float32)
    proba = model.predict_proba(vec)[0]
    idx = int(np.argmax(proba))
    label = str(encoder.inverse_transform([idx])[0])
    confidence = float(proba[idx])
    return label, confidence


def _gemini_classify(crop_rgb: np.ndarray) -> Tuple[str, float]:
    try:
        from google import genai

        api_key = os.environ.get('GEMINI_API_KEY')
        if not api_key:
            return '', 0.0

        client = genai.Client(api_key=api_key)
        img = Image.fromarray(crop_rgb)
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        prompt = (
            'Classify this image region as exactly one of: '
            'background, text, logo, photograph, illustration, decorative_shape. '
            'Return JSON: {"type": "...", "confidence": 0-1}.'
        )
        res = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[
                prompt,
                genai.types.Part.from_bytes(data=buf.getvalue(), mime_type='image/png'),
            ],
        )
        text = res.text if hasattr(res, 'text') else ''
        parsed = safe_json_loads(text) or {}
        label = parsed.get('type', '')
        confidence = float(parsed.get('confidence', 0.0))
        if label not in LABELS:
            return '', 0.0
        return label, confidence
    except Exception as e:
        logger.warning('Gemini fallback failed: %s', e)
        return '', 0.0


def classify_component(signals: Dict[str, float], crop_rgb: np.ndarray) -> Tuple[str, float, str]:
    """
    Returns (label, confidence, tier_used).
    """
    scores = heuristic_scores(signals)
    h_label, h_conf = _scores_to_prediction(scores)
    tier_used = 'heuristic'

    if count_records() >= 30 and os.path.exists(MODEL_PATH):
        m_label, m_conf = _model_predict(signals)
        if m_label:
            blended_conf = 0.4 * h_conf + 0.6 * m_conf
            label = m_label
            confidence = float(blended_conf)
            tier_used = 'model'
        else:
            label, confidence = h_label, h_conf
    else:
        label, confidence = h_label, h_conf

    if confidence < 0.45:
        g_label, g_conf = _gemini_classify(crop_rgb)
        if g_label:
            label, confidence = g_label, float(g_conf)
            tier_used = 'gemini_fallback'

    logger.info('Classifier tier=%s label=%s conf=%.3f', tier_used, label, confidence)
    return label, confidence, tier_used
