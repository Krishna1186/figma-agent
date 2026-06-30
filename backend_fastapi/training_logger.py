import json
import os
import threading
import time
import uuid
from typing import Any, Dict, Optional

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
LOG_PATH = os.path.join(DATA_DIR, 'training_log.jsonl')
_LOCK = threading.Lock()


def _ensure_dir() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)


def log_classification(signals: Dict[str, Any], predicted_label: str, confidence: float, image_id: str) -> str:
    """
    Append a classification record to the JSONL log and return its id.
    """
    _ensure_dir()
    record_id = str(uuid.uuid4())
    record = {
        'id': record_id,
        'timestamp': time.time(),
        'image_id': image_id,
        'signals': signals,
        'predicted_label': predicted_label,
        'prediction_confidence': float(confidence),
        'human_label': None,
        'was_corrected': False,
    }
    line = json.dumps(record, ensure_ascii=True)
    with _LOCK:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    return record_id


def log_correction(classification_id: str, human_label: str) -> bool:
    """
    Update the record with the given id, set human_label, and mark corrected.
    Returns True if updated.
    """
    if not os.path.exists(LOG_PATH):
        return False
    updated = False
    with _LOCK:
        with open(LOG_PATH, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        new_lines = []
        for line in lines:
            try:
                record = json.loads(line)
            except Exception:
                new_lines.append(line)
                continue
            if record.get('id') == classification_id:
                record['human_label'] = human_label
                record['was_corrected'] = True
                updated = True
                new_lines.append(json.dumps(record, ensure_ascii=True) + '\n')
            else:
                new_lines.append(line)
        if updated:
            with open(LOG_PATH, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
    return updated


def count_records() -> int:
    if not os.path.exists(LOG_PATH):
        return 0
    with _LOCK:
        with open(LOG_PATH, 'r', encoding='utf-8') as f:
            return sum(1 for _ in f)


def iter_records() -> Optional[list]:
    if not os.path.exists(LOG_PATH):
        return None
    with _LOCK:
        with open(LOG_PATH, 'r', encoding='utf-8') as f:
            out = []
            for line in f:
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
            return out
