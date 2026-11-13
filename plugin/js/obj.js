/* Chroma Picker - loads a user's .obj file as a preview model.
 *
 * The result is packed in the same form as the built-in models (see test/pack-model.py), so the renderer treats it
 * exactly like them and it is small enough to remember between sessions. Along the way the mesh is cleaned up so an
 * arbitrary export renders well:
 *   - polygons of any size are split into triangles by ear clipping, so concave n-gons do not fold over themselves
 *   - points that sit on top of each other are welded, so facets that share an edge shade smoothly across it
 *   - zero-area triangles are dropped
 *   - facing is made consistent across each connected piece and turned outward, so lighting is not inside out
 *   - very dense meshes are reduced by vertex clustering, to keep the first frame quick on the CPU renderer
 * Normals and texture coordinates in the file are ignored: the renderer works out its own from the facets.
 * Centering, scaling and standing the model on the ground happen in the renderer, as for the built-in heads. */
(function (root) {
  "use strict";

  var MAX_TRIANGLES = 24000;                             /* about four times the detailed Asaro head */

  /* ---------- parsing ---------- */
  /* returns { pos: Float64Array of x,y,z, polys: [[i, j, k, ...], ...] } with 0-based point indices */
  function parse(text) {
    var pos = [], polys = [], lines = text.split(/\r\n|\n|\r/), carry = "";
    for (var li = 0; li < lines.length; li++) {
      var line = carry + lines[li];
      if (line.charAt(line.length - 1) === "\\") { carry = line.slice(0, -1) + " "; continue; }
      carry = "";
      var c0 = line.charCodeAt(0), c1 = line.charCodeAt(1);
      if (c0 === 118 && (c1 === 32 || c1 === 9)) {                   /* "v " */
        var p = line.trim().split(/\s+/);
        var x = +p[1], y = +p[2], z = +p[3];
        pos.push(isFinite(x) ? x : 0, isFinite(y) ? y : 0, isFinite(z) ? z : 0);
      } else if (c0 === 102 && (c1 === 32 || c1 === 9)) {            /* "f " */
        var parts = line.trim().split(/\s+/), ids = [], n = pos.length / 3;
        for (var k = 1; k < parts.length; k++) {
          var v = parseInt(parts[k], 10);                             /* "7/2/7" and "7//7" parse as 7 */
          if (!v) continue;
          v = v < 0 ? n + v : v - 1;                                  /* negative indices count back from the end */
          if (v < 0 || v >= n) continue;
          if (ids.length && ids[ids.length - 1] === v) continue;
          ids.push(v);
        }
        if (ids.length > 2 && ids[0] === ids[ids.length - 1]) ids.pop();
        if (ids.length >= 3) polys.push(ids);
      }
    }
    return { pos: new Float64Array(pos), polys: polys };
  }

  /* ---------- triangulation ---------- */
  function triangulate(pos, poly, out) {
    var n = poly.length, i;
    if (n === 3) { out.push(poly[0], poly[1], poly[2]); return; }
    /* Newell's normal picks the plane to flatten the polygon onto */
    var nx = 0, ny = 0, nz = 0;
    for (i = 0; i < n; i++) {
      var a = poly[i] * 3, b = poly[(i + 1) % n] * 3;
      nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
      ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
      nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
    }
    var ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    /* drop the axis the polygon faces most along */
    var u = 0, w = 1;
    if (ax >= ay && ax >= az) { u = 1; w = 2; } else if (ay >= az) { u = 2; w = 0; }
    var px = [], py = [];
    for (i = 0; i < n; i++) { px.push(pos[poly[i] * 3 + u]); py.push(pos[poly[i] * 3 + w]); }
    var area = 0;
    for (i = 0; i < n; i++) { var j = (i + 1) % n; area += px[i] * py[j] - px[j] * py[i]; }
    var sgn = area >= 0 ? 1 : -1;
    function cross2(a, b, c) { return ((px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a])) * sgn; }
    function inside(a, b, c, p) { return cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0; }
    var idx = [];
    for (i = 0; i < n; i++) idx.push(i);
    var guard = n * n + 10;
    while (idx.length > 3 && guard-- > 0) {
      var found = false;
      for (i = 0; i < idx.length; i++) {
        var ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        if (cross2(ia, ib, ic) <= 0) continue;                       /* reflex corner: not an ear */
        var clear = true;
        for (var k = 0; k < idx.length && clear; k++) {
          var q = idx[k];
          if (q !== ia && q !== ib && q !== ic && inside(ia, ib, ic, q)) clear = false;
        }
        if (!clear) continue;
        out.push(poly[ia], poly[ib], poly[ic]);
        idx.splice(i, 1);
        found = true;
        break;
      }
      if (!found) break;                                             /* self-intersecting or degenerate: fan the rest */
    }
    for (i = 1; i + 1 < idx.length; i++) out.push(poly[idx[0]], poly[idx[i]], poly[idx[i + 1]]);
  }

  /* ---------- welding and reduction ---------- */
  /* Merges every point into the cell of a grid it falls in, at the average position of the points in that cell,
   * and drops the triangles that collapse. A tiny cell welds coincident points; a larger one reduces the mesh. */
  function cluster(pos, tris, lo, cell) {
    var map = new Map(), sums = [], remap = new Int32Array(pos.length / 3), i;
    var inv = 1 / cell, bb = bounds(pos), G = 2 + Math.ceil(Math.max(bb.hi[0] - lo[0], bb.hi[1] - lo[1], bb.hi[2] - lo[2]) * inv);
    var numeric = G * G * G < 9e15;                                  /* a number key stays exact below 2^53 */
    for (i = 0; i < remap.length; i++) {
      var gx = Math.floor((pos[i * 3] - lo[0]) * inv), gy = Math.floor((pos[i * 3 + 1] - lo[1]) * inv), gz = Math.floor((pos[i * 3 + 2] - lo[2]) * inv);
      var key = numeric ? (gx * G + gy) * G + gz : gx + "," + gy + "," + gz;
      var id = map.get(key);
      if (id === undefined) { id = sums.length / 4; map.set(key, id); sums.push(0, 0, 0, 0); }
      sums[id * 4] += pos[i * 3]; sums[id * 4 + 1] += pos[i * 3 + 1]; sums[id * 4 + 2] += pos[i * 3 + 2]; sums[id * 4 + 3]++;
      remap[i] = id;
    }
    var np = new Float64Array(sums.length / 4 * 3);
    for (i = 0; i < np.length / 3; i++) { var c = sums[i * 4 + 3]; np[i * 3] = sums[i * 4] / c; np[i * 3 + 1] = sums[i * 4 + 1] / c; np[i * 3 + 2] = sums[i * 4 + 2] / c; }
    var nt = [], seen = new Set();
    for (i = 0; i < tris.length; i += 3) {
      var a = remap[tris[i]], b = remap[tris[i + 1]], d = remap[tris[i + 2]];
      if (a === b || b === d || a === d) continue;
      /* the same three points in the same turning order is a duplicate */
      var m = Math.min(a, b, d), r = m === a ? [a, b, d] : m === b ? [b, d, a] : [d, a, b];
      var tk = r[0] + "," + r[1] + "," + r[2];
      if (seen.has(tk)) continue;
      seen.add(tk);
      nt.push(a, b, d);
    }
    return compact(np, nt);
  }

  /* drops points no triangle uses, and triangles with no area */
  function compact(pos, tris) {
    var used = new Int32Array(pos.length / 3).fill(-1), np = [], nt = [], i, k;
    for (i = 0; i < tris.length; i += 3) {
      var a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
      var e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      var e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      var cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      if (cx * cx + cy * cy + cz * cz <= 1e-24) continue;
      for (k = 0; k < 3; k++) {
        var v = tris[i + k];
        if (used[v] < 0) { used[v] = np.length / 3; np.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
        nt.push(used[v]);
      }
    }
    return { pos: new Float64Array(np), tris: nt };
  }

  function bounds(pos) {
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < pos.length; i += 3) for (var k = 0; k < 3; k++) {
      if (pos[i + k] < lo[k]) lo[k] = pos[i + k];
      if (pos[i + k] > hi[k]) hi[k] = pos[i + k];
    }
    return { lo: lo, hi: hi };
  }

  /* ---------- facing ---------- */
  /* Walks each connected piece across shared edges and flips any triangle that turns the other way from its
   * neighbor, then flips a whole closed piece if it encloses negative volume, so its facets face outward. */
  function orient(pos, tris) {
    var nt = tris.length / 3, edges = new Map(), np = pos.length / 3, i, k;
    function ekey(a, b) { return a < b ? a * np + b : b * np + a; }
    for (i = 0; i < nt; i++) for (k = 0; k < 3; k++) {
      var key = ekey(tris[i * 3 + k], tris[i * 3 + (k + 1) % 3]), list = edges.get(key);
      if (list) list.push(i); else edges.set(key, [i]);
    }
    /* whether triangle t runs from a to b (as opposed to b to a) */
    function runs(t, a, b) { for (var j = 0; j < 3; j++) if (tris[t * 3 + j] === a && tris[t * 3 + (j + 1) % 3] === b) return true; return false; }
    function flip(t) { var s = tris[t * 3 + 1]; tris[t * 3 + 1] = tris[t * 3 + 2]; tris[t * 3 + 2] = s; }
    var done = new Uint8Array(nt), queue = new Int32Array(nt), flipped = 0;
    for (var start = 0; start < nt; start++) {
      if (done[start]) continue;
      var head = 0, tail = 0, piece = [];
      queue[tail++] = start; done[start] = 1;
      while (head < tail) {
        var t = queue[head++];
        piece.push(t);
        for (k = 0; k < 3; k++) {
          var a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3], nb = edges.get(ekey(a, b));
          if (nb.length !== 2) continue;                           /* open or non-manifold edge: no neighbor to follow */
          var o = nb[0] === t ? nb[1] : nb[0];
          if (done[o]) continue;
          if (runs(o, a, b)) { flip(o); flipped++; }                /* neighbors share an edge in opposite directions */
          done[o] = 1; queue[tail++] = o;
        }
      }
      /* signed volume against the piece's own center; near zero for an open sheet, which is left as it is */
      var cx = 0, cy = 0, cz = 0, cnt = 0;
      piece.forEach(function (t) { for (var j = 0; j < 3; j++) { var v = tris[t * 3 + j] * 3; cx += pos[v]; cy += pos[v + 1]; cz += pos[v + 2]; cnt++; } });
      cx /= cnt; cy /= cnt; cz /= cnt;
      var vol = 0, absVol = 0;
      piece.forEach(function (t) {
        var a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
        var ax = pos[a] - cx, ay = pos[a + 1] - cy, az = pos[a + 2] - cz, bx = pos[b] - cx, by = pos[b + 1] - cy, bz = pos[b + 2] - cz;
        var qx = pos[c] - cx, qy = pos[c + 1] - cy, qz = pos[c + 2] - cz;
        var v = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
        vol += v; absVol += Math.abs(v);
      });
      if (vol < -0.2 * absVol) piece.forEach(flip);
    }
    return flipped;
  }

  /* ---------- packing ---------- */
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function base64Words(words) {
    var bytes = new Uint8Array(words.length * 2), out = [], i;
    for (i = 0; i < words.length; i++) { bytes[i * 2] = words[i] & 255; bytes[i * 2 + 1] = (words[i] >> 8) & 255; }
    for (i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8) | (i + 2 < bytes.length ? bytes[i + 2] : 0);
      out.push(B64[(n >> 18) & 63], B64[(n >> 12) & 63], i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=", i + 2 < bytes.length ? B64[n & 63] : "=");
    }
    return out.join("");
  }

  function pack(pos, tris) {
    var bb = bounds(pos), lo = bb.lo, hi = bb.hi, q = [], i, k;
    for (i = 0; i < pos.length; i += 3) for (k = 0; k < 3; k++) q.push(hi[k] > lo[k] ? Math.round((pos[i + k] - lo[k]) / (hi[k] - lo[k]) * 65535) : 0);
    /* stand radius: the widest point in the lowest 5% of the height, for the contact shadow on the ground */
    var cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, stand = 0;
    for (i = 0; i < pos.length; i += 3) {
      if (pos[i + 1] > lo[1] + 0.05 * (hi[1] - lo[1])) continue;
      stand = Math.max(stand, Math.sqrt((pos[i] - cx) * (pos[i] - cx) + (pos[i + 2] - cz) * (pos[i + 2] - cz)));
    }
    /* pointAO: the renderer samples occlusion per point, which suits arbitrary dense meshes better */
    return { lo: lo, hi: hi, standRadius: stand, points: base64Words(q), tris: base64Words(tris), pointAO: true };
  }

  /* ---------- whole pipeline ---------- */
  /* Returns { data, points, triangles, sourceTriangles, reduced, flipped } or throws an Error with a message for the user. */
  function load(text, opts) {
    opts = opts || {};
    var max = opts.maxTriangles || MAX_TRIANGLES;
    var raw = parse(text);
    if (raw.pos.length < 9 || !raw.polys.length) throw new Error("No faces found in this file");
    var tris = [];
    for (var i = 0; i < raw.polys.length; i++) triangulate(raw.pos, raw.polys[i], tris);
    var source = tris.length / 3;
    var bb = bounds(raw.pos), size = Math.max(bb.hi[0] - bb.lo[0], bb.hi[1] - bb.lo[1], bb.hi[2] - bb.lo[2]);
    if (!(size > 0)) throw new Error("The model has no size");
    /* weld points closer than a hundred-thousandth of the model's size */
    var m = cluster(raw.pos, tris, bb.lo, size * 1e-5), reduced = false;
    /* reduce until under the budget; the grid size is searched so the result lands just below it */
    if (m.tris.length / 3 > max || m.pos.length / 3 > 65535) {
      var cellLo = size * 1e-5, cellHi = size / 8, best = null;
      for (var it = 0; it < 18; it++) {
        var cell = Math.sqrt(cellLo * cellHi), r = cluster(m.pos, m.tris, bb.lo, cell);
        if (r.tris.length / 3 > max || r.pos.length / 3 > 65535) cellLo = cell; else { best = r; cellHi = cell; }
        if (best && best.tris.length / 3 > max * 0.9) break;
      }
      m = best || cluster(m.pos, m.tris, bb.lo, cellHi);
      reduced = true;
    }
    if (m.tris.length < 3) throw new Error("No faces with any area in this file");
    var flipped = orient(m.pos, m.tris);
    return { data: pack(m.pos, m.tris), points: m.pos.length / 3, triangles: m.tris.length / 3, sourceTriangles: source, reduced: reduced, flipped: flipped };
  }

  /* ---------- turning a packed model ---------- */
  /* Rotates packed data a quarter turn about an axis without loss: the 16-bit positions only swap axes and mirror.
   * axis "x" tips the model over (a Z-up export stands up after one tip); "y" turns it about the vertical. */
  function decodeWords(b64) {
    var bytes = [], acc = 0, bits = 0;
    for (var i = 0; i < b64.length; i++) {
      var c = B64.indexOf(b64.charAt(i));
      if (c < 0) continue;
      acc = ((acc << 6) | c) & 0xffff; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); }
    }
    var out = [];
    for (var j = 0; j + 1 < bytes.length; j += 2) out.push(bytes[j] | (bytes[j + 1] << 8));
    return out;
  }
  function quarterTurn(data, axis) {
    var w = decodeWords(data.points), out = [], lo = data.lo, hi = data.hi, i;
    /* x: (x, y, z) -> (x, z, -y), so +z becomes up; y: (x, y, z) -> (z, y, -x) */
    for (i = 0; i + 2 < w.length; i += 3) {
      if (axis === "x") out.push(w[i], w[i + 2], 65535 - w[i + 1]);
      else out.push(w[i + 2], w[i + 1], 65535 - w[i]);
    }
    var nlo = axis === "x" ? [lo[0], lo[2], -hi[1]] : [lo[2], lo[1], -hi[0]];
    var nhi = axis === "x" ? [hi[0], hi[2], -lo[1]] : [hi[2], hi[1], -lo[0]];
    /* the stand radius depends on which end is down, so it is measured again */
    var stand = 0, cx = 32767.5, cz = 32767.5, sx = (nhi[0] - nlo[0]) / 65535, sz = (nhi[2] - nlo[2]) / 65535;
    for (i = 0; i + 2 < out.length; i += 3) {
      if (out[i + 1] > 0.05 * 65535) continue;
      var dx = (out[i] - cx) * sx, dz = (out[i + 2] - cz) * sz;
      stand = Math.max(stand, Math.sqrt(dx * dx + dz * dz));
    }
    return { lo: nlo, hi: nhi, standRadius: stand, points: base64Words(out), tris: data.tris, pointAO: data.pointAO };
  }

  var api = { load: load, parse: parse, quarterTurn: quarterTurn, MAX_TRIANGLES: MAX_TRIANGLES };
  root.CPObj = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
