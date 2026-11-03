// Renders the plugin icons with the plugin's own renderer.
const path = require('path'), fs = require('fs');
const dir = path.join(__dirname, '..', 'plugin', 'js');
globalThis.CPColor = require(path.join(dir, 'color.js'));
const R = require(path.join(dir, 'render.js')), P = require(path.join(dir, 'png.js')), C = globalThis.CPColor;
const lin = h => C.rgbToLinear(C.hexToRgb(h));
function scene(){ return { albedo: lin('#D2643C'), sky: lin('#3A4A6A'), horizon: lin('#3A4A6A'), ground: lin('#2A2A33'), groundEnv: lin('#2A2A33'),
  lightDir: R.dirFromAngles(50, 40), lightColor: lin('#FFF3E2'), intensity: 1.1, ambient: 0.6, spot:false, specular:0.5, reflectivity:0.1,
  subsurface:0.2, toon:false, chrome:false, fog:0, contrast:1, shape:'sphere', yaw:20, pitch:5, split:null }; }
const out = path.join(__dirname, '..', 'plugin', 'icons');
for (const [name, size] of [['panel',23],['plugin',48]]) {
  for (const s of [1,2]) {
    const n = size*s, S = scene();
    // tighter framing: narrow camera by rendering larger then crop center
    const big = Math.round(n*1.7), r = R.render(S, big, big, 3), o = new Uint8Array(n*n*3), off = Math.round((big-n)/2), offY = Math.round((big-n)/2.6);
    for (let y=0;y<n;y++) for (let x=0;x<n;x++) for (let c=0;c<3;c++) o[(y*n+x)*3+c] = r.rgb[((y+offY)*big + x+off)*3+c];
    const png = P.encode(o, n, n);
    fs.writeFileSync(path.join(out, `${name}@${s}x.png`), png);
    if (s===1) fs.writeFileSync(path.join(out, `${name}.png`), png);
  }
}
console.log(fs.readdirSync(out));
