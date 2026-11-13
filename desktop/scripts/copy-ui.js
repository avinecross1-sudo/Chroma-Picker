// Copies the shared panel UI from ../plugin into ./ui so the desktop app ships the same code as the
// Photoshop plugin. ./ui is generated: edit files under plugin/, not here.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'plugin'), dst = path.join(__dirname, '..', 'ui');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (p) => !/manifest\.json$/.test(p) });
// The desktop app also draws the 3D view on the graphics card (UXP panels have no WebGL, so the plugin does not).
fs.copyFileSync(path.join(__dirname, '..', 'gpu', 'gpu-render.js'), path.join(dst, 'js', 'gpu-render.js'));
const html = path.join(dst, 'index.html');
fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<script src="js/render.js"></script>', '<script src="js/render.js"></script>\n  <script src="js/gpu-render.js"></script>'));
console.log('Copied plugin UI to', path.relative(process.cwd(), dst) || dst);
