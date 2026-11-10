/* Chroma Picker - planar head model for the lit preview.
 *
 * An original low-poly "planes of the head" study bust: the forms of a head simplified into flat facets so each
 * plane catches the light on its own. It is authored here by hand as named points for the right half, mirrored to
 * the left. The head, the ears, the neck and the round stand are separate solids that overlap; the ray tracer
 * shows their union.
 *
 * Head units are roughly centimeters: x to the model's left (screen right from the front), y up from the chin,
 * z forward out of the face. build() returns triangles in scene units, standing on the ground plane. */
(function (root) {
  "use strict";

  /* right half of the head (x >= 0); points with x = 0 lie on the center line */
  var V = {
    /* profile, chin to crown to nape */
    cChinB: [0, 0.0, 6.4], cChinF: [0, 1.5, 8.8], cSulc: [0, 3.2, 8.3], cLipL: [0, 4.1, 9.4], cMouth: [0, 4.95, 9.15],
    cLipU: [0, 5.7, 9.6], cSubn: [0, 6.9, 9.4], cTip: [0, 7.7, 12.2], cTipTop: [0, 8.8, 11.9], cBridge: [0, 10.5, 10.5],
    cNasion: [0, 12.1, 9.3], cGlab: [0, 13.5, 10.1], cFore: [0, 15.3, 10.2], cHair: [0, 19.7, 8.2], cCrownF: [0, 22.3, 3.6],
    cTop: [0, 23.0, -1.6], cCrownB: [0, 21.5, -7.0], cBack: [0, 16.4, -10.2], cOcc: [0, 10.4, -9.2], cNape: [0, 6.4, -6.4],
    cUnder: [0, 0.9, 1.5],
    /* nose */
    nRoot: [0.85, 12.0, 8.8], nBridge: [0.8, 10.4, 9.85], nTipU: [0.95, 8.8, 11.2], nTipS: [1.0, 7.6, 11.5],
    nWing: [1.9, 7.25, 9.75], nWingT: [1.65, 8.5, 9.95], nSide: [1.75, 9.9, 8.75],
    /* eye and brow */
    eIn: [1.65, 11.4, 8.2], eOut: [4.95, 11.5, 7.3], eTop: [3.2, 12.4, 8.5], eBot: [3.35, 10.65, 8.25], eC: [3.3, 11.5, 8.95],
    bIn: [1.35, 13.2, 9.95], bMid: [3.6, 13.95, 9.85], bOut: [5.75, 13.45, 8.1],
    /* cheek */
    kInf: [2.7, 9.7, 8.85], kZyg: [5.5, 9.5, 7.7], kZygS: [7.0, 9.9, 3.2], kOrb: [6.0, 11.8, 6.3],
    kNl: [2.75, 7.5, 8.75], kLow: [4.5, 5.6, 7.1], kMass: [6.05, 5.9, 3.0],
    /* mouth and chin */
    mCorner: [2.35, 4.95, 8.15], mLipU: [1.1, 5.85, 9.3], mLipL: [1.3, 4.15, 9.0], mSulc: [1.7, 3.1, 8.15],
    jChinF: [2.25, 1.7, 8.2], jChinB: [2.35, 0.3, 6.8], jMid: [4.3, 1.5, 4.4], jAng: [5.75, 3.5, -0.4], jRam: [6.65, 8.5, 0.5],
    /* forehead and skull */
    tFront: [6.3, 14.8, 6.5], fBrow: [3.5, 15.5, 9.75], fSide: [5.4, 16.9, 7.7], fHair: [4.7, 19.7, 6.3],
    sTemple: [7.3, 16.6, 2.4], sSide: [6.6, 20.0, 0.8], sCrownF: [3.5, 21.9, 3.8], sTop: [4.2, 22.4, -1.4],
    sEar: [7.5, 12.6, -0.8], sWide: [7.8, 15.2, -2.8], sBackU: [5.5, 20.5, -6.2], sBack: [6.3, 15.4, -7.6],
    sOcc: [5.1, 10.3, -7.4], sMast: [6.2, 8.8, -2.8], sNape: [3.5, 6.5, -5.6]
  };

  /* facets of the right half, as polygons over the points above */
  var F = [
    /* forehead and brow */
    ["cGlab", "bIn", "fBrow", "cFore"], ["bIn", "bMid", "fBrow"], ["bMid", "fSide", "fBrow"],
    ["bMid", "bOut", "tFront"], ["bMid", "tFront", "fSide"], ["cFore", "fBrow", "fHair", "cHair"], ["fBrow", "fSide", "fHair"],
    /* temple and side of the skull */
    ["bOut", "kOrb", "tFront"], ["tFront", "kOrb", "kZygS"], ["tFront", "kZygS", "sEar"], ["tFront", "sEar", "sTemple"],
    ["tFront", "sTemple", "fSide"], ["fSide", "sTemple", "sSide", "fHair"],
    ["sTemple", "sEar", "sWide"], ["sTemple", "sWide", "sSide"],
    /* top */
    ["cHair", "fHair", "sCrownF", "cCrownF"], ["fHair", "sSide", "sCrownF"], ["cCrownF", "sCrownF", "sTop", "cTop"],
    ["sCrownF", "sSide", "sTop"], ["sSide", "sBackU", "sTop"], ["sTop", "sBackU", "cCrownB", "cTop"], ["sSide", "sWide", "sBackU"],
    /* back */
    ["sWide", "sBack", "sBackU"], ["sBackU", "sBack", "cBack", "cCrownB"], ["sBack", "sOcc", "cOcc", "cBack"],
    ["sWide", "sMast", "sOcc", "sBack"], ["sEar", "sMast", "sWide"], ["sOcc", "sNape", "cNape", "cOcc"], ["sMast", "sNape", "sOcc"],
    /* eye socket and eye */
    ["bIn", "eIn", "eTop", "bMid"], ["bMid", "eTop", "eOut", "bOut"], ["nRoot", "eIn", "bIn"], ["cNasion", "nRoot", "bIn", "cGlab"],
    ["bOut", "eOut", "kOrb"], ["eOut", "kZyg", "kOrb"], ["kOrb", "kZyg", "kZygS"],
    ["eIn", "eC", "eTop"], ["eTop", "eC", "eOut"], ["eOut", "eC", "eBot"], ["eBot", "eC", "eIn"],
    ["eIn", "eBot", "kInf"], ["eBot", "eOut", "kZyg", "kInf"],
    /* nose */
    ["cNasion", "cBridge", "nBridge", "nRoot"], ["cBridge", "cTipTop", "nTipU", "nBridge"], ["cTipTop", "cTip", "nTipS", "nTipU"],
    ["cTip", "cSubn", "nWing", "nTipS"], ["nRoot", "nBridge", "nSide"], ["nRoot", "nSide", "eIn"],
    ["nBridge", "nTipU", "nWingT", "nSide"], ["nTipU", "nTipS", "nWing", "nWingT"], ["nWingT", "nWing", "kNl"], ["nWingT", "kNl", "nSide"],
    /* cheek */
    ["eIn", "nSide", "kInf"], ["nSide", "kNl", "kInf"], ["kInf", "kNl", "kLow", "kZyg"], ["kZyg", "kLow", "kMass", "kZygS"],
    ["kZygS", "kMass", "jAng", "jRam"], ["kMass", "jMid", "jAng"], ["kLow", "jMid", "kMass"], ["kZygS", "jRam", "sMast", "sEar"],
    /* mouth and chin */
    ["cSubn", "cLipU", "mLipU", "nWing"], ["nWing", "mLipU", "mCorner", "kNl"], ["kNl", "mCorner", "kLow"],
    ["cLipU", "cMouth", "mCorner", "mLipU"], ["cMouth", "cLipL", "mLipL", "mCorner"],
    ["cLipL", "cSulc", "mSulc", "mLipL"], ["mLipL", "mSulc", "mCorner"], ["cSulc", "cChinF", "jChinF", "mSulc"],
    ["cChinF", "cChinB", "jChinB", "jChinF"], ["mCorner", "mSulc", "jChinF", "kLow"], ["kLow", "jChinF", "jChinB", "jMid"],
    /* underside (mostly hidden by the neck) */
    ["cChinB", "cUnder", "jMid", "jChinB"], ["cUnder", "jAng", "jMid"], ["cUnder", "cNape", "sNape", "jAng"],
    ["jAng", "sNape", "sMast"], ["jAng", "sMast", "jRam"]
  ];

  /* outline of the right ear seen from the side, as [z, y, how far it stands out from the head] */
  var EAR = [[0.9, 12.4, 0.0], [-0.6, 13.3, 0.9], [-2.3, 12.9, 1.7], [-3.1, 11.2, 1.9], [-2.5, 9.3, 1.4], [-1.0, 8.0, 0.6], [0.6, 8.7, 0.0]];
  var EAR_X = 7.25, EAR_BOWL = [-0.9, 10.9, 0.45];

  var NECK_SIDES = 10, NECK_C = [0, -1.9], NECK_TOP = 7.0, NECK_BOTTOM = -4.6;
  var STAND_SIDES = 36, STAND_R = 8.2, STAND_H = 3.4;
  var UNIT = 0.0745;                                   /* scene units per head unit */

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  /* Collects triangles, turning each one so it faces away from the middle of its solid.
   * round > 0 marks the curved wall of the stand: it is shaded as a smooth cylinder of that radius. */
  function builder() {
    var tris = [];
    function tri(a, b, c, inside, round) {
      var n = cross(sub(b, a), sub(c, a));
      if (dot(n, n) < 1e-12) return;
      var mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      if (dot(n, sub(mid, inside)) < 0) { var t = b; b = c; c = t; }
      tris.push({ a: a, b: b, c: c, round: round || 0 });
    }
    function poly(pts, inside, round) { for (var i = 1; i + 1 < pts.length; i++) tri(pts[0], pts[i], pts[i + 1], inside, round); }
    return { tris: tris, tri: tri, poly: poly };
  }

  function mirror(p) { return [-p[0], p[1], p[2]]; }

  function buildRaw() {
    var B = builder(), i;
    /* head */
    var core = [0, 11, -1];
    F.forEach(function (f) {
      var pts = f.map(function (k) { return V[k]; });
      B.poly(pts, core);
      B.poly(pts.map(mirror), core);
    });
    /* ears: a shallow bowl standing off the side of the head, deeper toward the back */
    [1, -1].forEach(function (side) {
      var rim = EAR.map(function (e) { return [side * (EAR_X + e[2]), e[1], e[0]]; });
      var root = EAR.map(function (e) { return [side * (EAR_X - 1.6), e[1] * 0.8 + 2.1, e[0] * 0.8 - 0.2]; });
      var bowl = [side * (EAR_X + EAR_BOWL[2]), EAR_BOWL[1], EAR_BOWL[0]];
      var inside = [side * (EAR_X - 0.6), 10.7, -1.0];
      for (i = 0; i < rim.length; i++) {
        var j = (i + 1) % rim.length;
        B.tri(rim[i], rim[j], bowl, inside);
        B.poly([rim[i], rim[j], root[j], root[i]], inside);
      }
    });
    /* neck: a faceted column, a little wider at the bottom, leaning into the skull */
    var ringT = [], ringB = [], a;
    for (i = 0; i < NECK_SIDES; i++) {
      a = (i + 0.5) / NECK_SIDES * Math.PI * 2;
      ringT.push([Math.sin(a) * 4.8, NECK_TOP, NECK_C[1] + 0.9 + Math.cos(a) * 5.2]);
      ringB.push([Math.sin(a) * 5.7, NECK_BOTTOM, NECK_C[1] - 0.3 + Math.cos(a) * 5.8]);
    }
    var neckMid = [0, 0, NECK_C[1]];
    for (i = 0; i < NECK_SIDES; i++) B.poly([ringT[i], ringT[(i + 1) % NECK_SIDES], ringB[(i + 1) % NECK_SIDES], ringB[i]], neckMid);
    /* stand: a round plinth */
    var y1 = NECK_BOTTOM + 0.4, y0 = y1 - STAND_H, cz = NECK_C[1] + 0.6, standMid = [0, (y0 + y1) / 2, cz], top = [0, y1, cz];
    for (i = 0; i < STAND_SIDES; i++) {
      var a0 = i / STAND_SIDES * Math.PI * 2, a1 = (i + 1) / STAND_SIDES * Math.PI * 2;
      var p0 = [Math.sin(a0) * STAND_R, 0, cz + Math.cos(a0) * STAND_R], p1 = [Math.sin(a1) * STAND_R, 0, cz + Math.cos(a1) * STAND_R];
      B.poly([[p0[0], y1, p0[2]], [p1[0], y1, p1[2]], [p1[0], y0, p1[2]], [p0[0], y0, p0[2]]], standMid, STAND_R);
      B.tri(top, [p0[0], y1, p0[2]], [p1[0], y1, p1[2]], standMid);
    }
    return { tris: B.tris, floor: y0, center: [0, cz] };
  }

  /* Triangles in scene units: the stand sits on y = groundY, centered on the origin. */
  function build(groundY) {
    var raw = buildRaw(), s = UNIT;
    function put(p) { return [p[0] * s, groundY + (p[1] - raw.floor) * s, (p[2] - raw.center[1]) * s]; }
    var tris = raw.tris.map(function (t) { return { a: put(t.a), b: put(t.b), c: put(t.c), round: t.round * s }; });
    return {
      tris: tris,
      standRadius: STAND_R * s,
      top: groundY + (V.cTop[1] - raw.floor) * s,
      /* middle of the face, used to aim the camera */
      focus: [0, groundY + (11 - raw.floor) * s, 0]
    };
  }

  var api = { build: build, points: V, facets: F };
  root.CPHead = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
