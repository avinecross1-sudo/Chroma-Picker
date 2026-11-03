/* Chroma Picker - color math.
 * All RGB values are sRGB in 0..255 (floats allowed). */
(function (root) {
  "use strict";

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function round(v) { return Math.round(v); }

  function rgbToHex(rgb) {
    function h(v) { var s = round(clamp(v, 0, 255)).toString(16); return s.length < 2 ? "0" + s : s; }
    return ("#" + h(rgb[0]) + h(rgb[1]) + h(rgb[2])).toUpperCase();
  }

  function hexToRgb(hex) {
    if (typeof hex !== "string") return null;
    var s = hex.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  /* HSB: h 0..360, s 0..100, b 0..100 */
  function rgbToHsb(rgb, prevHue) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d === 0) h = prevHue == null ? 0 : prevHue;
    else if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
  }

  function hsbToRgb(hsb) {
    var h = ((hsb[0] % 360) + 360) % 360, s = clamp(hsb[1], 0, 100) / 100, v = clamp(hsb[2], 0, 100) / 100;
    var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    var r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  /* sRGB transfer */
  function toLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toSrgb(l) { var c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; return c * 255; }
  function rgbToLinear(rgb) { return [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])]; }
  function linearToRgb(lin) {
    return [clamp(toSrgb(Math.max(0, lin[0])), 0, 255), clamp(toSrgb(Math.max(0, lin[1])), 0, 255), clamp(toSrgb(Math.max(0, lin[2])), 0, 255)];
  }

  /* CIE Lab (D50, Bradford-adapted from sRGB D65), like Photoshop's Lab. L 0..100, a/b -128..127 */
  var WX = 0.96422, WY = 1.0, WZ = 0.82521;
  function f(t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; }
  function finv(t) { var t3 = t * t * t; return t3 > 216 / 24389 ? t3 : (116 * t - 16) / (24389 / 27); }

  function rgbToLab(rgb) {
    var l = rgbToLinear(rgb);
    var x = 0.4360747 * l[0] + 0.3850649 * l[1] + 0.1430804 * l[2];
    var y = 0.2225045 * l[0] + 0.7168786 * l[1] + 0.0606169 * l[2];
    var z = 0.0139322 * l[0] + 0.0971045 * l[1] + 0.7141733 * l[2];
    var fx = f(x / WX), fy = f(y / WY), fz = f(z / WZ);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labToRgbUnclamped(lab) {
    var fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
    var x = finv(fx) * WX, y = finv(fy) * WY, z = finv(fz) * WZ;
    var r = 3.1338561 * x - 1.6168667 * y - 0.4906146 * z;
    var g = -0.9787684 * x + 1.9161415 * y + 0.0334540 * z;
    var b = 0.0719453 * x - 0.2289914 * y + 1.4052427 * z;
    return [r, g, b];
  }
  function labInGamut(lab) {
    var l = labToRgbUnclamped(lab), e = 0.0005;
    return l[0] >= -e && l[0] <= 1 + e && l[1] >= -e && l[1] <= 1 + e && l[2] >= -e && l[2] <= 1 + e;
  }
  function labToRgb(lab) { return linearToRgb(labToRgbUnclamped(lab)); }

  /* Simple device CMYK, 0..100 (no ICC profile) */
  function rgbToCmyk(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var k = 1 - Math.max(r, g, b);
    if (k >= 1) return [0, 0, 0, 100];
    return [(1 - r - k) / (1 - k) * 100, (1 - g - k) / (1 - k) * 100, (1 - b - k) / (1 - k) * 100, k * 100];
  }
  function cmykToRgb(c) {
    var k = clamp(c[3], 0, 100) / 100;
    return [255 * (1 - clamp(c[0], 0, 100) / 100) * (1 - k), 255 * (1 - clamp(c[1], 0, 100) / 100) * (1 - k), 255 * (1 - clamp(c[2], 0, 100) / 100) * (1 - k)];
  }

  function luminance(rgb) { var l = rgbToLinear(rgb); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  /* Picker modes. Each mode has channels, conversion, and which channels drive the 2D field and the strip. */
  var MODES = {
    HSB: {
      channels: [
        { key: "H", min: 0, max: 360, unit: "°" },
        { key: "S", min: 0, max: 100, unit: "%" },
        { key: "B", min: 0, max: 100, unit: "%" }],
      to: hsbToRgb,
      from: function (rgb, prev) { return rgbToHsb(rgb, prev ? prev[0] : null); },
      strip: 0, fx: 1, fy: 2
    },
    RGB: {
      channels: [
        { key: "R", min: 0, max: 255, unit: "" },
        { key: "G", min: 0, max: 255, unit: "" },
        { key: "B", min: 0, max: 255, unit: "" }],
      to: function (v) { return [v[0], v[1], v[2]]; },
      from: function (rgb) { return [rgb[0], rgb[1], rgb[2]]; },
      strip: 0, fx: 2, fy: 1
    },
    LAB: {
      channels: [
        { key: "L", min: 0, max: 100, unit: "" },
        { key: "a", min: -128, max: 127, unit: "" },
        { key: "b", min: -128, max: 127, unit: "" }],
      to: labToRgb,
      from: function (rgb) { return rgbToLab(rgb); },
      strip: 0, fx: 1, fy: 2
    },
    CMYK: {
      channels: [
        { key: "C", min: 0, max: 100, unit: "%" },
        { key: "M", min: 0, max: 100, unit: "%" },
        { key: "Y", min: 0, max: 100, unit: "%" },
        { key: "K", min: 0, max: 100, unit: "%" }],
      to: cmykToRgb,
      from: function (rgb) { return rgbToCmyk(rgb); },
      strip: 3, fx: 0, fy: 1, invertY: true
    },
    CUBE: {
      /* Hue cube: hue across, brightness up, saturation on the strip */
      channels: [
        { key: "H", min: 0, max: 360, unit: "°" },
        { key: "S", min: 0, max: 100, unit: "%" },
        { key: "B", min: 0, max: 100, unit: "%" }],
      to: hsbToRgb,
      from: function (rgb, prev) { return rgbToHsb(rgb, prev ? prev[0] : null); },
      strip: 1, fx: 0, fy: 2
    }
  };

  var api = {
    clamp: clamp, rgbToHex: rgbToHex, hexToRgb: hexToRgb,
    rgbToHsb: rgbToHsb, hsbToRgb: hsbToRgb,
    toLinear: toLinear, toSrgb: toSrgb, rgbToLinear: rgbToLinear, linearToRgb: linearToRgb,
    rgbToLab: rgbToLab, labToRgb: labToRgb, labInGamut: labInGamut,
    rgbToCmyk: rgbToCmyk, cmykToRgb: cmykToRgb,
    luminance: luminance, mix: mix, MODES: MODES
  };
  root.CPColor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
