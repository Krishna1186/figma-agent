import asyncio
import base64
import importlib
import json
import logging
import os
import queue
import threading
import time
import uuid
from functools import partial
from typing import Dict

import fitz
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from model_trainer import train_classifier
from pipeline_raster import run_raster_pipeline
from pipeline_vector import extract_vector_manifest
from training_logger import log_correction
from utils import safe_json_loads

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('decomposer')

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
JOBS: Dict[str, Dict[str, object]] = {}


class JobRequest(BaseModel):
    job_id: str


class CorrectionRequest(BaseModel):
    classification_id: str
    human_label: str


class EditRequest(BaseModel):
    manifest: dict
    instruction: str


class DecomposeRequest(BaseModel):
    filename: str
    mime_type: str
    file_b64: str


SUPPORTED_IMAGE_TYPES = {'image/png', 'image/jpeg', 'image/jpg'}


def _detect_pipeline(file_bytes: bytes, content_type: str) -> str:
    if content_type == 'application/pdf':
        try:
            doc = fitz.open(stream=file_bytes, filetype='pdf')
            page = doc.load_page(0)
            text = page.get_text()
            return 'vector' if text and text.strip() else 'raster'
        except Exception as e:
            logger.warning('PDF detect failed, defaulting raster: %s', e)
            return 'raster'
    return 'raster'


def _rasterize_pdf_first_page(file_bytes: bytes) -> bytes:
    doc = fitz.open(stream=file_bytes, filetype='pdf')
    page = doc.load_page(0)
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    return pix.tobytes('png')


@app.get('/health')
async def health():
    modules = [
        'numpy',
        'cv2',
        'PIL',
        'fitz',
        'fastapi',
        'pydantic',
        'paddleocr',
        'scipy',
        'sklearn',
        'joblib',
        'rembg',
        'onnxruntime',
        'torch',
        'torchvision',
        'transformers',
        'google.genai',
        'segment_anything',
        'pipeline_vector',
        'pipeline_raster',
        'spectral_segmentation',
        'signal_extractor',
        'classifier',
        'training_logger',
        'model_trainer',
        'utils',
    ]
    loaded = {}
    failed = {}
    for mod in modules:
        try:
            importlib.import_module(mod)
            loaded[mod] = True
        except Exception as e:
            failed[mod] = str(e)
    status = 'ok' if not failed else 'degraded'
    return {'status': status, 'loaded': loaded, 'failed': failed}


@app.post('/decompose')
async def decompose(req: DecomposeRequest):
    print(f"[decompose] received {req.filename} ({req.mime_type}), b64 length={len(req.file_b64)}", flush=True)
    try:
        b64 = req.file_b64
        if ',' in b64:
            b64 = b64.split(',', 1)[1]
        file_bytes = base64.b64decode(b64)

        print(f"[decompose] decoded {len(file_bytes)} bytes, routing to pipeline...", flush=True)
        loop = asyncio.get_event_loop()

        if 'pdf' in req.mime_type.lower() or req.filename.lower().endswith('.pdf'):
            result = await asyncio.wait_for(
                loop.run_in_executor(None, partial(extract_vector_manifest, file_bytes)),
                timeout=60.0,
            )
        else:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, partial(run_raster_pipeline, file_bytes, lambda *_: None)),
                timeout=60.0,
            )

        print('[decompose] pipeline complete, returning result', flush=True)
        return result
    except asyncio.TimeoutError:
        print('[decompose] TIMEOUT after 60s', flush=True)
        return {'error': 'Pipeline timed out after 60 seconds'}
    except Exception as e:
        import traceback

        print('[decompose] EXCEPTION:', traceback.format_exc(), flush=True)
        return {'error': str(e), 'trace': traceback.format_exc()}


