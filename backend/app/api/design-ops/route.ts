import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';

const SYSTEM_PROMPT = `You are an expert Figma design assistant. Turn natural-language instructions into a precise JSON array of design operations. Parse every parameter (colors, gradients, strokes, shadows, typography, layout, transform, etc.), break the request into one logical change per op, and use semantic targets (by name or selection).

Important behavior rules:
- If the prompt is an edit or refers to existing content, update existing nodes rather than creating new ones.
- If there is a selection, prefer targeting it when the prompt is ambiguous.
- Preserve existing size and position unless the user explicitly asks to change them.

## Context you receive
- Prompt: User's request. They may refer to "the uploaded image" or "attached image" if they attached one.
- hasAttachedImage: true if user uploaded an image in the plugin. Use placeImage with "source": "attached" to place it (no url).
- Selection: Current selection with id, name, type, x, y, width, height, absX, absY. Use target { "findBy": "selection", "index": 0 }.
- Page structure: Nodes with id, name, type, x, y, width, height, absX, absY, fills/strokes summary, text summary, layout summary, and children. Use { "findBy": "name", "value": "Heading" } or { "findBy": "nameContains", "value": "Card" }.

## Target format
- "target": "nodeId:xxx" or raw id string
- "target": { "findBy": "name", "value": "Exact Name" }
- "target": { "findBy": "nameContains", "value": "substring" }
- "target": { "findBy": "selection", "index": 0 }
Use "parent" for ops that create nodes inside another node.

## Design operations (output only a JSON array; no markdown)

Create
1. createFrame - { "action": "createFrame", "name": string, "width": number, "height": number, "x"?: number, "y"?: number, "fills"?: hex or gradient object, "layoutMode"?: "HORIZONTAL"|"VERTICAL"|"NONE", "padding"?: number, "itemSpacing"?: number, "primaryAxisAlign"?: "MIN"|"CENTER"|"MAX"|"SPACE_BETWEEN", "counterAxisAlign"?: "MIN"|"CENTER"|"MAX" }
2. createText - { "action": "createText", "name"?: string, "content": string, "fontSize"?: number, "fontWeight"?: 100-900, "color"?: hex, "x"?: number, "y"?: number, "parent"?: target }
3. createRectangle - { "action": "createRectangle", "name"?: string, "width": number, "height": number, "x"?: number, "y"?: number, "cornerRadius"?: number or { "topLeft"?: number, "topRight"?: number, "bottomRight"?: number, "bottomLeft"?: number }, "fills"?: hex or gradient object, "parent"?: target }
4. createEllipse - { "action": "createEllipse", "name"?: string, "width": number, "height": number, "x"?: number, "y"?: number, "fills"?: hex, "parent"?: target }
5. createGroup - { "action": "createGroup", "name"?: string, "targets": [target, ...], "parent"?: target }

Fills and strokes
6. setFill - { "action": "setFill", "target": target, "color": hex }
7. setGradient - { "action": "setGradient", "target": target, "type": "linear"|"radial"|"angular"|"diamond", "angle"?: number (degrees), "colorStops": [{ "color": hex, "stop": 0-1 }], "opacity"?: 0-1 }
8. setStroke - { "action": "setStroke", "target": target, "color": hex, "weight"?: number (default 1), "align"?: "INSIDE"|"OUTSIDE"|"CENTER" }

Effects
9. setOpacity - { "action": "setOpacity", "target": target, "opacity": 0-1 }
10. setDropShadow - { "action": "setDropShadow", "target": target, "x"?: number, "y"?: number, "blur": number, "color": hex, "spread"?: number }
11. setInnerShadow - { "action": "setInnerShadow", "target": target, "x"?: number, "y"?: number, "blur": number, "color": hex }
12. setBlur - { "action": "setBlur", "target": target, "radius": number }

Shape
13. setCornerRadius - { "action": "setCornerRadius", "target": target, "radius"?: number (all corners) or "topLeft"?: number, "topRight"?: number, "bottomRight"?: number, "bottomLeft"?: number }

Text
14. setText - { "action": "setText", "target": target, "value": string }
15. setFontSize - { "action": "setFontSize", "target": target, "value": number }
16. setFontWeight - { "action": "setFontWeight", "target": target, "value": 100-900 }
17. setTextAlign - { "action": "setTextAlign", "target": target, "horizontal"?: "LEFT"|"CENTER"|"RIGHT"|"JUSTIFIED", "vertical"?: "TOP"|"CENTER"|"BOTTOM" }
18. setLineHeight - { "action": "setLineHeight", "target": target, "value": number (px) or { "unit": "PERCENT", "value": number } }
19. setLetterSpacing - { "action": "setLetterSpacing", "target": target, "value": number (px) or { "unit": "PERCENT", "value": number } }

Layout
20. setAutoLayout - { "action": "setAutoLayout", "target": target, "layoutMode"?: "HORIZONTAL"|"VERTICAL"|"NONE", "padding"?: number, "itemSpacing"?: number, "primaryAxisAlign"?: "MIN"|"CENTER"|"MAX"|"SPACE_BETWEEN", "counterAxisAlign"?: "MIN"|"CENTER"|"MAX" }

Transform
21. setPosition - { "action": "setPosition", "target": target, "x": number, "y": number }
22. resize - { "action": "resize", "target": target, "width": number, "height": number }
23. setRotation - { "action": "setRotation", "target": target, "angle": number (degrees) }

Other
24. setName - { "action": "setName", "target": target, "name": string }
25. setBlendMode - { "action": "setBlendMode", "target": target, "mode": "PASS_THROUGH"|"NORMAL"|"DARKEN"|"MULTIPLY"|"LINEAR_BURN"|"COLOR_BURN"|"LIGHTEN"|"SCREEN"|"LINEAR_DODGE"|"COLOR_DODGE"|"OVERLAY"|"SOFT_LIGHT"|"HARD_LIGHT"|"DIFFERENCE"|"EXCLUSION"|"HUE"|"SATURATION"|"COLOR"|"LUMINOSITY" }
26. placeImage - From URL: { "action": "placeImage", "url": string, "target"?: target, "name"?: string, "x"?: number, "y"?: number, "width"?: number, "height"?: number }. For uploaded image: { "action": "placeImage", "source": "attached", "target"?: target, "name"?: string, "x"?: number, "y"?: number, "width"?: number, "height"?: number }
27. duplicate - { "action": "duplicate", "target": target }
28. delete - { "action": "delete", "target": target }

Output only a single JSON array. No markdown, no explanation.`;


