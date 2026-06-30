import json
import os
from typing import Dict, List, Tuple

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

from training_logger import iter_records

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
MODEL_PATH = os.path.join(DATA_DIR, 'classifier.joblib')

FEATURE_KEYS = [
    'area_ratio',
    'aspect_ratio',
    'rectangularity',
    'center_x',
    'center_y',
    'is_top_area',
    'is_centered',
    'color_std',
    'unique_colors',
    'mean_saturation',
    'mean_value',
    'high_freq_ratio',
    'edge_density',
    'circularity',
    'n_vertices',
    'ocr_confidence',
    'text_coverage',
]


def _build_dataset() -> Tuple[np.ndarray, np.ndarray]:
    records = iter_records() or []
    X = []
    y = []
    for rec in records:
        signals = rec.get('signals', {})
        if rec.get('was_corrected') is True and rec.get('human_label'):
            label = rec['human_label']
        elif rec.get('was_corrected') is False and rec.get('prediction_confidence', 0.0) > 0.85:
            label = rec.get('predicted_label')
        else:
            continue
        X.append([signals.get(k, 0.0) for k in FEATURE_KEYS])
        y.append(label)
    if not X:
        return np.zeros((0, len(FEATURE_KEYS)), dtype=np.float32), np.zeros((0,), dtype=np.int64)
    return np.array(X, dtype=np.float32), np.array(y)


def train_classifier() -> Dict[str, object]:
    os.makedirs(DATA_DIR, exist_ok=True)
    X, y = _build_dataset()
    if len(y) < 30:
        return {
            'status': 'not_enough_data',
            'record_count': int(len(y)),
            'message': 'Need at least 30 labeled records to train.'
        }

    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc, test_size=0.2, random_state=42, stratify=y_enc
    )

    model = GradientBoostingClassifier(n_estimators=100, max_depth=4, learning_rate=0.1)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    report = classification_report(y_test, y_pred, output_dict=True)

    bundle = {
        'model': model,
        'label_encoder': le,
        'feature_keys': FEATURE_KEYS,
        'report': report,
    }
    joblib.dump(bundle, MODEL_PATH)

    return {
        'status': 'trained',
        'record_count': int(len(y)),
        'report': report,
    }
