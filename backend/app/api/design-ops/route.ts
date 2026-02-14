import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a design assistant. Given a user prompt and optional context (selection IDs, page summary), output a JSON array of design operations only. No markdown, no explanation.
Actions:
- createFrame: { "action": "createFrame", "name": string, "width": number, "height": number, "x"?: number, "y"?: number, "fills"?: hex string }
- setText: { "action": "setText", "nodeId": string, "value": string }
- setFill: { "action": "setFill", "nodeId": string, "color": hex string }
Output only a single JSON array, e.g. [{"action":"createFrame","name":"Card","width":200,"height":120,"fills":"#4A90D9"}]`;

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 });
  }
  try {
    const body = await req.json();
    const { prompt, selectionIds, pageSummary } = body;
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 });
    }

    const userContent = [
      `Prompt: ${prompt}`,
      selectionIds?.length ? `Selection IDs: ${selectionIds.join(', ')}` : '',
      pageSummary ? `Page summary:\n${pageSummary}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '[]';
    const json = raw.replace(/^```json?\s*|\s*```$/g, '');
    const ops = JSON.parse(json);
    return NextResponse.json({ ops: Array.isArray(ops) ? ops : [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
