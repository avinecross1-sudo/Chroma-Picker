/* Chroma Picker - host bridge.
 * In Photoshop (UXP) this talks to the photoshop / uxp modules.
 * In the standalone desktop app (Electron, desktop/) the preload script exposes window.CPDesktop,
 * and the foreground / background chips belong to the app itself and are saved between runs.
 * In a plain browser (for development) it falls back to an in-memory mock. */
(function (root) {
  "use strict";
  var ps = null, uxp = null;
  try { ps = require("photoshop"); } catch (e) { ps = null; }
  try { uxp = require("uxp"); } catch (e) { uxp = null; }

  var isPS = !!(ps && ps.app);
  var desk = (!isPS && root.CPDesktop) ? root.CPDesktop : null;
  var mock = { fg: "#5CC46A", bg: "#2E4D7D" };
  var CHIP_KEY = "chromaPicker.desktopChips";
  if (desk) {
    try { var saved = JSON.parse(localStorage.getItem(CHIP_KEY) || "null"); if (saved && saved.fg && saved.bg) { mock.fg = saved.fg; mock.bg = saved.bg; } } catch (e) { /* defaults */ }
  }
  function saveChips() {
    if (!desk) return;
    try { localStorage.setItem(CHIP_KEY, JSON.stringify({ fg: mock.fg, bg: mock.bg })); } catch (e) { /* ignore */ }
  }

  function hexFromSolid(sc) {
    try { return ("#" + sc.rgb.hexValue).toUpperCase(); } catch (e) { return null; }
  }

  function solidFromHex(hex) {
    var rgb = root.CPColor.hexToRgb(hex);
    var c = new ps.app.SolidColor();
    c.rgb.red = rgb[0]; c.rgb.green = rgb[1]; c.rgb.blue = rgb[2];
    return c;
  }

  /* EyeDropper returns "#rrggbb" or, in some builds, "rgb(r, g, b)". */
  function normHex(v) {
    var m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    if (m) return root.CPColor.rgbToHex([+m[1], +m[2], +m[3]]);
    return v.toUpperCase();
  }

  function modal(name, fn) {
    return ps.core.executeAsModal(fn, { commandName: name });
  }

  var bridge = {
    isPhotoshop: isPS,
    isDesktop: !!desk,
    /* "photoshop", "desktop" or "browser" */
    host: isPS ? "photoshop" : desk ? "desktop" : "browser",

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
      if (!isPS) { mock.fg = hex; saveChips(); return Promise.resolve(); }
      return modal("Set Foreground Color", function () { ps.app.foregroundColor = solidFromHex(hex); }).catch(function (e) { console.warn("setForeground", e); });
    },

    setBackground: function (hex) {
      if (!isPS) { mock.bg = hex; saveChips(); return Promise.resolve(); }
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
      if (desk && desk.copyText) return Promise.resolve(desk.copyText(text));
      try {
        if (navigator.clipboard && navigator.clipboard.setContent) return navigator.clipboard.setContent({ "text/plain": text });
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
      } catch (e) { /* fall through */ }
      return Promise.reject(new Error("Clipboard unavailable"));
    },

    /* Save a file the user picks. data: string or ArrayBuffer */
    saveFile: function (suggestedName, ext, data, binary) {
      if (desk && desk.saveFile) return desk.saveFile(suggestedName, ext, data, !!binary);
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

    /* Let the user pick a text file to open. Resolves to { name, text }, or null when cancelled.
     * In a browser or the desktop app a cancelled picker may simply never resolve, which is harmless here. */
    openTextFile: function (ext) {
      if (uxp && uxp.storage && isPS) {
        var lfs = uxp.storage.localFileSystem, formats = uxp.storage.formats;
        return lfs.getFileForOpening({ types: [ext] }).then(function (file) {
          if (!file) return null;
          return file.read({ format: formats.utf8 }).then(function (text) { return { name: file.name, text: text }; });
        });
      }
      return new Promise(function (resolve, reject) {
        var input = document.createElement("input");
        input.type = "file"; input.accept = "." + ext; input.style.display = "none";
        input.addEventListener("change", function () {
          var f = input.files && input.files[0];
          input.remove();
          if (!f) { resolve(null); return; }
          bridge.readFile(f).then(resolve, reject);
        });
        document.body.appendChild(input);
        input.click();
      });
    },

    /* Reads a dropped or picked browser File as text: { name, text } */
    readFile: function (f) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve({ name: f.name, text: String(r.result) }); };
        r.onerror = function () { reject(r.error || new Error("Could not read the file")); };
        r.readAsText(f);
      });
    },

    /* Pick any color on screen (desktop app and Chromium browsers; not available in UXP).
     * Resolves to a hex string, or null when cancelled. */
    canPickScreen: !isPS && typeof root.EyeDropper === "function",
    pickScreen: function () {
      if (isPS || typeof root.EyeDropper !== "function") return Promise.resolve(null);
      return new root.EyeDropper().open().then(function (r) { return r && r.sRGBHex ? normHex(r.sRGBHex) : null; }, function () { return null; });
    },

    _mock: mock
  };

  root.CPBridge = bridge;
})(typeof window !== "undefined" ? window : globalThis);
