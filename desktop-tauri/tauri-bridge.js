/* Chroma Picker - the few desktop services the shared UI needs, in the Tauri app (see plugin/js/bridge.js).
 * Loaded before bridge.js. The Electron app's preload script exposed the same window.CPDesktop. */
(function () {
  "use strict";
  var T = window.__TAURI__;
  if (!T || !T.core) return;
  var invoke = T.core.invoke;
  window.CPDesktop = {
    copyText: function (text) { return invoke("copy_text", { text: String(text) }); },
    saveFile: function (name, ext, data, binary) {
      var args = { name: name, ext: ext, text: null, bytes: null };
      if (binary) args.bytes = Array.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      else args.text = String(data);
      return invoke("save_file", args);
    }
  };
  /* Window shortcuts, as in the Electron app's View menu: Ctrl/Cmd+T keeps the window on top,
   * Ctrl/Cmd + = / - / 0 scale the whole interface (the model view zooms with + and - alone). */
  var zoom = 1;
  try { zoom = parseFloat(localStorage.getItem("chromaPicker.uiZoom")) || 1; } catch (e) { /* default */ }
  function setZoom(z) {
    zoom = Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));
    try { localStorage.setItem("chromaPicker.uiZoom", String(zoom)); } catch (e) { /* ignore */ }
    invoke("set_ui_zoom", { factor: zoom });
  }
  if (zoom !== 1) setZoom(zoom);
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = e.key, hit = true;
    if (k === "t" || k === "T") invoke("toggle_always_on_top");
    else if (k === "=" || k === "+") setZoom(zoom + 0.1);
    else if (k === "-" || k === "_") setZoom(zoom - 0.1);
    else if (k === "0") setZoom(1);
    else if (k === "r" || k === "R" || k === "p" || k === "P" || k === "f" || k === "F" || k === "g" || k === "G" || k === "u" || k === "U") { /* browser shortcuts that make no sense here */ }
    else hit = false;
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  /* no browser context menu (Back, Reload, Inspect...) except in text fields, where copy and paste are useful */
  document.addEventListener("contextmenu", function (e) {
    var tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
    if (tag !== "input" && tag !== "textarea") e.preventDefault();
  });
})();
