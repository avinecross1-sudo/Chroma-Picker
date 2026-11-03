/* Chroma Picker - host bridge.
 * In Photoshop (UXP) this talks to the photoshop / uxp modules.
 * In a plain browser (for development) it falls back to an in-memory mock. */
(function (root) {
  "use strict";
  var ps = null, uxp = null;
  try { ps = require("photoshop"); } catch (e) { ps = null; }
  try { uxp = require("uxp"); } catch (e) { uxp = null; }

  var isPS = !!(ps && ps.app);
  var mock = { fg: "#5CC46A", bg: "#2E4D7D" };

  function hexFromSolid(sc) {
    try { return ("#" + sc.rgb.hexValue).toUpperCase(); } catch (e) { return null; }
  }

  function solidFromHex(hex) {
    var rgb = root.CPColor.hexToRgb(hex);
    var c = new ps.app.SolidColor();
    c.rgb.red = rgb[0]; c.rgb.green = rgb[1]; c.rgb.blue = rgb[2];
    return c;
  }

  function modal(name, fn) {
    return ps.core.executeAsModal(fn, { commandName: name });
  }

  var bridge = {
    isPhotoshop: isPS,

    /* returns { fg, bg } hex strings */
    getColors: function () {
      if (!isPS) return Promise.resolve({ fg: mock.fg, bg: mock.bg });
      try {
        return Promise.resolve({ fg: hexFromSolid(ps.app.foregroundColor), bg: hexFromSolid(ps.app.backgroundColor) });
      } catch (e) {
        return Promise.resolve({ fg: null, bg: null });
      }
    },

    setForeground: function (hex) {
      if (!isPS) { mock.fg = hex; return Promise.resolve(); }
      return modal("Set Foreground Color", function () { ps.app.foregroundColor = solidFromHex(hex); }).catch(function (e) { console.warn("setForeground", e); });
    },

    setBackground: function (hex) {
      if (!isPS) { mock.bg = hex; return Promise.resolve(); }
      return modal("Set Background Color", function () { ps.app.backgroundColor = solidFromHex(hex); }).catch(function (e) { console.warn("setBackground", e); });
    },

    /* Set the current brush tip diameter in pixels (best effort; needs a brush-type tool active). */
    setBrushSize: function (px) {
      if (!isPS) { mock.brush = px; return Promise.resolve(); }
      return modal("Set Brush Size", function () {
        return ps.action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "brush", _enum: "ordinal", _value: "targetEnum" }],
          to: { _obj: "brush", masterDiameter: { _unit: "pixelsUnit", _value: px } }
        }], {});
      }).catch(function (e) { console.warn("setBrushSize", e); });
    },

    /* Subscribe to Photoshop events that commonly change the color chips. */
    onHostColorEvent: function (cb) {
      if (!isPS || !ps.action || !ps.action.addNotificationListener) return;
      try {
        ps.action.addNotificationListener(["set", "exchange", "reset", "select"], function () { cb(); });
      } catch (e) { /* polling still covers it */ }
    },

    copyText: function (text) {
      try {
        if (navigator.clipboard && navigator.clipboard.setContent) return navigator.clipboard.setContent({ "text/plain": text });
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
      } catch (e) { /* fall through */ }
      return Promise.reject(new Error("Clipboard unavailable"));
    },

    /* Save a file the user picks. data: string or ArrayBuffer */
    saveFile: function (suggestedName, ext, data, binary) {
      if (uxp && uxp.storage) {
        var lfs = uxp.storage.localFileSystem, formats = uxp.storage.formats;
        return lfs.getFileForSaving(suggestedName, { types: [ext] }).then(function (file) {
          if (!file) return false;
          return file.write(data, { format: binary ? formats.binary : formats.utf8 }).then(function () { return true; });
        });
      }
      var blob = new Blob([data], { type: binary ? "application/octet-stream" : "text/plain" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = suggestedName;
      document.body.appendChild(a); a.click(); a.remove();
      return Promise.resolve(true);
    },

    _mock: mock
  };

  root.CPBridge = bridge;
})(typeof window !== "undefined" ? window : globalThis);
