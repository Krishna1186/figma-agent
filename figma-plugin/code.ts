/// <reference types="@figma/plugin-typings" />
figma.showUI(__html__, { width: 400, height: 600 });

function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const bytes = new Uint8Array(Math.floor(len * 3 / 4));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i+1)];
    const c = lookup[clean.charCodeAt(i+2)];
    const d = lookup[clean.charCodeAt(i+3)];
    bytes[p++] = (a << 2) | (b >> 4);
    if (i+2 < len) bytes[p++] = ((b & 0xf) << 4) | (c >> 2);
    if (i+3 < len) bytes[p++] = ((c & 0x3) << 6) | d;
  }
  return bytes.slice(0, p);
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'render-components') {
    const data = msg.data;
    if (data.components) {
      const components = data.components;
      const frame = figma.createFrame();
      frame.name = 'Decomposed Design';
      frame.resize(data.width || components[0].bbox.w, data.height || components[0].bbox.h);
      frame.x = figma.viewport.center.x;
      frame.y = figma.viewport.center.y;
      const sorted = [...components].sort((a,b) => a.depth_order - b.depth_order);
      for (const c of sorted) {
        try {
          const bytes = base64ToBytes(c.image_bytes_b64);
          const image = figma.createImage(bytes);
          const rect = figma.createRectangle();
          rect.resize(c.bbox.w, c.bbox.h);
          rect.x = c.bbox.x; rect.y = c.bbox.y;
          rect.name = c.id;
          rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
          frame.appendChild(rect);
        } catch(e) { console.error(c.id, e); }
      }
      figma.viewport.scrollAndZoomIntoView([frame]);
      figma.notify('Done! ' + components.length + ' layers created.');
      figma.ui.postMessage({ type: 'done' });
    }
    else if (data.pages) {
      let totalLayers = 0;
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      await figma.loadFontAsync({ family: "Inter", style: "Bold" });
      for (const page of data.pages) {
        const frame = figma.createFrame();
        frame.name = 'Page ' + page.page_number;
        frame.resize(page.width, page.height);
        frame.x = figma.viewport.center.x + (page.page_number - 1) * (page.width + 40);
        frame.y = figma.viewport.center.y;
        for (const c of (page.components || [])) {
          try {
            if (c.type === 'text') {
              const t = figma.createText();
              t.x = c.bbox.x; t.y = c.bbox.y;
              t.resize(c.bbox.w, c.bbox.h);
              t.characters = c.content || '';
              if (c.style?.fontSize) t.fontSize = c.style.fontSize;
              if (c.style?.color) {
                const hex = c.style.color.replace('#','');
                const r = parseInt(hex.slice(0,2),16)/255;
                const g = parseInt(hex.slice(2,4),16)/255;
                const b = parseInt(hex.slice(4,6),16)/255;
                t.fills = [{type:'SOLID', color:{r,g,b}}];
              }
              t.name = c.role || 'text';
              frame.appendChild(t);
            } else if (c.type === 'image' && c.image_bytes_b64) {
              const bytes = base64ToBytes(c.image_bytes_b64);
              const image = figma.createImage(bytes);
              const rect = figma.createRectangle();
              rect.resize(c.bbox.w, c.bbox.h);
              rect.x = c.bbox.x; rect.y = c.bbox.y;
              rect.fills = [{type:'IMAGE', scaleMode:'FILL', imageHash: image.hash}];
              rect.name = c.id;
              frame.appendChild(rect);
            }
            totalLayers++;
          } catch(e) { console.error(c.id, e); }
        }
      }
      figma.viewport.scrollAndZoomIntoView([figma.currentPage.children[figma.currentPage.children.length-1]]);
      figma.notify('Done! ' + totalLayers + ' layers on ' + data.pages.length + ' pages.');
      figma.ui.postMessage({ type: 'done' });
    }
  }
}
