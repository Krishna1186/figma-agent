import base64
import io
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Tuple

logger = logging.getLogger('decomposer')


def now_ts() -> float:
    return time.time()


@dataclass
class StageTiming:
    name: str
    start: float

    def end(self) -> float:
        return time.time() - self.start


class Timer:
    def __init__(self) -> None:
        self._starts: Dict[str, float] = {}

    def start(self, name: str) -> None:
        self._starts[name] = time.time()

    def stop(self, name: str) -> float:
        start = self._starts.pop(name, None)
        if start is None:
            return 0.0
        return time.time() - start


def encode_b64(data: bytes) -> str:
    return base64.b64encode(data).decode('ascii')


def decode_b64(data_b64: str) -> bytes:
    return base64.b64decode(data_b64)


def safe_json_loads(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None


def chunked(iterable: List[Any], n: int) -> Iterator[List[Any]]:
    for i in range(0, len(iterable), n):
        yield iterable[i:i + n]
