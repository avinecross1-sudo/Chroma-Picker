// Copies the shared panel UI from ../plugin into ./ui so the desktop app ships the same code as the
// Photoshop plugin. ./ui is generated: edit files under plugin/, not here.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'plugin'), dst = path.join(__dirname, '..', 'ui');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (p) => !/manifest\.json$/.test(p) });
console.log('Copied plugin UI to', path.relative(process.cwd(), dst) || dst);
