// Renders build/icon.png (512 px) with the app's own renderer, matching the plugin icon.
const path = require('path'), fs = require('fs');
const dir = path.join(__dirname, '..', '..', 'plugin', 'js');
globalThis.CPColor = require(path.join(dir, 'color.js'));
const R = require(path.join(dir, 'render.js')), P = require(path.join(dir, 'png.js')), C = globalThis.CPColor;
const lin = h => C.rgbToLinear(C.hexToRgb(h));
const S = { albedo: lin('#D2643C'), sky: lin('#3A4A6A'), horizon: lin('#3A4A6A'), ground: lin('#2A2A33'), groundEnv: lin('#2A2A33'),
  lights: [{ dir: R.dirFromAngles(50, 40), color: lin('#FFF3E2'), intensity: 1.1, spot: false }], ambient: 0.6, specular: 0.5, reflectivity: 0.1,
  subsurface: 0.2, toon: false, chrome: false, fog: 0, contrast: 1, shape: 'sphere', yaw: 20, pitch: 5, split: null };
const n = 512, big = Math.round(n * 1.7), r = R.render(S, big, big, 1), o = new Uint8Array(n * n * 3);
const off = Math.round((big - n) / 2), offY = Math.round((big - n) / 2.6);
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) o[(y * n + x) * 3 + c] = r.rgb[((y + offY) * big + x + off) * 3 + c];
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), P.encode(o, n, n));
console.log('Wrote build/icon.png');
