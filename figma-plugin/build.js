const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = __dirname;
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const uiHtmlPath = path.join(root, 'ui.html');
const uiHtml = fs.readFileSync(uiHtmlPath, 'utf8');

(async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'code.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2017'],
    write: false,
    logLevel: 'info'
  });

  const bundleText = String(result.outputFiles[0].text || '')
    .replace(/\nexport\s*\{\s*\};?\s*$/m, '\n');

  const wrapped = `(function(){\nvar __html__ = ${JSON.stringify(uiHtml)};\n${bundleText}\n})();\n`;

  fs.writeFileSync(path.join(distDir, 'code.js'), wrapped, 'utf8');
  fs.writeFileSync(path.join(distDir, 'ui.html'), uiHtml, 'utf8');

  console.log('Built dist/code.js with explicit wrapper and dist/ui.html');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
