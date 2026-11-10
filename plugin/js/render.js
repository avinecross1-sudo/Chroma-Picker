/* Chroma Picker - small CPU ray tracer for the lit preview.
 *
 * Scene: one sphere, a sphere flanked by two smaller ones ("trio"), a cube, or a
 * planar head on a stand ("head"), resting on a ground plane. Lighting is an image-based-style environment made
 * from three independent colors (sky, horizon, ground) plus a key light and an
 * optional fill light. The environment both forms the backdrop and lights the
 * subject: sky fill from above, ground bounce from below, and a Fresnel sheen
 * that picks up the horizon at the silhouette. Ground shadows are soft and
 * widen with distance from the caster. */
(function (root) {
  "use strict";
  var C = root.CPColor || (typeof require !== "undefined" ? require("./color.js") : null);
  var HeadModel = root.CPHead || (typeof require !== "undefined" ? require("./head.js") : null);

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
  var CUBE_H = 0.62, CUBE_C = [0, GROUND_Y + 0.62, 0], CUBE_ROT = -20 * DEG;
  var COS_R = Math.cos(CUBE_ROT), SIN_R = Math.sin(CUBE_ROT);

  function dirFromAngles(azDeg, elDeg) {
    var az = azDeg * DEG, el = elDeg * DEG;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  }

  /* The head is narrow and tall, so in a tall panel the camera moves in until it fills the width. */
  function camDist(shape, aspect) {
    if (shape === "head") {
      var a = aspect || 1;
      /* wide panels zoom in on the other subjects; the head is already as tall as the view, so it backs off again */
      return 4.85 * (a > 1.25 ? 1 / Math.max(0.66, Math.pow(1.25 / a, 0.75)) : Math.max(0.74, 0.55 + 0.36 * a));
    }
    return shape === "trio" ? 5.3 : 4.3;
  }
  /* the point the camera orbits: the head is taller than the other subjects, so it is framed a little higher */
  function camTarget(shape) { return shape === "head" ? [0, 0.14, 0] : [0, -0.2, 0]; }

  function makeCamera(yawDeg, pitchDeg, aspect, dist, target) {
    target = target || [0, -0.2, 0];
    dist = dist || 4.6;
    var d = dirFromAngles(yawDeg, pitchDeg);
    var pos = add(target, mul(d, dist));
    var fwd = norm(sub(target, pos));
    var right = norm(cross(fwd, [0, 1, 0]));
    var up = cross(right, fwd);
    /* The subject grows with the panel's height, and also with its width: in tall panels the horizontal
     * field of view is kept, and in wide panels the camera zooms in (up to a limit, so the subject still fits). */
    var a = aspect || 1;
    var tanF = Math.tan(19 * DEG) * (a < 1.25 ? 1.25 / a : Math.max(0.66, Math.pow(1.25 / a, 0.75)));
    return { pos: pos, fwd: fwd, right: right, up: up, tanF: tanF, aspect: aspect || 1 };
  }

  function camRay(cam, u, v) {
    var x = (u * 2 - 1) * cam.tanF * cam.aspect, y = (1 - v * 2) * cam.tanF;
    return norm(add(add(cam.fwd, mul(cam.right, x)), mul(cam.up, y)));
  }

  function project(cam, p) {
    var d = sub(p, cam.pos), z = dot(d, cam.fwd);
    if (z <= 0.01) return null;
    var x = dot(d, cam.right) / z / (cam.tanF * cam.aspect), y = dot(d, cam.up) / z / cam.tanF;
    return [(x + 1) / 2, (1 - y) / 2];
  }

  /* ---------- geometry ---------- */
  /* spheres as [cx, cy, cz, r]. The trio is laid out to flank the main sphere from the default camera (yaw 25). */
  var SPHERE = [[0, 0, 0, 1]];
  var TRIO = (function () {
    var y = 25 * DEG, rx = Math.cos(y), rz = -Math.sin(y), bx = -Math.sin(y), bz = -Math.cos(y);
    function at(x, back, r) { return [rx * x + bx * back, GROUND_Y + r, rz * x + bz * back, r]; }
    return [[0, 0, 0, 1], at(-2.0, 0.7, 0.5), at(2.0, 0.7, 0.5)];
  })();
  function spheresOf(shape) { return shape === "trio" ? TRIO : shape === "cube" ? [] : SPHERE; }

  function hitSphereAt(o, d, c) {
    var ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2], r = c[3];
    var b = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
    if (h < 0) return null;
    h = Math.sqrt(h);
    var t = -b - h;
    if (t < 1e-4) t = -b + h;
    if (t < 1e-4) return null;
    var p = add(o, mul(d, t));
    return { t: t, p: p, n: [(p[0] - c[0]) / r, (p[1] - c[1]) / r, (p[2] - c[2]) / r] };
  }

  function toCube(v) { return [v[0] * COS_R - v[2] * SIN_R, v[1], v[0] * SIN_R + v[2] * COS_R]; }
  function fromCube(v) { return [v[0] * COS_R + v[2] * SIN_R, v[1], -v[0] * SIN_R + v[2] * COS_R]; }

  function hitCube(o, d) {
    var lo = toCube(sub(o, CUBE_C)), ld = toCube(d);
    var tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
    for (var i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < -CUBE_H || lo[i] > CUBE_H) return null; continue; }
      var t1 = (-CUBE_H - lo[i]) / ld[i], t2 = (CUBE_H - lo[i]) / ld[i], s = -1;
      if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 1e-4 || tmin < 1e-4) return null;
    var n = [0, 0, 0]; n[axis] = sign;
    return { t: tmin, p: add(o, mul(d, tmin)), n: fromCube(n) };
  }

  /* ---------- triangle mesh (the planar head) ---------- */
  /* Triangles live in a small bounding-volume tree. Each keeps a flat normal, and a soft occlusion value at each
   * corner so creases such as the eye sockets and the underside of the nose and jaw read darker in ambient light. */
  var headMesh = null;
  function getHead() { return headMesh || (headMesh = makeMesh(HeadModel.build(GROUND_Y))); }

  function makeMesh(model) {
    var tris = model.tris.map(function (t) {
      var e1 = sub(t.b, t.a), e2 = sub(t.c, t.a);
      return { a: t.a, e1: e1, e2: e2, n: norm(cross(e1, e2)), round: t.round, ao: [1, 1, 1],
        lo: [Math.min(t.a[0], t.b[0], t.c[0]), Math.min(t.a[1], t.b[1], t.c[1]), Math.min(t.a[2], t.b[2], t.c[2])],
        hi: [Math.max(t.a[0], t.b[0], t.c[0]), Math.max(t.a[1], t.b[1], t.c[1]), Math.max(t.a[2], t.b[2], t.c[2])] };
    });
    function node(list) {
      var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], i, k;
      for (i = 0; i < list.length; i++) for (k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], list[i].lo[k]); hi[k] = Math.max(hi[k], list[i].hi[k]); }
      if (list.length <= 4) return { lo: lo, hi: hi, tris: list };
      var ax = hi[0] - lo[0] > hi[1] - lo[1] ? (hi[0] - lo[0] > hi[2] - lo[2] ? 0 : 2) : (hi[1] - lo[1] > hi[2] - lo[2] ? 1 : 2);
      list.sort(function (p, q) { return (p.lo[ax] + p.hi[ax]) - (q.lo[ax] + q.hi[ax]); });
      var m = list.length >> 1;
      return { lo: lo, hi: hi, left: node(list.slice(0, m)), right: node(list.slice(m)) };
    }
    var mesh = { root: node(tris.slice()), standRadius: model.standRadius };
    /* corner occlusion: how much of the hemisphere over each corner is blocked by nearby surfaces */
    var N = 40, reach = 0.75;
    tris.forEach(function (t) {
      if (t.round) return;
      var t1 = norm(t.e1), t2 = cross(t.n, t1);
      var mid = add(t.a, mul(add(t.e1, t.e2), 1 / 3));
      [t.a, add(t.a, t.e1), add(t.a, t.e2)].forEach(function (corner, ci) {
        var p = add(lerp3(corner, mid, 0.3), mul(t.n, 2e-3)), blocked = 0;
        for (var i = 0; i < N; i++) {
          var u = (i + 0.5) / N, ph = i * 2.399963, r = Math.sqrt(u), z = Math.sqrt(1 - u);
          var d = add(add(mul(t1, r * Math.cos(ph)), mul(t2, r * Math.sin(ph))), mul(t.n, z));
          var h = hitMesh(mesh, p, d, reach, false);
          if (h) blocked += 1 - h.t / reach;
        }
        t.ao[ci] = 1 - 0.85 * blocked / N;
      });
    });
    return mesh;
  }

  function hitBox(nd, o, inv, tmax) {
    var t0 = 0, t1 = tmax;
    for (var k = 0; k < 3; k++) {
      var a = (nd.lo[k] - o[k]) * inv[k], b = (nd.hi[k] - o[k]) * inv[k];
      if (a > b) { var s = a; a = b; b = s; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  }

  /* Nearest hit along o + d * t within tmax, as { t, tri, u, v }. With any = true it returns at the first hit found. */
  function hitMesh(mesh, o, d, tmax, any) {
    var inv = [1 / (d[0] || 1e-12), 1 / (d[1] || 1e-12), 1 / (d[2] || 1e-12)];
    var stack = [mesh.root], best = null;
    while (stack.length) {
      var nd = stack.pop();
      if (!hitBox(nd, o, inv, tmax)) continue;
      if (!nd.tris) { stack.push(nd.left, nd.right); continue; }
      for (var i = 0; i < nd.tris.length; i++) {
        var tr = nd.tris[i], e1 = tr.e1, e2 = tr.e2;
        var px = d[1] * e2[2] - d[2] * e2[1], py = d[2] * e2[0] - d[0] * e2[2], pz = d[0] * e2[1] - d[1] * e2[0];
        var det = e1[0] * px + e1[1] * py + e1[2] * pz;
        if (det > -1e-10 && det < 1e-10) continue;
        var id = 1 / det, sx = o[0] - tr.a[0], sy = o[1] - tr.a[1], sz = o[2] - tr.a[2];
        var u = (sx * px + sy * py + sz * pz) * id;
        if (u < 0 || u > 1) continue;
        var qx = sy * e1[2] - sz * e1[1], qy = sz * e1[0] - sx * e1[2], qz = sx * e1[1] - sy * e1[0];
        var v = (d[0] * qx + d[1] * qy + d[2] * qz) * id;
        if (v < 0 || u + v > 1) continue;
        var t = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * id;
        if (t < 1e-4 || t >= tmax) continue;
        tmax = t; best = { t: t, tri: tr, u: u, v: v };
        if (any) return best;
      }
    }
    return best;
  }

  function hitHead(o, d) {
    var h = hitMesh(getHead(), o, d, Infinity, false);
    if (!h) return null;
    var tr = h.tri, p = add(o, mul(d, h.t));
    return { t: h.t, p: p, n: tr.round ? norm([p[0], 0, p[2]]) : tr.n, mesh: true,
      ao: tr.ao[0] * (1 - h.u - h.v) + tr.ao[1] * h.u + tr.ao[2] * h.v };
  }

  /* Whether the head blocks light direction L from point p; reach is how far away the light is. */
  function headBlocks(p, L, reach) { return !!hitMesh(getHead(), p, L, reach || Infinity, true); }

  function hitObject(shape, o, d) {
    if (shape === "cube") return hitCube(o, d);
    if (shape === "head") return hitHead(o, d);
    var list = spheresOf(shape), best = null;
    for (var i = 0; i < list.length; i++) { var h = hitSphereAt(o, d, list[i]); if (h && (!best || h.t < best.t)) { best = h; best.main = i === 0; } }
    return best;
  }

  /* Soft visibility of light direction L from ground point p (1 = fully lit). */
  function shadowVis(S, p, L) {
    if (L[1] <= 0) return 0;
    if (S.shape === "cube") return hitCube(add(p, [0, 1e-3, 0]), L) ? 0 : 1;
    if (S.shape === "head") return headBlocks(add(p, [0, 1e-3, 0]), L) ? 0 : 1;
    var list = spheresOf(S.shape), vis = 1, soft = S.softness;
    for (var i = 0; i < list.length; i++) {
      var c = list[i], oc = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
      var t = dot(oc, L);
      if (t <= 0) continue;
      var q = sub(oc, mul(L, t)), dp = Math.sqrt(dot(q, q));
      var w = c[3] * (0.06 + soft * 0.22 * t);
      vis *= smooth(c[3] - w, c[3] + w, dp);
    }
    return vis;
  }

  /* Contact darkening on the ground near each object. */
  function groundAO(S, p) {
    if (S.shape === "cube") {
      var lp = toCube(sub(p, CUBE_C)), dx = Math.max(0, Math.abs(lp[0]) - CUBE_H), dz = Math.max(0, Math.abs(lp[2]) - CUBE_H);
      return 1 - 0.55 * Math.exp(-Math.sqrt(dx * dx + dz * dz) * 5);
    }
    if (S.shape === "head") return 1 - 0.55 * Math.exp(-Math.max(0, Math.sqrt(p[0] * p[0] + p[2] * p[2]) - getHead().standRadius) * 5);
    var list = spheresOf(S.shape), ao = 1;
    for (var i = 0; i < list.length; i++) {
      var c = list[i], ex = p[0] - c[0], ez = p[2] - c[2], r = Math.sqrt(ex * ex + ez * ez) / c[3];
      ao *= 1 - 0.6 * Math.exp(-r * r * 2.2);
    }
    return ao;
  }

  /* ---------- environment ---------- */
  /* Backdrop / reflection radiance for a direction: sky above, a wide hazy horizon band, ground below. */
  function env(S, d) {
    var y = d[1];
    if (y >= 0) return lerp3(S.horizon, S.sky, Math.pow(smooth(0, 0.32, y), 0.7));
    return lerp3(S.horizon, S.groundLit, smooth(0, 0.18, -y));
  }

  /* A blurred version of the environment, used for the glossy sheen so it has no hard horizon line. */
  function envSoft(S, d) {
    var y = d[1];
    if (y >= 0) return lerp3(S.horizon, S.sky, smooth(-0.05, 0.6, y));
    return lerp3(S.horizon, S.groundLit, smooth(0, 0.5, -y));
  }

  /* Diffuse light from the environment for a surface normal: sky fill from above, bounce from the lit ground below. */
  function irradiance(S, n) {
    var t = n[1];
    var wH = 0.32 * (1 - t * t);
    var wS = (1 - wH) * Math.max(0, 0.5 + 0.5 * t);
    var wG = (1 - wH) * Math.max(0, 0.5 - 0.5 * t);
    return add(mul(S.horizon, wH), mul(S.sky, wS));
  }

  /* Diffuse light bounced up from the ground. It lights the lower half of the subject in the ground's
   * color whatever the reflectivity, and part of it ignores the base color so the tint always shows. */
  function groundBounce(S, n, albedo, h) {
    var down = Math.max(0, 0.5 - 0.5 * n[1]);
    var wG = down * Math.sqrt(down) * 1.4;
    if (wG <= 0 || !S.bounce) return [0, 0, 0];
    var occl = 1 - 0.3 * Math.exp(-h * 3.2) * Math.max(0, -n[1]);
    var src = lerp3(S.groundLit, S.ground, 0.55);
    var alb = add(mul(albedo, 0.7), [0.12, 0.12, 0.12]);
    return mul(mulv(alb, src), wG * S.bounce * (0.45 + S.ambient) * occl);
  }

  function lightAt(Lt, p) {
    if (Lt.spot) {
      var lp = mul(Lt.dir, 3.6);
      var toL = sub(lp, p), dist2 = dot(toL, toL), L = norm(toL);
      var axis = norm(mul(lp, -1));
      var cone = smooth(Math.cos(32 * DEG), Math.cos(16 * DEG), dot(mul(L, -1), axis));
      var fall = Math.min(2.2, (3.6 * 3.6) / dist2);
      return { L: L, rad: mul(Lt.color, Lt.intensity * cone * fall), reach: Math.sqrt(dist2) };
    }
    return { L: Lt.dir, rad: mul(Lt.color, Lt.intensity), reach: Infinity };
  }

  /* ---------- shading ---------- */
  /* hit is given for the head: its planes cast shadows on each other, and its creases hold less ambient light */
  function shadeObject(S, p, n, V, albedo, hit) {
    var w = 0.12 + S.subsurface * 0.6, keyNdl = 0, rimC = [0, 0, 0];
    var h = p[1] - GROUND_Y;
    var mesh = !!(hit && hit.mesh), crease = mesh ? hit.ao : 1, lift = mesh ? add(p, mul(n, 2e-3)) : p;
    var ao = (1 - 0.55 * Math.exp(-h * 3.2) * Math.max(0, -n[1])) * crease;
    var c = add(mulv(albedo, mul(irradiance(S, n), S.ambient * ao)), mul(groundBounce(S, n, albedo, h), crease));
    for (var i = 0; i < S.lights.length; i++) {
      var Lt = S.lights[i];
      if (Lt.intensity <= 0) continue;
      var kl = lightAt(Lt, p), L = kl.L, ndl = dot(n, L);
      if (i === S.mainLight) keyNdl = ndl;
      /* cast shadow from the rest of the head; where it falls the light is treated as if the plane faced away */
      if (mesh && ndl > -w && headBlocks(lift, L, kl.reach)) {
        if (i === S.mainLight) keyNdl = Math.min(ndl, -0.2);
        if (Lt.rim) continue;
        if (S.subsurface > 0 && !S.toon) c = add(c, mul(mulv(mulv(albedo, albedo), kl.rad), S.subsurface * 0.12));
        continue;
      }
      var dif = S.toon ? (ndl > 0.5 ? 1 : ndl > 0.02 ? 0.55 : 0) : Math.max(0, (ndl + w) / (1 + w));
      /* A rim light only catches the edges that turn away from the camera. It is added after the sheen
       * so the bright outline is not washed out, and partly keeps the light's own color. */
      if (Lt.rim) {
        var edge = 1 - Math.max(0, dot(n, V));
        var rd = Math.max(0, (ndl + 0.45) / 1.45) * edge * edge * 1.6;
        if (S.toon) rd = rd > 0.35 ? 0.8 : 0;
        rimC = add(rimC, mulv(lerp3(albedo, [1, 1, 1], 0.45), mul(kl.rad, rd)));
        continue;
      }
      c = add(c, mulv(albedo, mul(kl.rad, dif)));
      if (S.subsurface > 0) {
        var term = Math.exp(-ndl * ndl * 10) * S.subsurface * 0.45;
        c = add(c, mul(mulv(mulv(albedo, albedo), kl.rad), term));
      }
      if (S.specular > 0 && ndl > 0) {
        var H = norm(add(L, V));
        var shin = 12 + S.reflectivity * 140 + S.specular * 24;
        var sp = Math.pow(Math.max(0, dot(n, H)), shin);
        if (S.toon) sp = sp > 0.5 ? 1 : 0;
        c = add(c, mul(kl.rad, sp * S.specular * 0.5));
      }
    }
    var nv = Math.max(0, dot(n, V));
    var R = sub(mul(n, 2 * dot(n, V)), V);
    var e = envSoft(S, R);
    /* Fresnel sheen: the silhouette picks up the sky and horizon */
    var fr = 0.04 + 0.96 * Math.pow(1 - nv, 3);
    if (S.sheen > 0 && !S.toon) { var ks = Math.min(0.9, fr * S.sheen); c = add(mul(c, 1 - ks * 0.6), mul(e, ks * (0.55 + 0.45 * ao))); }
    if (S.reflectivity > 0) {
      var k = S.reflectivity * (0.35 + 0.65 * fr);
      if (S.chrome) e = mulv(e, albedo);
      c = add(mul(c, 1 - k), mul(e, k));
    }
    c = add(c, rimC);
    return { c: c, ndl: keyNdl };
  }

  function shadeGround(S, p, dist) {
    var lit = [0, 0, 0];
    for (var i = 0; i < S.lights.length; i++) {
      var Lt = S.lights[i];
      if (Lt.intensity <= 0) continue;
      var kl = lightAt(Lt, p);
      var ndl = Math.max(0, kl.L[1]) * (Lt.rim ? 0.3 : 1);
      if (ndl <= 0) continue;
      var vis = shadowVis(S, p, kl.L);
      lit = add(lit, mul(kl.rad, Math.min(1, ndl * 1.6 + 0.25) * vis));
    }
    /* The ground color is what sunlit ground looks like. Shade it toward a sky-tinted shadow. */
    var shadowTone = add(mul(S.ground, 0.26), mul(mulv(S.ground, S.sky), 0.3));
    var g = add(shadowTone, mulv(sub(S.ground, shadowTone), lit));
    g = mul(g, groundAO(S, p));
    var far = 1 - Math.exp(-Math.max(0, dist - 3.5) * 0.11);
    return lerp3(g, S.horizon, Math.min(1, far));
  }

  /* Depth fog starts at the main subject, so it stays clear and only what is behind it fades. */
  function fog(S, c, dist) {
    if (!S.fog) return c;
    var behind = Math.max(0, dist - (S.fogStart || 0));
    return lerp3(c, S.horizon, Math.min(1, S.fog * (1 - Math.exp(-behind / 2.5))));
  }

  /* gentle shoulder so bright highlights roll off instead of clipping */
  function tone(v) { return v < 0.75 ? v : 0.75 + 0.25 * (1 - Math.exp(-(v - 0.75) / 0.25)) * 1.2; }

  function encodeOut(S, c) {
    var o = C.linearToRgb([tone(c[0]), tone(c[1]), tone(c[2])]);
    if (S.contrast !== 1) for (var i = 0; i < 3; i++) o[i] = Math.max(0, Math.min(255, (o[i] - 128) * S.contrast + 128));
    return o;
  }

  function trace(S, cam, d) {
    var h = hitObject(S.shape, cam.pos, d);
    var tg = d[1] < -1e-6 ? (GROUND_Y - cam.pos[1]) / d[1] : Infinity;
    if (h && h.t < tg) {
      var sh = shadeObject(S, h.p, h.n, mul(d, -1), S.albedo, h);
      return { c: h.main !== false ? sh.c : fog(S, sh.c, h.t), obj: true, main: h.main !== false, n: h.n, ndl: sh.ndl };
    }
    if (tg < Infinity && tg > 0) return { c: fog(S, shadeGround(S, add(cam.pos, mul(d, tg)), tg), tg), obj: false };
    return { c: env(S, d), obj: false };
  }

  function prepare(S) {
    var P = Object.assign({}, S);
    P.softness = S.softness == null ? 1 : S.softness;
    P.sheen = S.sheen == null ? 0.8 : S.sheen;
    P.bounce = S.bounce == null ? 1 : S.bounce;
    /* average brightness of the ground under the lights, for bounce and reflections */
    var sun = 0, best = -1;
    P.mainLight = 0;
    (S.lights || []).forEach(function (Lt, i) {
      var lum = Lt.intensity * (Lt.color ? (Lt.color[0] + Lt.color[1] + Lt.color[2]) / 3 : 1);
      if (!Lt.rim) sun += lum * Math.max(0, Lt.dir[1] * 1.6 + 0.25);
      if (!Lt.rim && lum > best) { best = lum; P.mainLight = i; }
    });
    sun = S.lights && S.lights.length ? Math.min(1.2, sun) : 0.5;
    var shadowTone = add(mul(S.ground, 0.26), mul(mulv(S.ground, S.sky), 0.3));
    P.groundLit = lerp3(shadowTone, S.ground, Math.min(1, sun));
    return P;
  }

  /* Main render.
   * S: albedo, sky, horizon, ground (linear rgb), lights: [{ dir, color, intensity, spot }], ambient,
   *    specular, reflectivity, subsurface, sheen, softness, toon, chrome, fog, contrast,
   *    shape ("sphere" | "trio" | "cube" | "head"), yaw, pitch, split (null or 0..1), flatAlbedoRgb (sRGB 0..255)
   * Returns { rgb: Uint8Array, w, h, palette } */
  /* A render that can run in time slices, so the panel stays responsive while a sharp frame is computed.
   * job.step(ms) renders rows for about ms milliseconds and returns true when finished; job.result() gives the frame. */
  function renderJob(S0, w, h, ss) {
    var S = prepare(S0);
    ss = ss || 1;
    var cam = makeCamera(S.yaw, S.pitch, w / h, camDist(S.shape, w / h), camTarget(S.shape));
    S.fogStart = Math.sqrt(dot(cam.pos, cam.pos));
    var out = new Uint8Array(w * h * 3);
    var buckets = { hi: [], mid: [], shadow: [], bounce: [] }, allLum = [];
    var splitX = S.split == null ? Infinity : Math.round(S.split * w);
    var flat = S.flatAlbedoRgb || [128, 128, 128];
    var inv = 1 / (ss * ss);
    var y = 0, done = null;
    function row(y) {
      for (var x = 0; x < w; x++) {
        var acc = [0, 0, 0], cov = 0, center = null;
        for (var sy = 0; sy < ss; sy++) for (var sx = 0; sx < ss; sx++) {
          var r = trace(S, cam, camRay(cam, (x + (sx + 0.5) / ss) / w, (y + (sy + 0.5) / ss) / h));
          acc[0] += r.c[0]; acc[1] += r.c[1]; acc[2] += r.c[2];
          if (r.obj) cov++;
          if (sx === 0 && sy === 0) center = r;
        }
        cov *= inv;
        var o, idx = (y * w + x) * 3;
        if (x >= splitX) {
          o = x === splitX ? [235, 235, 235] : [128 + (flat[0] - 128) * cov, 128 + (flat[1] - 128) * cov, 128 + (flat[2] - 128) * cov];
        } else o = encodeOut(S, mul(acc, inv));
        out[idx] = o[0]; out[idx + 1] = o[1]; out[idx + 2] = o[2];
        if (center && center.obj && center.main && cov > 0.99) {
          var col = center.c, n = center.n, ndl = center.ndl;
          allLum.push([0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2], col]);
          if (ndl > 0.3 && ndl < 0.7) buckets.mid.push(col);
          if (ndl < -0.15 && n[1] > -0.25) buckets.shadow.push(col);
          if (ndl < 0.05 && n[1] < -0.45) buckets.bounce.push(col);
        }
      }
    }
    function finish() {
    if (allLum.length) {
      allLum.sort(function (a, b) { return b[0] - a[0]; });
      for (var i = 0, top = Math.max(1, Math.floor(allLum.length * 0.03)); i < top; i++) buckets.hi.push(allLum[i][1]);
    }
    var V = mul(cam.fwd, -1), Ld = S.lights[S.mainLight || 0].dir;
    var fallbacks = {
      hi: norm(add(Ld, V)),
      mid: norm(add(mul(Ld, 0.5), mul(norm(cross(Ld, [0, 1, 0.001])), 0.87))),
      shadow: norm(add(mul(Ld, -0.6), [0, 0.8, 0])),
      bounce: norm(add(mul(Ld, -0.3), [0, -0.95, 0]))
    };
    var palette = {};
    Object.keys(buckets).forEach(function (k) {
      var arr = buckets[k], c;
      if (arr.length) {
        c = [0, 0, 0];
        for (var j = 0; j < arr.length; j++) { c[0] += arr[j][0]; c[1] += arr[j][1]; c[2] += arr[j][2]; }
        c = mul(c, 1 / arr.length);
      } else c = shadeObject(S, fallbacks[k], fallbacks[k], V, S.albedo).c;
      palette[k] = encodeOut(S, c);
    });
    return { rgb: out, w: w, h: h, palette: palette };
    }
    var now = typeof performance !== "undefined" && performance.now ? function () { return performance.now(); } : function () { return Date.now(); };
    return {
      step: function (ms) {
        if (done) return true;
        var t0 = now();
        while (y < h) { row(y); y++; if (ms != null && now() - t0 >= ms) break; }
        if (y >= h) done = finish();
        return !!done;
      },
      result: function () { return done; },
      progress: function () { return y / h; }
    };
  }

  function render(S0, w, h, ss) { var job = renderJob(S0, w, h, ss); job.step(null); return job.result(); }

  function lightHandle(S, aspect, i) {
    var cam = makeCamera(S.yaw, S.pitch, aspect || 1, camDist(S.shape, aspect), camTarget(S.shape));
    return project(cam, add(camTarget(S.shape), mul(S.lights[i || 0].dir, S.shape === "trio" ? 2.4 : S.shape === "head" ? 2.0 : 1.8)));
  }

  var api = { render: render, renderJob: renderJob, dirFromAngles: dirFromAngles, lightHandle: lightHandle, makeCamera: makeCamera, project: project };
  root.CPRender = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
