/// <reference types="@figma/plugin-typings" />

import { PluginMessage } from '../shared/types';
import { FigmaNode } from '../shared/expert_schema';

figma.showUI(__html__, { width: 320, height: 480 });

// --- Font Loader (recursive) ---
async function loadFonts(node: FigmaNode) {
  if (node.type === 'TEXT') {
    // Always load the default font first — Figma assigns "Inter Regular" to new TextNodes
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    // Also load any custom font the AI specified
    if (node.fontName) {
      await figma.loadFontAsync(node.fontName as FontName);
    }
  }
  if ('children' in node && node.children) {
    for (const child of node.children) {
      await loadFonts(child);
    }
  }
}

// --- Recursive Node Builder ---
async function buildNode(schema: FigmaNode): Promise<SceneNode> {
  let node: SceneNode;

  switch (schema.type) {
    case 'FRAME':
      node = figma.createFrame();
      break;
    case 'RECTANGLE':
      node = figma.createRectangle();
      break;
    case 'TEXT':
      node = figma.createText();
      break;
    case 'IMAGE_NODE':
      node = figma.createRectangle();
      break;
    default:
      throw new Error(`Unknown node type: ${(schema as any).type}`);
  }

  // Base props
  if (schema.name) node.name = schema.name;
  if (schema.visible !== undefined) node.visible = schema.visible;
  if (schema.opacity !== undefined) node.opacity = schema.opacity;
  if (schema.blendMode) (node as any).blendMode = schema.blendMode;

  // Size
  if ('resize' in node) {
    const w = typeof (schema as any).width === 'number' ? (schema as any).width : 100;
    const h = typeof (schema as any).height === 'number' ? (schema as any).height : 100;
    node.resize(w, h);
  }

  // Fills
  if ('fills' in node && (schema as any).fills) {
    const fills: Paint[] = [];
    for (const p of (schema as any).fills) {
      if (p.type === 'SOLID') {
        const rgb = hexToRgb(p.color);
        fills.push({ type: 'SOLID', color: rgb, opacity: p.opacity ?? 1 } as SolidPaint);
      }
      if (p.type === 'GRADIENT_LINEAR') {
        fills.push({
          type: 'GRADIENT_LINEAR',
          gradientStops: (p.stops || []).map((s: any, i: number, arr: any[]) => ({
            position: s.position ?? i / Math.max(arr.length - 1, 1),
            color: { ...hexToRgb(s.color), a: 1 },
          })),
          gradientTransform: p.transform || [[1, 0, 0], [0, 1, 0]],
        } as GradientPaint);
      }
    }
    if (fills.length > 0) (node as GeometryMixin).fills = fills;
  }

  // Image
  if (schema.type === 'IMAGE_NODE' && (schema as any).imageData) {
    try {
      const raw = (schema as any).imageData as string;
      const binary = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const image = figma.createImage(binary);
      (node as RectangleNode).fills = [{
        type: 'IMAGE',
        scaleMode: 'FILL',
        imageHash: image.hash,
      }];
    } catch (e) {
      console.error('Image decode error', e);
    }
  }

  // Effects
  if ((schema as any).effects) {
    const effects: Effect[] = [];
    for (const e of (schema as any).effects) {
      if (e.type === 'DROP_SHADOW') {
        effects.push({
          type: 'DROP_SHADOW',
          color: e.color ? { ...hexToRgb(e.color), a: 0.5 } : { r: 0, g: 0, b: 0, a: 0.25 },
          offset: e.offset || { x: 0, y: 4 },
          radius: e.radius ?? 8,
          spread: e.spread ?? 0,
          visible: true,
          blendMode: 'NORMAL',
        } as DropShadowEffect);
      }
      if (e.type === 'LAYER_BLUR') {
        effects.push({
          type: 'LAYER_BLUR',
          radius: e.radius ?? 4,
          visible: true,
        } as BlurEffect);
      }
    }
    if (effects.length > 0) node.effects = effects;
  }

  // Corner Radius
  if ('cornerRadius' in node && (schema as any).cornerRadius !== undefined) {
    const cr = (schema as any).cornerRadius;
    if (typeof cr === 'number') {
      (node as RectangleNode).cornerRadius = cr;
    } else if (typeof cr === 'object') {
      (node as RectangleNode).topLeftRadius = cr.topLeft ?? 0;
      (node as RectangleNode).topRightRadius = cr.topRight ?? 0;
      (node as RectangleNode).bottomLeftRadius = cr.bottomLeft ?? 0;
      (node as RectangleNode).bottomRightRadius = cr.bottomRight ?? 0;
    }
  }

  // Strokes
  if ('strokes' in node && (schema as any).strokes) {
    const strokes: Paint[] = [];
    for (const s of (schema as any).strokes) {
      if (s.type === 'SOLID') {
        strokes.push({ type: 'SOLID', color: hexToRgb(s.color), opacity: s.opacity ?? 1 } as SolidPaint);
      }
    }
    if (strokes.length > 0) {
      (node as GeometryMixin).strokes = strokes;
      if ((schema as any).strokeWeight) (node as GeometryMixin).strokeWeight = (schema as any).strokeWeight;
      if ((schema as any).strokeAlign) (node as any).strokeAlign = (schema as any).strokeAlign;
    }
  }

  // Text
  if (node.type === 'TEXT' && schema.type === 'TEXT') {
    const tn = node as TextNode;
    // Set font before characters
    if (schema.fontName) {
      tn.fontName = schema.fontName as FontName;
    }
    if (schema.characters) tn.characters = schema.characters;
    if (schema.fontSize) tn.fontSize = schema.fontSize;
    if (schema.textAlignHorizontal) tn.textAlignHorizontal = schema.textAlignHorizontal;
    if (schema.textAlignVertical) tn.textAlignVertical = schema.textAlignVertical;
    if (schema.textDecoration) tn.textDecoration = schema.textDecoration;
    // Auto-resize prevents text clipping
    if ((schema as any).textAutoResize) {
      tn.textAutoResize = (schema as any).textAutoResize;
    } else {
      tn.textAutoResize = 'WIDTH_AND_HEIGHT';
    }
    if (schema.letterSpacing && typeof schema.letterSpacing === 'number') {
      tn.letterSpacing = { value: schema.letterSpacing, unit: 'PIXELS' };
    }
    if (schema.lineHeight && typeof schema.lineHeight === 'number') {
      tn.lineHeight = { value: schema.lineHeight, unit: 'PIXELS' };
    }
    // Text fills (color)
    if (schema.fills) {
      const textFills: Paint[] = [];
      for (const p of schema.fills) {
        if (p.type === 'SOLID') {
          textFills.push({ type: 'SOLID', color: hexToRgb(p.color), opacity: p.opacity ?? 1 } as SolidPaint);
        }
      }
      if (textFills.length > 0) tn.fills = textFills;
    }
  }

  // Auto Layout (Frame only)
  if (node.type === 'FRAME' && schema.type === 'FRAME') {
    const fn = node as FrameNode;
    if (schema.clipsContent !== undefined) fn.clipsContent = schema.clipsContent;

    if (schema.layoutMode && schema.layoutMode !== 'NONE') {
      fn.layoutMode = schema.layoutMode;
      fn.itemSpacing = schema.itemSpacing ?? 0;
      fn.paddingTop = schema.paddingTop ?? 0;
      fn.paddingRight = schema.paddingRight ?? 0;
      fn.paddingBottom = schema.paddingBottom ?? 0;
      fn.paddingLeft = schema.paddingLeft ?? 0;
      if (schema.primaryAxisAlignItems) fn.primaryAxisAlignItems = schema.primaryAxisAlignItems;
      if (schema.counterAxisAlignItems) fn.counterAxisAlignItems = schema.counterAxisAlignItems;

      // Sizing
      if (schema.width === 'HUG') fn.primaryAxisSizingMode = 'AUTO';
      else if (schema.width === 'FILL') fn.layoutAlign = 'STRETCH';
      if (schema.height === 'HUG') fn.counterAxisSizingMode = 'AUTO';
    }

    // Build children recursively
    if (schema.children) {
      for (const childSchema of schema.children) {
        await loadFonts(childSchema);
        const childNode = await buildNode(childSchema);
        fn.appendChild(childNode);
      }
    }
  }

  return node;
}

