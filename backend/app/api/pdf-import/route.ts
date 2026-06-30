import { NextRequest, NextResponse } from 'next/server';
import { createCanvas } from '@napi-rs/canvas';

export const runtime = 'nodejs';

function getPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.js');
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('application/pdf')) {
      return NextResponse.json({ error: 'Expected application/pdf' }, { status: 400 });
    }

    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) {
      return NextResponse.json({ error: 'Empty PDF' }, { status: 400 });
    }

    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buf),
      disableWorker: true,
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;

    const png = canvas.toBuffer('image/png');
    const bytesBase64 = png.toString('base64');

    return NextResponse.json({
      ops: [
        {
          action: 'placeImage',
          name: 'PDF Page 1',
          bytesBase64,
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
        },
      ],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
