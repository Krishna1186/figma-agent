/**
 * Simple build: compile TS with tsc (emit to dist via tsconfig.build.json),
 * then inline the UI into one HTML file for manifest "ui" entry.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const uiHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Figma Agent</title></head>
<body>
  <div id="root"></div>
  <textarea id="prompt" placeholder="Describe what to create or edit..." style="width:100%;height:80px;margin:8px 0;"></textarea>
  <button id="run">Run</button>
  <pre id="log" style="font-size:11px;white-space:pre-wrap;max-height:200px;overflow:auto;"></pre>
  <script>${fs.readFileSync(path.join(__dirname, 'src', 'ui.js'), 'utf8')}</script>
</body></html>`;

fs.writeFileSync(path.join(distDir, 'ui.html'), uiHtml);
console.log('Wrote dist/ui.html');

// Inject UI HTML into main code so __html__ is available at runtime
const codePath = path.join(distDir, 'code.js');
let codeJs = fs.readFileSync(codePath, 'utf8');
codeJs = 'var __html__ = ' + JSON.stringify(uiHtml) + ';\n' + codeJs;
fs.writeFileSync(codePath, codeJs);
console.log('Injected __html__ into dist/code.js');
