/**
 * Figma plugin main thread. Listens for messages from the UI (prompt text),
 * calls the backend to get design ops, then applies them.
 */

const BACKEND_URL = 'http://localhost:3000';

figma.showUI(__html__, { width: 360, height: 320 });

figma.ui.onmessage = async (msg: { type: string; prompt?: string; backendUrl?: string }) => {
  if (msg.type === 'run' && msg.prompt) {
    try {
      const url = (msg.backendUrl || BACKEND_URL).replace(/\/$/, '') + '/api/design-ops';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: msg.prompt,
          selectionIds: figma.currentPage.selection.map((n) => n.id),
          pageSummary: getPageSummary(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { ops } = await res.json();
      applyDesignOps(ops);
      figma.ui.postMessage({ type: 'done', ops: ops?.length ?? 0 });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: String(e) });
    }
  }
};

function getPageSummary(): string {
  const nodes = figma.currentPage.children.slice(0, 20);
  return nodes
    .map((n, i) => `${i + 1}. ${n.name} (${n.type})`)
    .join('\n');
}

function applyDesignOps(ops: Array<{ action: string; [k: string]: unknown }>): void {
  if (!Array.isArray(ops)) return;
  for (const op of ops) {
    try {
      if (op.action === 'createFrame') {
        const frame = figma.createFrame();
        frame.name = String(op.name ?? 'Frame');
        frame.resize(Number(op.width) || 200, Number(op.height) || 120);
        if (op.x != null && op.y != null) frame.x = Number(op.x);
        if (op.y != null) frame.y = Number(op.y);
        if (op.fills && typeof op.fills === 'string') {
          frame.fills = [{ type: 'SOLID', color: hexToRgb(op.fills) }];
        }
        figma.currentPage.appendChild(frame);
        figma.currentPage.selection = [frame];
      } else if (op.action === 'setText' && op.nodeId && op.value != null) {
        const node = figma.getNodeById(String(op.nodeId)) as TextNode | null;
        if (node && 'characters' in node) node.characters = String(op.value);
      } else if (op.action === 'setFill' && op.nodeId && op.color) {
        const node = figma.getNodeById(String(op.nodeId)) as GeometryMixin | null;
        if (node && 'fills' in node) node.fills = [{ type: 'SOLID', color: hexToRgb(String(op.color)) }];
      }
    } catch (_) {
      // skip failed op
    }
  }
}

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace(/^#/, ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
