/* Chroma Picker - tiny PNG encoder (RGB, uncompressed deflate) and base64.
 * UXP panels cannot reliably put pixels on a canvas, so every rendered image
 * (3D preview, picker field, slider tracks) is encoded as a PNG data URL. */
(function (root) {
  "use strict";

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf, start, end) {
    var c = 0xffffffff;
    for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function base64(bytes) {
    var out = [], i, n = bytes.length, chunk = "";
    for (i = 0; i + 2 < n; i += 3) {
      var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      chunk += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
      if (chunk.length > 8192) { out.push(chunk); chunk = ""; }
    }
    if (i < n) {
      var a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0;
      var w = (a << 16) | (b << 8);
      chunk += B64[(w >> 18) & 63] + B64[(w >> 12) & 63] + (i + 1 < n ? B64[(w >> 6) & 63] : "=") + "=";
    }
    out.push(chunk);
    return out.join("");
  }

  /* rgb: Uint8Array of w*h*3 bytes. Returns PNG bytes. */
  function encode(rgb, w, h) {
    var rowLen = w * 3 + 1;
    var raw = rowLen * h;
    var nBlocks = Math.max(1, Math.ceil(raw / 65535));
    var zlen = 2 + raw + nBlocks * 5 + 4;
    var total = 8 + 25 + (12 + zlen) + 12;
    var out = new Uint8Array(total);
    var p = 0;
    function u32(v) { out[p++] = (v >>> 24) & 255; out[p++] = (v >>> 16) & 255; out[p++] = (v >>> 8) & 255; out[p++] = v & 255; }
    function str(s) { for (var i = 0; i < s.length; i++) out[p++] = s.charCodeAt(i); }

    out.set([137, 80, 78, 71, 13, 10, 26, 10], 0); p = 8;
    // IHDR
    u32(13); var cs = p; str("IHDR"); u32(w); u32(h);
    out[p++] = 8; out[p++] = 2; out[p++] = 0; out[p++] = 0; out[p++] = 0;
    u32(crc32(out, cs, p));
    // IDAT
    u32(zlen); cs = p; str("IDAT");
    out[p++] = 0x78; out[p++] = 0x01;
    var a1 = 1, a2 = 0, left = raw, row = 0, col = 0;
    for (var bI = 0; bI < nBlocks; bI++) {
      var len = Math.min(65535, left); left -= len;
      out[p++] = left === 0 ? 1 : 0;
      out[p++] = len & 255; out[p++] = len >> 8; out[p++] = ~len & 255; out[p++] = (~len >> 8) & 255;
      for (var j = 0; j < len; j++) {
        var byte;
        if (col === 0) byte = 0; else byte = rgb[row * w * 3 + col - 1];
        out[p++] = byte;
        a1 = (a1 + byte) % 65521; a2 = (a2 + a1) % 65521;
        col++; if (col === rowLen) { col = 0; row++; }
      }
    }
    u32(((a2 << 16) | a1) >>> 0);
    u32(crc32(out, cs, p));
    // IEND
    u32(0); cs = p; str("IEND"); u32(crc32(out, cs, p));
    return out;
  }

  function dataUrl(rgb, w, h) { return "data:image/png;base64," + base64(encode(rgb, w, h)); }

  var api = { encode: encode, dataUrl: dataUrl, base64: base64, crc32: crc32 };
  root.CPPng = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
