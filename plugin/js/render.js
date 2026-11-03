/* Chroma Picker - small CPU ray tracer for the lit preview.
 * Scene: a sphere or cube resting on a ground plane, lit by one key light
 * (directional sun or spot) plus a sky / horizon / ground environment. */
(function (root) {
  "use strict";
  var C = root.CPColor || (typeof require !== "undefined" ? require("./color.js") : null);

  function v3(x, y, z) { return [x, y, z]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function mulv(a, b) { return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function smooth(e0, e1, x) { var t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  var DEG = Math.PI / 180;

  var GROUND_Y = -1;
  var CUBE_H = 0.6, CUBE_C = [0, GROUND_Y + 0.6, 0], CUBE_ROT = -20 * DEG;
  var COS_R = Math.cos(CUBE_ROT), SIN_R = Math.sin(CUBE_ROT);

  function dirFromAngles(azDeg, elDeg) {
    var az = azDeg * DEG, el = elDeg * DEG;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  }

  function makeCamera(yawDeg, pitchDeg, aspect) {
    var target = [0, -0.15, 0], dist = 4.1;
    var d = dirFromAngles(yawDeg, pitchDeg);
    var pos = add(target, mul(d, dist));
    var fwd = norm(sub(target, pos));
    var right = norm(cross(fwd, [0, 1, 0]));
    var up = cross(right, fwd);
    var tanF = Math.tan(19 * DEG);
    return { pos: pos, fwd: fwd, right: right, up: up, tanF: tanF, aspect: aspect || 1 };
  }

  /* screen uv (0..1, y down) -> ray dir */
  function camRay(cam, u, v) {
    var x = (u * 2 - 1) * cam.tanF * cam.aspect, y = (1 - v * 2) * cam.tanF;
    return norm(add(add(cam.fwd, mul(cam.right, x)), mul(cam.up, y)));
  }

  /* world point -> screen uv, or null if behind */
  function project(cam, p) {
    var d = sub(p, cam.pos), z = dot(d, cam.fwd);
    if (z <= 0.01) return null;
    var x = dot(d, cam.right) / z / (cam.tanF * cam.aspect), y = dot(d, cam.up) / z / cam.tanF;
    return [(x + 1) / 2, (1 - y) / 2];
  }

  function hitSphere(o, d) {
    var b = dot(o, d), c = dot(o, o) - 1, h = b * b - c;
    if (h < 0) return null;
    h = Math.sqrt(h);
    var t = -b - h;
    if (t < 1e-4) t = -b + h;
    if (t < 1e-4) return null;
    var p = add(o, mul(d, t));
    return { t: t, p: p, n: p };
  }

  function toCube(v) { return [v[0] * COS_R - v[2] * SIN_R, v[1], v[0] * SIN_R + v[2] * COS_R]; }
  function fromCube(v) { return [v[0] * COS_R + v[2] * SIN_R, v[1], -v[0] * SIN_R + v[2] * COS_R]; }

  function hitCube(o, d) {
    var lo = toCube(sub(o, CUBE_C)), ld = toCube(d);
    var tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
    for (var i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < -CUBE_H || lo[i] > CUBE_H) return null; continue; }
      var t1 = (-CUBE_H - lo[i]) / ld[i], t2 = (CUBE_H - lo[i]) / ld[i];
      var s = -1;
      if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 1e-4) return null;
    if (tmin < 1e-4) return null;
    var n = [0, 0, 0]; n[axis] = sign;
    return { t: tmin, p: add(o, mul(d, tmin)), n: fromCube(n) };
  }

  function hitObject(shape, o, d) { return shape === "cube" ? hitCube(o, d) : hitSphere(o, d); }

  /* Environment radiance for a direction (also used as ambient light). */
  function env(S, d) {
    var y = d[1];
    if (y >= 0) return lerp3(S.horizon, S.sky, Math.pow(Math.min(1, y * 1.6), 0.6));
    return lerp3(S.horizon, S.groundEnv, Math.pow(Math.min(1, -y * 2.2), 0.5));
  }

  /* Smooth diffuse irradiance from the environment (no hard horizon band). */
  function irradiance(S, n) {
    var t = n[1], wH = 0.4 * (1 - t * t), wS = (1 - wH) * (0.5 + 0.5 * t), wG = (1 - wH) * (0.5 - 0.5 * t);
    return add(add(mul(S.horizon, wH), mul(S.sky, wS)), mul(S.groundEnv, wG));
  }

  /* Key light at point p: returns { L, rad } */
  function keyLight(S, p) {
    if (S.spot) {
      var lp = mul(S.lightDir, 3.4);
      var toL = sub(lp, p), dist2 = dot(toL, toL), L = norm(toL);
      var axis = norm(mul(lp, -1));
      var cone = smooth(Math.cos(30 * DEG), Math.cos(16 * DEG), dot(mul(L, -1), axis));
      var fall = Math.min(2.2, (3.4 * 3.4) / dist2);
      return { L: L, rad: mul(S.lightColor, S.intensity * cone * fall) };
    }
    return { L: S.lightDir, rad: mul(S.lightColor, S.intensity) };
  }

  /* Shade the object surface. Returns { c: linear rgb, ndl } */
  function shadeObject(S, p, n, V, albedo) {
    var kl = keyLight(S, p), L = kl.L;
    var ndl = dot(n, L);
    var w = S.subsurface * 0.6;
    var dif;
    if (S.toon) dif = ndl > 0.5 ? 1 : ndl > 0.02 ? 0.55 : 0;
    else dif = Math.max(0, (ndl + w) / (1 + w));
    var amb = mul(irradiance(S, n), S.ambient * (1 - 0.22 * Math.max(0, -n[1])));
    var light = add(mul(kl.rad, dif), amb);
    var c = mulv(albedo, light);
    if (S.subsurface > 0) {
      var term = Math.exp(-ndl * ndl * 10) * S.subsurface * 0.45;
      var sat = mulv(albedo, albedo);
      c = add(c, mul(mulv(sat, kl.rad), term));
    }
    if (S.specular > 0 && ndl > 0) {
      var H = norm(add(L, V));
      var shin = 10 + S.reflectivity * 140 + S.specular * 30;
      var sp = Math.pow(Math.max(0, dot(n, H)), shin);
      if (S.toon) sp = sp > 0.5 ? 1 : 0;
      c = add(c, mul(kl.rad, sp * S.specular * (0.6 + S.reflectivity)));
    }
    if (S.reflectivity > 0) {
      var R = sub(mul(n, 2 * dot(n, V)), V);
      var fr = 0.04 + 0.96 * Math.pow(1 - Math.max(0, dot(n, V)), 5);
      var k = S.reflectivity * (0.35 + 0.65 * fr);
      var e = env(S, R);
      if (S.chrome) e = mulv(e, albedo);
      c = add(mul(c, 1 - k), mul(e, k * 1.1));
    }
    return { c: c, ndl: ndl };
  }

  function shadeGround(S, p, dist) {
    var kl = keyLight(S, p);
    var lit = Math.max(0, kl.L[1]);
    var occ = hitObject(S.shape, add(p, [0, 1e-3, 0]), kl.L) ? 1 : 0;
    var r = Math.sqrt(p[0] * p[0] + p[2] * p[2]);
    var ao = 1 - 0.45 * Math.exp(-Math.max(0, r - (S.shape === "cube" ? 0.9 : 0.55)) * 2.4);
    var keyAmt = Math.min(1, (kl.rad[0] + kl.rad[1] + kl.rad[2]) / 3) * Math.min(1, lit * 2.5) * (1 - occ);
    var g = mul(S.ground, (0.5 + 0.5 * keyAmt) * ao);
    var far = 1 - Math.exp(-Math.max(0, dist - 3) * 0.09);
    return lerp3(g, S.horizon, Math.min(1, far));
  }

  function fog(S, c, dist) {
    if (!S.fog) return c;
    var k = Math.min(1, S.fog * (dist / 6));
    return lerp3(c, S.horizon, k);
  }

  function encodeOut(S, c) {
    var o = C.linearToRgb(c);
    if (S.contrast !== 1) {
      for (var i = 0; i < 3; i++) o[i] = Math.max(0, Math.min(255, (o[i] - 128) * S.contrast + 128));
    }
    return o;
  }

  /* Trace one primary ray. Returns { c (linear), obj, n, ndl, d } */
  function trace(S, cam, d) {
    var h = hitObject(S.shape, cam.pos, d);
    var tg = d[1] < -1e-6 ? (GROUND_Y - cam.pos[1]) / d[1] : Infinity;
    if (h && h.t < tg) {
      var V = mul(d, -1);
      var sh = shadeObject(S, h.p, h.n, V, S.albedo);
      return { c: fog(S, sh.c, h.t), obj: true, n: h.n, ndl: sh.ndl };
    }
    if (tg < Infinity && tg > 0) {
      var p = add(cam.pos, mul(d, tg));
      return { c: fog(S, shadeGround(S, p, tg), tg), obj: false };
    }
    return { c: env(S, d), obj: false };
  }

  /* Main render.
   * S: scene (linear colors): albedo, sky, horizon, ground, groundEnv, lightDir, lightColor,
   *    intensity, ambient, spot, specular, reflectivity, subsurface, toon, chrome, fog, contrast,
   *    shape, yaw, pitch, split (null or 0..1), flatAlbedoRgb (sRGB 0..255)
   * Returns { rgb: Uint8Array, w, h, palette } */
  function render(S, w, h, ss) {
    ss = ss || 1;
    var cam = makeCamera(S.yaw, S.pitch, w / h);
    var out = new Uint8Array(w * h * 3);
    var buckets = { hi: [], mid: [], shadow: [], bounce: [] };
    var allLum = [];
    var splitX = S.split == null ? Infinity : Math.round(S.split * w);
    var flat = S.flatAlbedoRgb || [128, 128, 128];
    var inv = 1 / (ss * ss);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var acc = [0, 0, 0], accFlat = 0, center = null;
        for (var sy = 0; sy < ss; sy++) {
          for (var sx = 0; sx < ss; sx++) {
            var u = (x + (sx + 0.5) / ss) / w, v = (y + (sy + 0.5) / ss) / h;
            var r = trace(S, cam, camRay(cam, u, v));
            acc[0] += r.c[0]; acc[1] += r.c[1]; acc[2] += r.c[2];
            if (r.obj) accFlat++;
            if (sx === 0 && sy === 0) center = r;
          }
        }
        var lin = mul(acc, inv);
        var o;
        var idx = (y * w + x) * 3;
        if (x >= splitX) {
          var cov = accFlat * inv;
          o = [128 + (flat[0] - 128) * cov, 128 + (flat[1] - 128) * cov, 128 + (flat[2] - 128) * cov];
          if (x === splitX) o = [235, 235, 235];
        } else {
          o = encodeOut(S, lin);
        }
        out[idx] = o[0]; out[idx + 1] = o[1]; out[idx + 2] = o[2];
        if (center && center.obj && accFlat * inv > 0.99) {
          var col = center.c, n = center.n, ndl = center.ndl;
          var lum = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
          allLum.push([lum, col]);
          if (ndl > 0.3 && ndl < 0.7) buckets.mid.push(col);
          if (ndl < -0.15 && n[1] > -0.25) buckets.shadow.push(col);
          if (ndl < 0.05 && n[1] < -0.45) buckets.bounce.push(col);
        }
      }
    }
    if (allLum.length) {
      allLum.sort(function (a, b) { return b[0] - a[0]; });
      var top = Math.max(1, Math.floor(allLum.length * 0.03));
      for (var i = 0; i < top; i++) buckets.hi.push(allLum[i][1]);
    }
    var palette = {};
    var V = mul(cam.fwd, -1);
    var Ld = S.lightDir;
    var fallbacks = {
      hi: norm(add(Ld, V)),
      mid: norm(add(mul(Ld, 0.5), mul(norm(cross(Ld, [0, 1, 0.001])), 0.87))),
      shadow: norm(add(mul(Ld, -0.6), [0, 0.8, 0])),
      bounce: norm(add(mul(Ld, -0.3), [0, -0.95, 0]))
    };
    Object.keys(buckets).forEach(function (k) {
      var arr = buckets[k], c;
      if (arr.length) {
        c = [0, 0, 0];
        for (var j = 0; j < arr.length; j++) { c[0] += arr[j][0]; c[1] += arr[j][1]; c[2] += arr[j][2]; }
        c = mul(c, 1 / arr.length);
      } else {
        var nn = fallbacks[k];
        c = shadeObject(S, nn, nn, V, S.albedo).c;
      }
      palette[k] = encodeOut(S, c);
    });
    return { rgb: out, w: w, h: h, palette: palette };
  }

  /* Where to draw the light handle on screen (uv) */
  function lightHandle(S, aspect) {
    var cam = makeCamera(S.yaw, S.pitch, aspect || 1);
    return project(cam, mul(S.lightDir, 1.75));
  }

  var api = { render: render, dirFromAngles: dirFromAngles, lightHandle: lightHandle, makeCamera: makeCamera, project: project };
  root.CPRender = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