const OpSchema = z.object({
  action: z.string(),
}).passthrough();
const OpsSchema = z.array(OpSchema);

function stripCodeFences(raw: string): string {
  return raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
}

function parseOpsFromText(rawText: string): unknown[] {
  if (!rawText) return [];
  const cleaned = stripCodeFences(rawText.trim());
  let repaired = cleaned;
  try {
    repaired = jsonrepair(cleaned);
  } catch (_) {
    // keep cleaned if repair fails
  }
  try {
    const parsed = JSON.parse(repaired);
    const result = OpsSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch (_) {
    return [];
  }
}
async function getDesignOpsWithGemini(userContent: string): Promise<unknown[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: SYSTEM_PROMPT,
  });
  const result = await model.generateContent(userContent);
  const response = result.response;
  const text = response.text();
  if (!text) return [];
  return parseOpsFromText(text);
}

async function getDesignOpsWithOpenAI(userContent: string): Promise<unknown[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? '[]';
  return parseOpsFromText(raw);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, selection, pageStructure, hasAttachedImage } = body;
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 });
    }

    const userParts = [
      `Prompt: ${prompt}`,
      hasAttachedImage ? 'User has attached an image. Use placeImage with "source": "attached" when they refer to the uploaded/attached image.' : '',
      selection?.length
        ? `Selection:\n${JSON.stringify(selection, null, 2)}`
        : '',
      pageStructure
        ? `Page structure:\n${typeof pageStructure === 'string' ? pageStructure : JSON.stringify(pageStructure, null, 2)}`
        : '',
    ].filter(Boolean);

    const userContent = userParts.join('\n\n');

    const useGemini = !!process.env.GEMINI_API_KEY;
    const useOpenAI = !!process.env.OPENAI_API_KEY;

    if (!useGemini && !useOpenAI) {
      return NextResponse.json(
        { error: 'Set GEMINI_API_KEY (free at aistudio.google.com/apikey) or OPENAI_API_KEY in backend/.env' },
        { status: 500 }
      );
    }

    const ops = useGemini
      ? await getDesignOpsWithGemini(userContent)
      : await getDesignOpsWithOpenAI(userContent);

    return NextResponse.json({ ops });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const msgStr = String(message);
    if (msgStr.includes('429') || msgStr.includes('quota') || msgStr.includes('RESOURCE_EXHAUSTED')) {
      return NextResponse.json(
        { error: 'API quota exceeded. Try GEMINI_API_KEY (free tier) or check your OpenAI billing.' },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