@app.post('/upload')
async def upload(file: UploadFile = File(None), request: Request = None):
    if file is None:
        body = await request.body()
        content_type = request.headers.get('content-type', '')
        if not body:
            return JSONResponse({'error': 'No file uploaded'}, status_code=400)
        file_bytes = body
        filename = 'upload.bin'
        ctype = content_type
    else:
        file_bytes = await file.read()
        filename = file.filename or 'upload.bin'
        ctype = file.content_type or 'application/octet-stream'

    if not file_bytes:
        return JSONResponse({'error': 'Empty file'}, status_code=400)

    pipeline_type = _detect_pipeline(file_bytes, ctype)
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        'bytes': file_bytes,
        'filename': filename,
        'content_type': ctype,
        'pipeline_type': pipeline_type,
        'created_at': time.time(),
    }
    return {'job_id': job_id, 'pipeline_type': pipeline_type}


@app.post('/process/vector')
async def process_vector(req: JobRequest):
    job = JOBS.get(req.job_id)
    if not job:
        return JSONResponse({'error': 'Unknown job_id'}, status_code=404)
    if job.get('content_type') != 'application/pdf':
        return JSONResponse({'error': 'Vector pipeline requires PDF'}, status_code=400)
    manifest = extract_vector_manifest(job['bytes'])
    return manifest


def _sse_event(data: Dict[str, object]) -> str:
    return f"data: {json.dumps(data)}\n\n"


@app.post('/process/raster')
async def process_raster(req: JobRequest, stream: bool = False):
    job = JOBS.get(req.job_id)
    if not job:
        return JSONResponse({'error': 'Unknown job_id'}, status_code=404)

    bytes_in = job['bytes']
    if job.get('content_type') == 'application/pdf':
        bytes_in = _rasterize_pdf_first_page(bytes_in)

    if not stream:
        manifest = run_raster_pipeline(bytes_in, lambda *_: None)
        return JSONResponse(manifest)

    q: queue.Queue = queue.Queue()

    def cb(stage: str, pct: float, message: str) -> None:
        q.put({'type': 'progress', 'stage': stage, 'progress': pct, 'message': message})

    def worker():
        try:
            manifest = run_raster_pipeline(bytes_in, cb)
            q.put({'type': 'result', 'manifest': manifest})
        except Exception as e:
            q.put({'type': 'error', 'message': str(e)})
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def gen():
        while True:
            item = q.get()
            if item is None:
                break
            yield _sse_event(item)

    return StreamingResponse(gen(), media_type='text/event-stream')


@app.post('/correction')
async def correction(req: CorrectionRequest):
    ok = log_correction(req.classification_id, req.human_label)
    return {'ok': ok}


@app.post('/retrain')
async def retrain():
    result = train_classifier()
    return result


@app.post('/edit')
async def edit(req: EditRequest):
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        return JSONResponse({'error': 'GEMINI_API_KEY not set'}, status_code=400)

    try:
        from google import genai

        client = genai.Client(api_key=api_key)

        tool_spec = (
            'Tools available: update_text(node_id, new_content), update_style(node_id, property, value), '
            'reposition(node_id, x, y), resize(node_id, w, h), swap_image(node_id, description), '
            'duplicate(node_id), delete(node_id).'
        )
        prompt = (
            'You are a layout editing agent. Given a component manifest and an instruction, '
            'return a JSON array of tool calls. Each item: {"tool": "...", "args": {...}}. No extra text.\n'
            f'{tool_spec}\n'
            f'Instruction: {req.instruction}\n'
            f'Manifest: {json.dumps(req.manifest)}'
        )
        res = client.models.generate_content(model='gemini-2.5-pro', contents=prompt)
        text = res.text if hasattr(res, 'text') else '[]'
        parsed = safe_json_loads(text)
        if not isinstance(parsed, list):
            return JSONResponse({'error': 'Invalid tool call response'}, status_code=500)
        return {'tool_calls': parsed}
    except Exception as e:
        return JSONResponse({'error': str(e)}, status_code=500)