// --- Main Message Handler ---
figma.ui.onmessage = async (msg: PluginMessage) => {
  if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
    return;
  }
  if (msg.type === 'AI_ACTION') {
    try {
      const action = msg.action;

      if (action.action === 'CREATE_TREE') {
        await loadFonts(action.root);
        const rootNode = await buildNode(action.root);
        figma.currentPage.appendChild(rootNode);
        figma.currentPage.selection = [rootNode];
        figma.viewport.scrollAndZoomIntoView([rootNode]);
        figma.ui.postMessage({ type: 'success', message: 'Design created!' });
      } else if (action.action === 'UPDATE_SELECTION') {
        const sel = figma.currentPage.selection;
        if (sel.length === 0) {
          figma.ui.postMessage({ type: 'error', message: 'Nothing selected on canvas.' });
          return;
        }
        const props = action.properties;
        for (const n of sel) {
          if (props.fill && 'fills' in n) {
            (n as GeometryMixin).fills = [{ type: 'SOLID', color: hexToRgb(props.fill) } as SolidPaint];
          }
          if (props.opacity !== undefined && 'opacity' in n) (n as SceneNode & { opacity: number }).opacity = props.opacity;
          if (props.width && props.height && 'resize' in n) {
            (n as any).resize(props.width, props.height);
          }
        }
        figma.ui.postMessage({ type: 'success', message: 'Selection updated!' });
      }
    } catch (e: any) {
      console.error(e);
      figma.ui.postMessage({ type: 'error', message: e.message || 'Unknown error' });
    }
  }
};

// --- Helpers ---
function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16) / 255, g: parseInt(result[2], 16) / 255, b: parseInt(result[3], 16) / 255 }
    : { r: 0, g: 0, b: 0 };
}
