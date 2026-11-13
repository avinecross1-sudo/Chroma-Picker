/* Chroma Picker - GPU version of the lit preview (proof of concept, desktop app only).
 *
 * The same ray tracer as plugin/js/render.js, run as a WebGL2 fragment shader: one shader invocation per pixel
 * instead of a JavaScript loop. The scene, camera, mesh, its tree and its corner occlusion all come from render.js,
 * so both renderers draw the same picture; only the per-pixel work moves to the graphics card.
 * Photoshop's UXP panels have no WebGL, so the plugin keeps using render.js. */
(function (root) {
  "use strict";
  var R = root.CPRender;

  var VS = "#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";

  var FS = [
    "#version 300 es",
    "precision highp float; precision highp int; precision highp sampler2D;",
    "uniform sampler2D uNodes, uTris; uniform int uTexW;",
    "uniform vec2 uRes; uniform int uSS;",
    "uniform vec3 camPos, camFwd, camRight, camUp; uniform float tanF, aspect;",
    "uniform int shape; uniform vec4 spheres[3]; uniform int nSpheres; uniform float standRadius;",
    "uniform vec3 albedo, sky, horizon, ground, groundLit;",
    "uniform float ambient, specular, reflectivity, subsurface, sheen, softness, bounce, fogAmt, fogStart, contrast;",
    "uniform int toon, chrome;",
    "uniform vec3 Ldir[3], Lcol[3]; uniform float Lint[3]; uniform int Lspot[3], Lrim[3]; uniform int nLights, mainLight;",
    "uniform float splitX; uniform vec3 flatRgb;",
    "out vec4 outColor;",
    "const float GROUND_Y = -1.0, DEG = 0.017453292519943295;",
    "const float CUBE_H = 0.62; const vec3 CUBE_C = vec3(0.0, -0.38, 0.0);",
    "const float COS_R = 0.9396926207859084, SIN_R = -0.3420201433256687;",
    "float smooth3(float e0, float e1, float x){ float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }",
    "vec4 fetch(sampler2D s, int i){ return texelFetch(s, ivec2(i % uTexW, i / uTexW), 0); }",
    "struct Hit { bool ok; float t; vec3 p, n, gn, sp; bool isFlat, dense, mesh, main; float ao; };",
    "Hit noHit(){ Hit h; h.ok = false; h.t = 1e30; h.mesh = false; h.main = true; h.ao = 1.0; h.isFlat = false; h.dense = false; return h; }",

    /* ---- triangle mesh: nearest (or any) hit through the bounding-volume tree ---- */
    "int hTri; float hT, hU, hV;",
    "bool hitMesh(vec3 o, vec3 d, float tmax, bool any){",
    "  vec3 inv = vec3(1.0 / (d.x == 0.0 ? 1e-12 : d.x), 1.0 / (d.y == 0.0 ? 1e-12 : d.y), 1.0 / (d.z == 0.0 ? 1e-12 : d.z));",
    "  int stack[40]; int sp = 0; stack[sp++] = 0; hTri = -1;",
    "  while (sp > 0) {",
    "    int ni = stack[--sp]; vec4 A = fetch(uNodes, ni * 2), B = fetch(uNodes, ni * 2 + 1);",
    "    vec3 ta = (A.xyz - o) * inv, tb = (B.xyz - o) * inv, mn = min(ta, tb), mx = max(ta, tb);",
    "    float t0 = max(max(mn.x, mn.y), mn.z), t1 = min(min(mx.x, mx.y), mx.z);",
    "    if (t0 > t1 || t1 < 0.0 || t0 > tmax) continue;",
    "    if (A.w >= 0.0) {",
    "      int l = int(A.w), packed = int(B.w), r = packed >> 2, ax = packed & 3;",
    "      bool back = ax == 0 ? d.x < 0.0 : ax == 1 ? d.y < 0.0 : d.z < 0.0;",
    "      if (back) { stack[sp++] = l; stack[sp++] = r; } else { stack[sp++] = r; stack[sp++] = l; }",
    "      continue;",
    "    }",
    "    int first = int(-A.w) - 1, cnt = int(B.w);",
    "    for (int k = 0; k < 4; k++) { if (k >= cnt) break;",
    "      int ti = first + k; vec3 a = fetch(uTris, ti * 7).xyz, e1 = fetch(uTris, ti * 7 + 1).xyz, e2 = fetch(uTris, ti * 7 + 2).xyz;",
    "      vec3 pv = cross(d, e2); float det = dot(e1, pv);",
    "      if (det > -1e-10 && det < 1e-10) continue;",
    "      float id = 1.0 / det; vec3 s = o - a; float u = dot(s, pv) * id;",
    "      if (u < 0.0 || u > 1.0) continue;",
    "      vec3 q = cross(s, e1); float v = dot(d, q) * id;",
    "      if (v < 0.0 || u + v > 1.0) continue;",
    "      float t = dot(e2, q) * id;",
    "      if (t < 1e-4 || t >= tmax) continue;",
    "      tmax = t; hT = t; hU = u; hV = v; hTri = ti;",
    "      if (any) return true;",
    "    }",
    "  }",
    "  return hTri >= 0;",
    "}",
    "bool modelBlocks(vec3 p, vec3 L, float reach){ return hitMesh(p, L, reach, true); }",

    "Hit hitModel(vec3 o, vec3 d){",
    "  Hit h = noHit(); if (!hitMesh(o, d, 1e30, false)) return h;",
    "  int ti = hTri; vec4 T0 = fetch(uTris, ti * 7), T1 = fetch(uTris, ti * 7 + 1), T2 = fetch(uTris, ti * 7 + 2), T3 = fetch(uTris, ti * 7 + 3);",
    "  vec4 V0 = fetch(uTris, ti * 7 + 4), V1 = fetch(uTris, ti * 7 + 5), V2 = fetch(uTris, ti * 7 + 6);",
    "  float u = hU, v = hV, w = 1.0 - u - v; vec3 tn = T3.xyz; bool hasVn = T2.w > 0.5; float plane = T0.w;",
    "  h.ok = true; h.t = hT; h.p = o + d * hT; h.mesh = true; h.dense = T1.w > 0.5; h.ao = T3.w * w + V0.w * u + V1.w * v;",
    "  vec3 n = tn, sp = h.p;",
    "  if (dot(tn, d) > 0.0) {",
    "    n = hasVn ? normalize(V0.xyz * w + V1.xyz * u + V2.xyz * v) : tn;",
    "    if (dot(n, d) > 0.0) n = -n;",
    "    vec3 gb = -tn; h.n = n; h.gn = gb; h.sp = h.p + gb * 2e-3;",
    "    h.isFlat = plane < -0.5 ? dot(n, gb) > 0.999 : plane > 0.5; return h;",
    "  }",
    "  if (hasVn) {",
    "    n = normalize(V0.xyz * w + V1.xyz * u + V2.xyz * v);",
    "    vec3 c0 = T0.xyz, c1 = T0.xyz + T1.xyz, c2 = T0.xyz + T2.xyz, vu0 = normalize(V0.xyz), vu1 = normalize(V1.xyz), vu2 = normalize(V2.xyz), lift = vec3(0.0);",
    "    float b0 = dot(h.p - c0, vu0), b1 = dot(h.p - c1, vu1), b2 = dot(h.p - c2, vu2);",
    "    if (b0 < 0.0) lift += vu0 * (-b0 * w); if (b1 < 0.0) lift += vu1 * (-b1 * u); if (b2 < 0.0) lift += vu2 * (-b2 * v);",
    "    sp = h.p + lift;",
    "  }",
    "  h.n = n; h.gn = tn; h.sp = sp + tn * 2e-3; h.isFlat = plane < -0.5 ? dot(n, tn) > 0.999 : plane > 0.5; return h;",
    "}",

    "const float NEAR = 0.08, TERMINATOR = 0.35, GRAZE = 0.15;",
    "float denseLit(Hit hit, vec3 p, vec3 L, float reach, float ndl, float w){",
    "  if (reach > NEAR && hitMesh(p + L * NEAR, L, reach - NEAR, true)) return 1.0 - smooth3(-w, GRAZE, ndl);",
    "  if ((hit.isFlat && dot(hit.gn, L) <= 0.0) || hitMesh(p, L, min(NEAR, reach), true)) return 1.0 - smooth3(-w, TERMINATOR, ndl);",
    "  return 1.0;",
    "}",

    /* ---- analytic shapes ---- */
    "Hit hitSphere(vec3 o, vec3 d, vec4 c){",
    "  Hit h = noHit(); vec3 oc = o - c.xyz; float b = dot(oc, d), cc = dot(oc, oc) - c.w * c.w, q = b * b - cc;",
    "  if (q < 0.0) return h; q = sqrt(q); float t = -b - q; if (t < 1e-4) t = -b + q; if (t < 1e-4) return h;",
    "  h.ok = true; h.t = t; h.p = o + d * t; h.n = (h.p - c.xyz) / c.w; return h;",
    "}",
    "vec3 toCube(vec3 v){ return vec3(v.x * COS_R - v.z * SIN_R, v.y, v.x * SIN_R + v.z * COS_R); }",
    "vec3 fromCube(vec3 v){ return vec3(v.x * COS_R + v.z * SIN_R, v.y, -v.x * SIN_R + v.z * COS_R); }",
    "Hit hitCube(vec3 o, vec3 d){",
    "  Hit h = noHit(); vec3 lo = toCube(o - CUBE_C), ld = toCube(d); float tmin = -1e30, tmax = 1e30; int axis = -1; float sgn = 0.0;",
    "  for (int i = 0; i < 3; i++) {",
    "    if (abs(ld[i]) < 1e-9) { if (lo[i] < -CUBE_H || lo[i] > CUBE_H) return h; continue; }",
    "    float t1 = (-CUBE_H - lo[i]) / ld[i], t2 = (CUBE_H - lo[i]) / ld[i], s = -1.0;",
    "    if (t1 > t2) { float tmp = t1; t1 = t2; t2 = tmp; s = 1.0; }",
    "    if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }",
    "    if (t2 < tmax) tmax = t2;",
    "    if (tmin > tmax) return h;",
    "  }",
    "  if (tmax < 1e-4 || tmin < 1e-4) return h;",
    "  vec3 n = vec3(0.0); n[axis] = sgn; h.ok = true; h.t = tmin; h.p = o + d * tmin; h.n = fromCube(n); return h;",
    "}",
    "Hit hitObject(vec3 o, vec3 d){",
    "  if (shape == 2) return hitCube(o, d);",
    "  if (shape == 3) return hitModel(o, d);",
    "  Hit best = noHit();",
    "  for (int i = 0; i < 3; i++) { if (i >= nSpheres) break; Hit h = hitSphere(o, d, spheres[i]); if (h.ok && h.t < best.t) { best = h; best.main = i == 0; } }",
    "  return best;",
    "}",

    "float shadowVis(vec3 p, vec3 L){",
    "  if (L.y <= 0.0) return 0.0;",
    "  if (shape == 2) return hitCube(p + vec3(0.0, 1e-3, 0.0), L).ok ? 0.0 : 1.0;",
    "  if (shape == 3) return modelBlocks(p + vec3(0.0, 1e-3, 0.0), L, 1e30) ? 0.0 : 1.0;",
    "  float vis = 1.0;",
    "  for (int i = 0; i < 3; i++) { if (i >= nSpheres) break; vec4 c = spheres[i]; vec3 oc = c.xyz - p; float t = dot(oc, L);",
    "    if (t <= 0.0) continue; vec3 q = oc - L * t; float dp = length(q), w = c.w * (0.06 + softness * 0.22 * t);",
    "    vis *= smooth3(c.w - w, c.w + w, dp); }",
    "  return vis;",
    "}",
    "float groundAO(vec3 p){",
    "  if (shape == 2) { vec3 lp = toCube(p - CUBE_C); float dx = max(0.0, abs(lp.x) - CUBE_H), dz = max(0.0, abs(lp.z) - CUBE_H); return 1.0 - 0.55 * exp(-sqrt(dx * dx + dz * dz) * 5.0); }",
    "  if (shape == 3) return 1.0 - 0.55 * exp(-max(0.0, length(p.xz) - standRadius) * 5.0);",
    "  float ao = 1.0;",
    "  for (int i = 0; i < 3; i++) { if (i >= nSpheres) break; vec4 c = spheres[i]; float r = length(p.xz - c.xz) / c.w; ao *= 1.0 - 0.6 * exp(-r * r * 2.2); }",
    "  return ao;",
    "}",

    /* ---- environment and shading, as in render.js ---- */
    "vec3 env(vec3 d){ float y = d.y; if (y >= 0.0) return mix(horizon, sky, pow(smooth3(0.0, 0.32, y), 0.7)); return mix(horizon, groundLit, smooth3(0.0, 0.18, -y)); }",
    "vec3 envSoft(vec3 d){ float y = d.y; if (y >= 0.0) return mix(horizon, sky, smooth3(-0.05, 0.6, y)); return mix(horizon, groundLit, smooth3(0.0, 0.5, -y)); }",
    "vec3 irradiance(vec3 n){ float t = n.y, wH = 0.32 * (1.0 - t * t), wS = (1.0 - wH) * max(0.0, 0.5 + 0.5 * t); return horizon * wH + sky * wS; }",
    "vec3 groundBounce(vec3 n, vec3 alb, float h){",
    "  float down = max(0.0, 0.5 - 0.5 * n.y), wG = down * sqrt(down) * 1.4;",
    "  if (wG <= 0.0 || bounce == 0.0) return vec3(0.0);",
    "  float occl = 1.0 - 0.3 * exp(-h * 3.2) * max(0.0, -n.y);",
    "  vec3 src = mix(groundLit, ground, 0.55), a = alb * 0.7 + vec3(0.12);",
    "  return a * src * (wG * bounce * (0.45 + ambient) * occl);",
    "}",
    "void lightAt(int i, vec3 p, out vec3 L, out vec3 rad, out float reach){",
    "  if (Lspot[i] != 0) { vec3 lp = Ldir[i] * 3.6, toL = lp - p; float d2 = dot(toL, toL); L = normalize(toL); vec3 axis = normalize(-lp);",
    "    float cone = smooth3(cos(32.0 * DEG), cos(16.0 * DEG), dot(-L, axis)), fall = min(2.2, 12.96 / d2);",
    "    rad = Lcol[i] * (Lint[i] * cone * fall); reach = sqrt(d2); return; }",
    "  L = Ldir[i]; rad = Lcol[i] * Lint[i]; reach = 1e30;",
    "}",
    "vec3 shadeObject(vec3 p, vec3 n, vec3 V, Hit hit, out float keyNdl){",
    "  float w = 0.12 + subsurface * 0.6; keyNdl = 0.0; vec3 rimC = vec3(0.0); float h = p.y - GROUND_Y;",
    "  bool mesh = hit.mesh; float crease = mesh ? hit.ao : 1.0; vec3 lift = mesh ? hit.sp : p;",
    "  float ao = (1.0 - 0.55 * exp(-h * 3.2) * max(0.0, -n.y)) * crease;",
    "  vec3 c = albedo * irradiance(n) * (ambient * ao) + groundBounce(n, albedo, h) * crease;",
    "  for (int i = 0; i < 3; i++) { if (i >= nLights) break;",
    "    if (Lint[i] <= 0.0) continue;",
    "    vec3 L, krad; float reach; lightAt(i, p, L, krad, reach); float ndl = dot(n, L);",
    "    if (i == mainLight) keyNdl = ndl;",
    "    float lit = 1.0;",
    "    if (mesh && ndl > -w) lit = hit.dense ? denseLit(hit, lift, L, reach, ndl, w) : ((hit.isFlat && dot(hit.gn, L) <= 0.0) || modelBlocks(lift, L, reach) ? 0.0 : 1.0);",
    "    if (lit <= 0.0) {",
    "      if (i == mainLight) keyNdl = min(ndl, -0.2);",
    "      if (Lrim[i] != 0) continue;",
    "      if (subsurface > 0.0 && toon == 0) c += albedo * albedo * krad * (subsurface * 0.12);",
    "      continue;",
    "    }",
    "    vec3 rad = krad * lit;",
    "    float dif = toon != 0 ? (ndl > 0.5 ? 1.0 : ndl > 0.02 ? 0.55 : 0.0) : max(0.0, (ndl + w) / (1.0 + w));",
    "    if (Lrim[i] != 0 && mesh) { rimC += mix(albedo, vec3(1.0), 0.25) * rad * (dif * 0.85); continue; }",
    "    if (Lrim[i] != 0) { float edge = 1.0 - max(0.0, dot(n, V)); float rd = max(0.0, (ndl + 0.45) / 1.45) * edge * edge * 1.6;",
    "      if (toon != 0) rd = rd > 0.35 ? 0.8 : 0.0; rimC += mix(albedo, vec3(1.0), 0.45) * rad * rd; continue; }",
    "    c += albedo * rad * dif;",
    "    if (subsurface > 0.0) c += albedo * albedo * rad * (exp(-ndl * ndl * 10.0) * subsurface * 0.45);",
    "    if (specular > 0.0 && ndl > 0.0) { vec3 H = normalize(L + V); float shin = 12.0 + reflectivity * 140.0 + specular * 24.0;",
    "      float s = pow(max(0.0, dot(n, H)), shin); if (toon != 0) s = s > 0.5 ? 1.0 : 0.0; c += rad * (s * specular * 0.5); }",
    "  }",
    "  float nv = max(0.0, dot(n, V)); vec3 R = n * (2.0 * dot(n, V)) - V; vec3 e = envSoft(R);",
    "  float fr = 0.04 + 0.96 * pow(1.0 - nv, 3.0);",
    "  if (sheen > 0.0 && toon == 0) { float ks = min(0.9, fr * sheen); c = c * (1.0 - ks * 0.6) + e * (ks * (0.55 + 0.45 * ao)); }",
    "  if (reflectivity > 0.0) { float k = reflectivity * (0.35 + 0.65 * fr); if (chrome != 0) e *= albedo; c = c * (1.0 - k) + e * k; }",
    "  return c + rimC;",
    "}",
    "vec3 shadeGround(vec3 p, float dist){",
    "  vec3 lit = vec3(0.0);",
    "  for (int i = 0; i < 3; i++) { if (i >= nLights) break; if (Lint[i] <= 0.0) continue;",
    "    vec3 L, rad; float reach; lightAt(i, p, L, rad, reach);",
    "    float ndl = max(0.0, L.y) * (Lrim[i] != 0 ? 0.3 : 1.0); if (ndl <= 0.0) continue;",
    "    lit += rad * (min(1.0, ndl * 1.6 + 0.25) * shadowVis(p, L)); }",
    "  vec3 shadowTone = ground * 0.26 + ground * sky * 0.3;",
    "  vec3 g = (shadowTone + (ground - shadowTone) * lit) * groundAO(p);",
    "  float far = 1.0 - exp(-max(0.0, dist - 3.5) * 0.11);",
    "  return mix(g, horizon, min(1.0, far));",
    "}",
    "vec3 fogc(vec3 c, float dist){ if (fogAmt == 0.0) return c; float behind = max(0.0, dist - fogStart); return mix(c, horizon, min(1.0, fogAmt * (1.0 - exp(-behind / 2.5)))); }",
    "float tone1(float v){ return v < 0.75 ? v : 0.75 + 0.25 * (1.0 - exp(-(v - 0.75) / 0.25)) * 1.2; }",
    "float toSrgb(float l){ l = max(0.0, l); return clamp((l <= 0.0031308 ? l * 12.92 : 1.055 * pow(l, 1.0 / 2.4) - 0.055) * 255.0, 0.0, 255.0); }",
    "vec3 encodeOut(vec3 c){ vec3 o = vec3(toSrgb(tone1(c.r)), toSrgb(tone1(c.g)), toSrgb(tone1(c.b)));",
    "  if (contrast != 1.0) o = clamp((o - 128.0) * contrast + 128.0, 0.0, 255.0); return o; }",
    "vec3 trace(vec3 d, out bool obj){",
    "  Hit h = hitObject(camPos, d); obj = false;",
    "  float tg = d.y < -1e-6 && camPos.y > GROUND_Y ? (GROUND_Y - camPos.y) / d.y : 1e30;",
    "  if (h.ok && h.t < tg) { float kn; vec3 c = shadeObject(h.p, h.n, -d, h, kn); obj = true; return h.main ? c : fogc(c, h.t); }",
    "  if (tg < 1e30 && tg > 0.0) return fogc(shadeGround(camPos + d * tg, tg), tg);",
    "  return env(d);",
    "}",
    "void main(){",
    "  vec2 px = vec2(gl_FragCoord.x - 0.5, uRes.y - gl_FragCoord.y - 0.5);",
    "  vec3 acc = vec3(0.0); float cov = 0.0, inv = 1.0 / float(uSS * uSS);",
    "  for (int sy = 0; sy < 4; sy++) { if (sy >= uSS) break; for (int sx = 0; sx < 4; sx++) { if (sx >= uSS) break;",
    "    vec2 uv = (px + (vec2(sx, sy) + 0.5) / float(uSS)) / uRes;",
    "    vec3 d = normalize(camFwd + camRight * ((uv.x * 2.0 - 1.0) * tanF * aspect) + camUp * ((1.0 - uv.y * 2.0) * tanF));",
    "    bool obj; acc += trace(d, obj); if (obj) cov += 1.0; } }",
    "  cov *= inv; vec3 o;",
    "  if (px.x >= splitX) o = px.x == splitX ? vec3(235.0) : vec3(128.0) + (flatRgb - 128.0) * cov;",
    "  else o = encodeOut(acc * inv);",
    "  outColor = vec4(o / 255.0, 1.0);",
    "}"
  ].join("\n");

  var SHAPES = { sphere: 0, trio: 1, cube: 2 };
  var DEG = Math.PI / 180;
  function trioSpheres() {
    var y = 25 * DEG, rx = Math.cos(y), rz = -Math.sin(y), bx = -Math.sin(y), bz = -Math.cos(y);
    function at(x, back, r) { return [rx * x + bx * back, -1 + r, rz * x + bz * back, r]; }
    return [[0, 0, 0, 1], at(-2.0, 0.7, 0.5), at(2.0, 0.7, 0.5)];
  }

  /* Flattens render.js's tree into two float textures: nodes (2 texels each) and triangles (7 texels each). */
  var TEX_W = 2048;
  function packMesh(mesh) {
    var nodes = [], tris = [];
    (function walk(nd) {
      var i = nodes.length; nodes.push(null);
      if (nd.tris) {
        var first = tris.length; nd.tris.forEach(function (t) { tris.push(t); });
        nodes[i] = [nd.x0, nd.y0, nd.z0, -(first + 1), nd.x1, nd.y1, nd.z1, nd.tris.length];
      } else {
        var l = walk(nd.left), r = walk(nd.right);
        nodes[i] = [nd.x0, nd.y0, nd.z0, l, nd.x1, nd.y1, nd.z1, r * 4 + nd.axis];
      }
      return i;
    })(mesh.root);
    function tex(texels) { var rows = Math.ceil(texels / TEX_W); return { data: new Float32Array(rows * TEX_W * 4), rows: rows }; }
    var N = tex(nodes.length * 2); nodes.forEach(function (n, i) { N.data.set(n, i * 8); });
    var T = tex(tris.length * 7);
    tris.forEach(function (t, i) {
      var vn = t.vn || [t.n, t.n, t.n], o = i * 28;
      T.data.set([t.a[0], t.a[1], t.a[2], t.plane == null ? -1 : t.plane ? 1 : 0,
        t.e1[0], t.e1[1], t.e1[2], t.dense ? 1 : 0,
        t.e2[0], t.e2[1], t.e2[2], t.vn ? 1 : 0,
        t.n[0], t.n[1], t.n[2], t.ao[0],
        vn[0][0], vn[0][1], vn[0][2], t.ao[1],
        vn[1][0], vn[1][1], vn[1][2], t.ao[2],
        vn[2][0], vn[2][1], vn[2][2], 0], o);
    });
    return { nodes: N, tris: T, count: tris.length };
  }

  function create(canvas) {
    var gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {}; function u(name) { return U[name] || (U[name] = gl.getUniformLocation(prog, name)); }
    function makeTex(unit) { var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; }
    var texNodes = makeTex(0), texTris = makeTex(1), loaded = null;
    gl.uniform1i(u("uNodes"), 0); gl.uniform1i(u("uTris"), 1); gl.uniform1i(u("uTexW"), TEX_W);

    function upload(shape, rev) {
      var key = shape + "|" + (rev || 0);
      if (loaded === key) return;
      var mesh = R.meshOf(shape), pk = packMesh(mesh);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNodes);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, pk.nodes.rows, 0, gl.RGBA, gl.FLOAT, pk.nodes.data);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texTris);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, pk.tris.rows, 0, gl.RGBA, gl.FLOAT, pk.tris.data);
      gl.uniform1f(u("standRadius"), mesh.standRadius);
      loaded = key;
    }

    /* Draws the scene S (the same object render.js takes) at w x h with ss x ss samples per pixel. */
    function render(S0, w, h, ss) {
      var S = R.prepare(S0);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      gl.viewport(0, 0, w, h);
      var cam = R.sceneCamera(S, w / h), mesh = R.hasModel(S.shape);
      if (mesh) upload(S.shape, S.modelRev);
      gl.uniform2f(u("uRes"), w, h); gl.uniform1i(u("uSS"), ss || 1);
      gl.uniform3fv(u("camPos"), cam.pos); gl.uniform3fv(u("camFwd"), cam.fwd); gl.uniform3fv(u("camRight"), cam.right); gl.uniform3fv(u("camUp"), cam.up);
      gl.uniform1f(u("tanF"), cam.tanF); gl.uniform1f(u("aspect"), cam.aspect);
      gl.uniform1i(u("shape"), mesh ? 3 : SHAPES[S.shape]);
      var sp = S.shape === "trio" ? trioSpheres() : S.shape === "cube" || mesh ? [] : [[0, 0, 0, 1]];
      gl.uniform1i(u("nSpheres"), sp.length);
      if (sp.length) gl.uniform4fv(u("spheres"), [].concat.apply([], sp.concat([[0, 0, 0, 0], [0, 0, 0, 0]]).slice(0, 3)));
      gl.uniform3fv(u("albedo"), S.albedo); gl.uniform3fv(u("sky"), S.sky); gl.uniform3fv(u("horizon"), S.horizon);
      gl.uniform3fv(u("ground"), S.ground); gl.uniform3fv(u("groundLit"), S.groundLit);
      gl.uniform1f(u("ambient"), S.ambient); gl.uniform1f(u("specular"), S.specular || 0); gl.uniform1f(u("reflectivity"), S.reflectivity || 0);
      gl.uniform1f(u("subsurface"), S.subsurface || 0); gl.uniform1f(u("sheen"), S.sheen); gl.uniform1f(u("softness"), S.softness);
      gl.uniform1f(u("bounce"), S.bounce); gl.uniform1f(u("fogAmt"), S.fog || 0); gl.uniform1f(u("fogStart"), Math.sqrt(cam.pos[0] * cam.pos[0] + cam.pos[1] * cam.pos[1] + cam.pos[2] * cam.pos[2]));
      gl.uniform1f(u("contrast"), S.contrast == null ? 1 : S.contrast);
      gl.uniform1i(u("toon"), S.toon ? 1 : 0); gl.uniform1i(u("chrome"), S.chrome ? 1 : 0);
      var L = (S.lights || []).slice(0, 3), dir = [], col = [], it = [], spot = [], rim = [];
      for (var i = 0; i < 3; i++) { var l = L[i] || { dir: [0, 1, 0], color: [0, 0, 0], intensity: 0 };
        dir.push.apply(dir, l.dir); col.push.apply(col, l.color || [1, 1, 1]); it.push(l.intensity); spot.push(l.spot ? 1 : 0); rim.push(l.rim ? 1 : 0); }
      gl.uniform3fv(u("Ldir"), dir); gl.uniform3fv(u("Lcol"), col); gl.uniform1fv(u("Lint"), it); gl.uniform1iv(u("Lspot"), spot); gl.uniform1iv(u("Lrim"), rim);
      gl.uniform1i(u("nLights"), L.length); gl.uniform1i(u("mainLight"), S.mainLight || 0);
      gl.uniform1f(u("splitX"), S.split == null ? 1e9 : Math.round(S.split * w)); gl.uniform3fv(u("flatRgb"), S.flatAlbedoRgb || [128, 128, 128]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    /* waits for the frame and returns its pixels as RGB rows from the top, like render.js */
    function readRGB() {
      var w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4), out = new Uint8Array(w * h * 3);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var s = ((h - 1 - y) * w + x) * 4, d = (y * w + x) * 3; out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; }
      return out;
    }
    function finish() { var p = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); }
    return { render: render, readRGB: readRGB, finish: finish, gl: gl, renderer: (function () { var e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() };
  }

  root.CPGpuRender = { create: create };
})(typeof window !== "undefined" ? window : globalThis);
