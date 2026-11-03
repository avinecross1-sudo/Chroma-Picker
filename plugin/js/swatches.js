/* Chroma Picker - swatch file writers: Adobe .ase and GIMP/Krita .gpl */
(function (root) {
  "use strict";
  var C = root.CPColor || (typeof require !== "undefined" ? require("./color.js") : null);

  /* colors: [{ name, hex }] -> ArrayBuffer */
  function toASE(colors) {
    var blocks = colors.map(function (c) {
      var name = (c.name || c.hex) + "\u0000";
      var len = 2 + name.length * 2 + 4 + 12 + 2;
      return { name: name, rgb: C.hexToRgb(c.hex), len: len };
    });
    var total = 12 + blocks.reduce(function (s, b) { return s + 6 + b.len; }, 0);
    var buf = new ArrayBuffer(total), dv = new DataView(buf), p = 0;
    "ASEF".split("").forEach(function (ch) { dv.setUint8(p++, ch.charCodeAt(0)); });
    dv.setUint16(p, 1); p += 2; dv.setUint16(p, 0); p += 2;
    dv.setUint32(p, blocks.length); p += 4;
    blocks.forEach(function (b) {
      dv.setUint16(p, 0x0001); p += 2;
      dv.setUint32(p, b.len); p += 4;
      dv.setUint16(p, b.name.length); p += 2;
      for (var i = 0; i < b.name.length; i++) { dv.setUint16(p, b.name.charCodeAt(i)); p += 2; }
      "RGB ".split("").forEach(function (ch) { dv.setUint8(p++, ch.charCodeAt(0)); });
      for (var k = 0; k < 3; k++) { dv.setFloat32(p, b.rgb[k] / 255); p += 4; }
      dv.setUint16(p, 2); p += 2; // normal (non-global, non-spot)
    });
    return buf;
  }

  function toGPL(title, colors) {
    var lines = ["GIMP Palette", "Name: " + title, "Columns: 5", "#"];
    colors.forEach(function (c) {
      var rgb = C.hexToRgb(c.hex);
      function pad(n) { var s = String(n); while (s.length < 3) s = " " + s; return s; }
      lines.push(pad(rgb[0]) + " " + pad(rgb[1]) + " " + pad(rgb[2]) + "\t" + (c.name || c.hex));
    });
    return lines.join("\n") + "\n";
  }

  var api = { toASE: toASE, toGPL: toGPL };
  root.CPSwatches = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
