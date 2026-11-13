// Copies the shared panel UI from ../plugin into ./ui, adds the GPU renderer and the Tauri bridge.
// ./ui is generated: edit files under plugin/ (and desktop/gpu/, desktop-tauri/tauri-bridge.js), not here.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), dst = path.join(__dirname, '..', 'ui');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(path.join(root, 'plugin'), dst, { recursive: true, filter: (p) => !/manifest\.json$/.test(p) });
fs.copyFileSync(path.join(root, 'desktop', 'gpu', 'gpu-render.js'), path.join(dst, 'js', 'gpu-render.js'));
fs.copyFileSync(path.join(__dirname, '..', 'tauri-bridge.js'), path.join(dst, 'js', 'tauri-bridge.js'));
const html = path.join(dst, 'index.html');
let s = fs.readFileSync(html, 'utf8');
const tags = { render: '<script src="js/render.js"></script>', bridge: '<script src="js/bridge.js"></script>' };
if (!s.includes(tags.render) || !s.includes(tags.bridge)) throw new Error('index.html no longer has the expected script tags');
s = s.replace(tags.render, tags.render + '\n  <script src="js/gpu-render.js"></script>')
     .replace(tags.bridge, '<script src="js/tauri-bridge.js"></script>\n  ' + tags.bridge);
fs.writeFileSync(html, s);
console.log('Copied plugin UI to', path.relative(process.cwd(), dst) || dst);
