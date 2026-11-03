// Renders reference-style scenes to PNG for eyeballing the lighting.
// Usage: node test/preview.js <outdir>
const path = require('path'), fs = require('fs'); const dir = path.join(__dirname, '..', 'plugin', 'js');
const C = globalThis.CPColor = require(path.join(dir, 'color.js'));
const R = require(path.join(dir, 'render.js')), P = require(path.join(dir, 'png.js'));
const lin = h => C.rgbToLinear(C.hexToRgb(h)); const out = process.argv[2] || '.';
const base = { albedo: lin('#66D96A'), flatAlbedoRgb: [102, 217, 106], ambient: 0.3, specular: 0.3, reflectivity: 0, subsurface: 0,
  toon: false, chrome: false, fog: 0, contrast: 1, shape: 'trio', yaw: 25, pitch: 7, split: null,
  lights: [{ dir: R.dirFromAngles(-45, 38), color: lin('#FFF6E8'), intensity: 1.35, spot: false }] };
const envs = [
  ['emerald', '#3C9A6C', '#D8F5C8', '#FFFF7A'],
  ['amber', '#8A6020', '#E0A070', '#5AA0B8'],
  ['coral', '#88405A', '#F07858', '#5E9088'],
  ['interior', '#4A2418', '#E07830', '#FF8030'],
  ['sunny', '#3D9BEA', '#E3DDF0', '#8FB57A'],
  ['sphere', '#3D9BEA', '#E3DDF0', '#8FB57A', { shape: 'sphere' }],
];
envs.forEach(([n, sky, hor, gr, extra]) => {
  const S = Object.assign({}, base, { sky: lin(sky), horizon: lin(hor), ground: lin(gr) }, extra || {});
  const r = R.render(S, 250, 250, 2); fs.writeFileSync(path.join(out, 'ref_' + n + '.png'), P.encode(r.rgb, 250, 250));
});
