/* Chroma Picker - panel UI and app logic. */
(function () {
  "use strict";
  var C = window.CPColor, R = window.CPRender, P = window.CPPng, SW = window.CPSwatches, B = window.CPBridge;
  var MODES = C.MODES;

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------- storage (localStorage is available in UXP; guard anyway) ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("chromaPicker." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("chromaPicker." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  /* ---------- state ---------- */
  var DEFAULTS = {
    colors: { shape: "#C8643C", sky: "#86A9E0", horizon: "#E6DCCB", ground: "#6E6253", light: "#FFF3E2" },
    bg: "#FFFFFF",
    shape: "sphere", lightMode: "manual", spot: false,
    az: -25, el: 40, time: 16, intensity: 1.1, ambient: 0.4,
    specular: 0.35, reflectivity: 0.08, subsurface: 0, fog: 0, contrast: 1, toon: false, chrome: false,
    yaw: 25, pitch: 18
  };
  var UNDO_KEYS = Object.keys(DEFAULTS);

  var state = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), store.get("state", {}));
  state.colors = Object.assign({}, DEFAULTS.colors, state.colors || {});
  var ui = Object.assign({
    target: "shape", mode: "HSB", dragMode: "light", trueColor: false, split: 0.5,
    compact: false, sync: true, closed: {}
  }, store.get("ui", {}));
  var favorites = store.get("favorites", []);
  var history = store.get("history", []);
  var userPresets = store.get("presets", []);

  var host = { fg: state.colors.shape, bg: state.bg };
  var undoStack = [], redoStack = [], editSnap = null;
  var lastRender = null, previousHex = state.colors.shape;

  function snapshot() { var o = {}; UNDO_KEYS.forEach(function (k) { o[k] = JSON.parse(JSON.stringify(state[k])); }); return o; }
  function restore(s) { UNDO_KEYS.forEach(function (k) { state[k] = JSON.parse(JSON.stringify(s[k])); }); }

  function beginEdit() { if (!editSnap) editSnap = snapshot(); }
  function endEdit() {
    if (!editSnap) return;
    var before = editSnap; editSnap = null;
    if (JSON.stringify(before) === JSON.stringify(snapshot())) return;
    undoStack.push(before); if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    if (before.colors.shape !== state.colors.shape) {
      previousHex = before.colors.shape;
      addHistory(state.colors.shape);
      pushForeground(state.colors.shape, true);
    }
    persist();
    refreshAll(true);
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot()); restore(undoStack.pop());
    pushForeground(state.colors.shape, true); persist(); refreshAll(true); status("Undo");
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot()); restore(redoStack.pop());
    pushForeground(state.colors.shape, true); persist(); refreshAll(true); status("Redo");
  }

  var persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      store.set("state", snapshot()); store.set("ui", ui);
      store.set("favorites", favorites); store.set("history", history); store.set("presets", userPresets);
    }, 250);
  }

  var statusTimer = null;
  function status(msg) {
    $("status").textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { $("status").textContent = B.isPhotoshop ? "" : "Browser preview (no Photoshop)"; }, 2200);
  }

  /* ---------- time of day ---------- */
  var TOD = [
    // hour, sky, horizon, ground, sun color, intensity, ambient multiplier
    [0, "#0B1024", "#1A2038", "#0D0E12", "#8DA2D8", 0.18, 0.55],
    [5, "#18203F", "#3A3550", "#15141A", "#9AA8D8", 0.2, 0.6],
    [6.5, "#5A6C9E", "#F0A070", "#3B3028", "#FF9A55", 0.55, 0.8],
    [9, "#78A2E2", "#DCE2E6", "#5E5446", "#FFE2BC", 0.95, 1],
    [12, "#5D93E8", "#CFE0F2", "#6B6152", "#FFF8EE", 1.1, 1],
    [15, "#6A9AE4", "#D8E0E6", "#685C4C", "#FFEBD2", 1.0, 1],
    [17.5, "#7C8EC8", "#F2BC80", "#4F4234", "#FFB066", 0.85, 0.9],
    [19, "#4A4E86", "#E8785A", "#2E2622", "#FF7040", 0.45, 0.75],
    [20.5, "#1E2448", "#4A3A5A", "#16151A", "#9AA0D0", 0.22, 0.6],
    [24, "#0B1024", "#1A2038", "#0D0E12", "#8DA2D8", 0.18, 0.55]
  ];
  function mixHex(a, b, t) {
    var la = C.rgbToLinear(C.hexToRgb(a)), lb = C.rgbToLinear(C.hexToRgb(b));
    return C.rgbToHex(C.linearToRgb(C.mix(la, lb, t)));
  }
  function timeOfDay(h) {
    h = ((h % 24) + 24) % 24;
    var i = 0; while (i < TOD.length - 2 && TOD[i + 1][0] <= h) i++;
    var a = TOD[i], b = TOD[i + 1], t = (h - a[0]) / (b[0] - a[0]);
    var day = h >= 6 && h <= 19;
    var el = day ? Math.max(2, 72 * Math.sin(Math.PI * (h - 6) / 13)) : 38;
    var az = day ? -105 + 210 * (h - 6) / 13 : 160;
    return {
      sky: mixHex(a[1], b[1], t), horizon: mixHex(a[2], b[2], t), ground: mixHex(a[3], b[3], t),
      light: mixHex(a[4], b[4], t), intensity: lerp(a[5], b[5], t), ambientMul: lerp(a[6], b[6], t), el: el, az: az
    };
  }

  /* Effective (resolved) lighting, whether manual or time based */
  function lighting() {
    if (state.lightMode === "time") {
      var t = timeOfDay(state.time);
      return {
        sky: t.sky, horizon: t.horizon, ground: t.ground, light: t.light,
        intensity: state.intensity * t.intensity, ambient: state.ambient * t.ambientMul, az: t.az, el: t.el
      };
    }
    return {
      sky: state.colors.sky, horizon: state.colors.horizon, ground: state.colors.ground, light: state.colors.light,
      intensity: state.intensity, ambient: state.ambient, az: state.az, el: state.el
    };
  }

  /* Editing an environment color or the light while in time-of-day mode bakes the current time into manual mode. */
  function bakeToManual() {
    if (state.lightMode !== "time") return;
    var t = timeOfDay(state.time);
    state.colors.sky = t.sky; state.colors.horizon = t.horizon; state.colors.ground = t.ground; state.colors.light = t.light;
    state.az = t.az; state.el = t.el;
    state.intensity = state.intensity * t.intensity; state.ambient = state.ambient * t.ambientMul;
    state.lightMode = "manual";
    status("Switched to manual lighting");
  }

  function lin(hex) { return C.rgbToLinear(C.hexToRgb(hex)); }

  function sceneParams() {
    var L = lighting();
    return {
      albedo: lin(state.colors.shape), flatAlbedoRgb: C.hexToRgb(state.colors.shape),
      sky: lin(L.sky), horizon: lin(L.horizon), ground: lin(L.ground), groundEnv: lin(L.ground),
      lightDir: R.dirFromAngles(L.az, L.el), lightColor: lin(L.light),
      intensity: L.intensity, ambient: L.ambient, spot: state.spot,
      specular: state.specular, reflectivity: state.reflectivity, subsurface: state.subsurface,
      toon: state.toon, chrome: state.chrome, fog: state.fog, contrast: state.contrast,
      shape: state.shape, yaw: state.yaw, pitch: state.pitch,
      split: ui.trueColor ? ui.split : null
    };
  }

  /* ---------- rendering ---------- */
  var renderPending = false, renderHQ = false, hqTimer = null;
  var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(f, 16); };

  function requestRender(hq) {
    renderHQ = renderHQ || hq;
    if (renderPending) return;
    renderPending = true;
    raf(function () {
      renderPending = false;
      var q = renderHQ; renderHQ = false;
      doRender(q);
      if (!q) { clearTimeout(hqTimer); hqTimer = setTimeout(function () { requestRender(true); }, 220); }
    });
  }

  function previewSize() {
    var el = $("preview"), r = el.getBoundingClientRect();
    var w = r.width || 280, h = r.height || 220;
    return { w: w, h: h };
  }

  function doRender(hq) {
    var sz = previewSize();
    var base = hq ? 260 : 150;
    var w = base, h = Math.max(40, Math.round(base * sz.h / sz.w));
    var S = sceneParams();
    var res = R.render(S, w, h, hq ? 2 : 1);
    lastRender = res;
    $("previewImg").src = P.dataUrl(res.rgb, w, h);
    var uv = R.lightHandle(S, w / h);
    var dot = $("lightDot");
    if (uv && uv[0] > -0.05 && uv[0] < 1.05 && uv[1] > -0.05 && uv[1] < 1.05) {
      dot.classList.remove("hidden");
      dot.style.left = (clamp(uv[0], 0, 1) * 100) + "%"; dot.style.top = (clamp(uv[1], 0, 1) * 100) + "%";
      dot.style.backgroundColor = lighting().light;
    } else dot.classList.add("hidden");
    var sh = $("splitHandle"), lbl = $("previewLabel");
    if (ui.trueColor) { sh.classList.remove("hidden"); lbl.classList.remove("hidden"); sh.style.left = (ui.split * 100) + "%"; }
    else { sh.classList.add("hidden"); lbl.classList.add("hidden"); }
    renderPalette();
  }

  /* ---------- color access for the current picker target ---------- */
  var cache = { key: null, vals: null, hex: null };

  function targetHex() {
    if (ui.target === "shape") return state.colors.shape;
    if (state.lightMode === "time") return lighting()[ui.target];
    return state.colors[ui.target];
  }

  function getVals() {
    var key = ui.target + "|" + ui.mode, hex = targetHex();
    if (cache.key === key && cache.hex === hex) return cache.vals.slice();
    var prev = cache.key === key ? cache.vals : null;
    var vals = MODES[ui.mode].from(C.hexToRgb(hex), prev);
    cache = { key: key, vals: vals.slice(), hex: hex };
    return vals;
  }

  function setVals(vals, live) {
    var m = MODES[ui.mode];
    vals = vals.map(function (v, i) { return clamp(v, m.channels[i].min, m.channels[i].max); });
    var hex = C.rgbToHex(m.to(vals));
    cache = { key: ui.target + "|" + ui.mode, vals: vals.slice(), hex: hex };
    setTargetHex(ui.target, hex, live);
  }

  function setTargetHex(target, hex, live) {
    if (target !== "shape") bakeToManual();
    state.colors[target] = hex;
    if (target === "shape") pushForeground(hex, false);
    refreshAll(!live);
  }

  /* Set shape color from outside (hex input, swatches, host) as one undo step */
  function applyShapeHex(hex) {
    beginEdit();
    state.colors.shape = hex;
    endEdit();
    refreshAll(true);
  }

  /* ---------- Photoshop sync ---------- */
  var pushTimer = null, pushing = 0, quietUntil = 0;
  function pushForeground(hex, immediate) {
    host.fg = hex; updateChips();
    if (!ui.sync) return;
    quietUntil = Date.now() + 700;
    clearTimeout(pushTimer);
    var go = function () {
      pushing++;
      B.setForeground(hex).then(function () { pushing--; quietUntil = Date.now() + 400; }, function () { pushing--; });
    };
    if (immediate) go(); else pushTimer = setTimeout(go, 90);
  }
  function pushBackground(hex) {
    host.bg = hex; state.bg = hex; updateChips();
    quietUntil = Date.now() + 700;
    B.setBackground(hex);
  }
  /* Send a color to the foreground without changing the base color (palette / sample). */
  function sendToForeground(hex) {
    host.fg = hex; updateChips();
    quietUntil = Date.now() + 700;
    B.setForeground(hex);
    addHistory(hex);
  }

  function pollHost() {
    if (!ui.sync || pushing || Date.now() < quietUntil || editSnap) return;
    B.getColors().then(function (c) {
      if (pushing || Date.now() < quietUntil || editSnap) return;
      if (c.bg && c.bg !== host.bg) { host.bg = c.bg; state.bg = c.bg; updateChips(); }
      if (c.fg && c.fg !== host.fg) {
        host.fg = c.fg;
        if (c.fg !== state.colors.shape) {
          previousHex = state.colors.shape;
          state.colors.shape = c.fg;
          addHistory(c.fg);
          persist();
          refreshAll(true);
        } else updateChips();
      }
    });
  }

  /* ---------- swatches ---------- */
  function addHistory(hex) {
    history = history.filter(function (h) { return h !== hex; });
    history.unshift(hex);
    if (history.length > 24) history.length = 24;
    renderSwatches(); persist();
  }

  function copyHex(hex) {
    B.copyText(hex).then(function () { status("Copied " + hex); }, function () { status(hex); });
  }

  function swatchEl(hex, onClick, title) {
    var d = document.createElement("div");
    d.className = "sw"; d.style.backgroundColor = hex; d.title = title || hex;
    d.addEventListener("click", function (e) { onClick(e, hex); });
    return d;
  }

  function renderSwatches() {
    var fav = $("favorites"), his = $("history");
    fav.innerHTML = ""; his.innerHTML = "";
    if (!favorites.length) { var e1 = document.createElement("span"); e1.className = "empty"; e1.textContent = "Nothing pinned yet"; fav.appendChild(e1); }
    favorites.forEach(function (hex) {
      fav.appendChild(swatchEl(hex, function (e) {
        if (e.shiftKey) { favorites = favorites.filter(function (h) { return h !== hex; }); renderSwatches(); persist(); return; }
        if (e.altKey) { pushBackground(hex); return; }
        applyShapeHex(hex);
      }, hex + "  (Shift-click to unpin, Alt-click for background)"));
    });
    history.forEach(function (hex) {
      his.appendChild(swatchEl(hex, function (e) { if (e.altKey) pushBackground(hex); else applyShapeHex(hex); }, hex + "  (Alt-click for background)"));
    });
  }

  var PAL_NAMES = [["base", "Base"], ["hi", "Highlight"], ["mid", "Midtone"], ["shadow", "Shadow"], ["bounce", "Bounce"]];
  function paletteColors() {
    var out = [{ name: "Base", hex: state.colors.shape }];
    if (lastRender) PAL_NAMES.slice(1).forEach(function (p) { out.push({ name: p[1], hex: C.rgbToHex(lastRender.palette[p[0]]) }); });
    return out;
  }
  function renderPalette() {
    var box = $("paletteRows"); box.innerHTML = "";
    paletteColors().forEach(function (c) {
      var row = document.createElement("div"); row.className = "pal-row";
      var sw = document.createElement("div"); sw.className = "sw"; sw.style.backgroundColor = c.hex;
      var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = c.name;
      var hx = document.createElement("span"); hx.className = "hx"; hx.textContent = c.hex;
      row.appendChild(sw); row.appendChild(nm); row.appendChild(hx);
      row.addEventListener("click", function (e) {
        if (e.altKey) { pushBackground(c.hex); status("Background " + c.hex); return; }
        if (c.name === "Base") pushForeground(c.hex, true); else sendToForeground(c.hex);
        copyHex(c.hex);
      });
      box.appendChild(row);
    });
  }

  function exportColors() {
    var list = paletteColors();
    favorites.forEach(function (h, i) { list.push({ name: "Pinned " + (i + 1), hex: h }); });
    return list;
  }

  /* ---------- generic drag helper ---------- */
  function dragOn(el, handlers) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      var rect = el.getBoundingClientRect();
      function pos(ev) {
        return [clamp((ev.clientX - rect.left) / (rect.width || 1), 0, 1), clamp((ev.clientY - rect.top) / (rect.height || 1), 0, 1)];
      }
      var start = pos(e);
      if (handlers.start && handlers.start(start, e) === false) return;
      if (handlers.move) handlers.move(start, start, e);
      function mv(ev) { if (handlers.move) handlers.move(pos(ev), start, ev); }
      function up(ev) {
        document.removeEventListener("pointermove", mv);
        document.removeEventListener("pointerup", up);
        if (handlers.end) handlers.end(pos(ev), start, ev);
      }
      document.addEventListener("pointermove", mv);
      document.addEventListener("pointerup", up);
    });
  }

  /* ---------- sliders ---------- */
  function makeSlider(parent, opt) {
    var row = document.createElement("div"); row.className = "slider-row";
    var lab = document.createElement("span"); lab.className = "s-label" + (opt.short ? " short" : ""); lab.textContent = opt.label;
    var track = document.createElement("div"); track.className = "track";
    var img = document.createElement("img"); img.className = "fill";
    var bar = document.createElement("div"); bar.className = "fillbar";
    var thumb = document.createElement("div"); thumb.className = "thumb";
    var num = document.createElement("input"); num.className = "num"; num.type = "text";
    if (opt.gradient) { track.appendChild(img); } else track.appendChild(bar);
    track.appendChild(thumb);
    row.appendChild(lab); row.appendChild(track); row.appendChild(num);
    parent.appendChild(row);
    var dec = opt.decimals || 0;
    function fmt(v) { return dec ? v.toFixed(dec) : String(Math.round(v)); }
    function update() {
      var v = opt.get(), t = (v - opt.min) / (opt.max - opt.min);
      thumb.style.left = (clamp(t, 0, 1) * 100) + "%";
      bar.style.width = (clamp(t, 0, 1) * 100) + "%";
      if (document.activeElement !== num) num.value = fmt(v);
    }
    dragOn(track, {
      start: function () { beginEdit(); },
      move: function (p) { opt.set(opt.min + p[0] * (opt.max - opt.min), true); },
      end: function () { endEdit(); }
    });
    num.addEventListener("change", function () {
      var v = parseFloat(num.value);
      if (!isNaN(v)) { beginEdit(); opt.set(clamp(v, opt.min, opt.max), false); endEdit(); }
      num.blur && num.blur(); update();
    });
    num.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        var step = (opt.step || 1) * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
        beginEdit(); opt.set(clamp(opt.get() + step, opt.min, opt.max), false); endEdit();
        num.value = fmt(opt.get());
      }
    });
    return { update: update, setGradient: function (url) { img.src = url; }, row: row };
  }

  /* channel sliders (rebuilt when the mode changes) */
  var chanSliders = [];
  function buildChannelSliders() {
    var box = $("sliders"); box.innerHTML = ""; chanSliders = [];
    var m = MODES[ui.mode];
    m.channels.forEach(function (ch, i) {
      chanSliders.push(makeSlider(box, {
        label: ch.key, short: true, min: ch.min, max: ch.max, gradient: true, step: 1,
        get: function () { return getVals()[i]; },
        set: function (v, live) { var vals = getVals(); vals[i] = v; setVals(vals, live); }
      }));
    });
  }

  function gradientUrl(fn, n) {
    var rgb = new Uint8Array(n * 3);
    for (var i = 0; i < n; i++) { var c = fn(i / (n - 1)); rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2]; }
    return P.dataUrl(rgb, n, 1);
  }

  function updateChannelGradients() {
    var m = MODES[ui.mode], vals = getVals();
    chanSliders.forEach(function (s, i) {
      var ch = m.channels[i];
      s.setGradient(gradientUrl(function (t) {
        var v = vals.slice(); v[i] = ch.min + t * (ch.max - ch.min);
        if (ui.mode === "HSB" && i === 0) { v[1] = 100; v[2] = 100; }
        return m.to(v);
      }, 96));
      s.update();
    });
  }

  /* ---------- 2D field + strip ---------- */
  var FIELD_N = 96, fieldDragging = false;
  function chanAt(m, i, t) { var ch = m.channels[i]; return ch.min + t * (ch.max - ch.min); }

  function renderField() {
    var m = MODES[ui.mode], vals = getVals();
    if (!fieldDragging) {
      var n = FIELD_N, rgb = new Uint8Array(n * n * 3), v = vals.slice();
      if (ui.mode === "CUBE") v[1] = vals[1];
      for (var y = 0; y < n; y++) {
        var ty = y / (n - 1);
        v[m.fy] = chanAt(m, m.fy, m.invertY ? ty : 1 - ty);
        for (var x = 0; x < n; x++) {
          v[m.fx] = chanAt(m, m.fx, x / (n - 1));
          var c = m.to(v);
          if (ui.mode === "LAB" && !C.labInGamut(v)) c = [c[0] * 0.35 + 40, c[1] * 0.35 + 40, c[2] * 0.35 + 40];
          var k = (y * n + x) * 3; rgb[k] = c[0]; rgb[k + 1] = c[1]; rgb[k + 2] = c[2];
        }
      }
      $("fieldImg").src = P.dataUrl(rgb, n, n);
    }
    var sn = 128, srgb = new Uint8Array(4 * sn * 3), sv = vals.slice();
    for (var sy = 0; sy < sn; sy++) {
      var st = sy / (sn - 1);
      sv[m.strip] = chanAt(m, m.strip, m.invertY ? st : 1 - st);
      var sc = m.strip === 0 && (ui.mode === "HSB") ? C.hsbToRgb([sv[0], 100, 100]) : m.to(sv);
      for (var sx = 0; sx < 4; sx++) { var q = (sy * 4 + sx) * 3; srgb[q] = sc[0]; srgb[q + 1] = sc[1]; srgb[q + 2] = sc[2]; }
    }
    $("stripImg").src = P.dataUrl(srgb, 4, sn);
    positionFieldMarks(vals);
  }

  function norm01(m, i, v) { var ch = m.channels[i]; return (v - ch.min) / (ch.max - ch.min); }
  function positionFieldMarks(vals) {
    var m = MODES[ui.mode];
    var fx = norm01(m, m.fx, vals[m.fx]), fy = norm01(m, m.fy, vals[m.fy]), st = norm01(m, m.strip, vals[m.strip]);
    $("fieldDot").style.left = (fx * 100) + "%";
    $("fieldDot").style.top = ((m.invertY ? fy : 1 - fy) * 100) + "%";
    $("stripMark").style.top = ((m.invertY ? st : 1 - st) * 100) + "%";
  }

  /* ---------- refresh ---------- */
  function updateChips() {
    $("fgChip").style.backgroundColor = host.fg;
    $("bgChip").style.backgroundColor = host.bg;
  }

  var lightSliders = [], materialSliders = [];
  function refreshAll(hq) {
    var hex = targetHex();
    if (document.activeElement !== $("hexInput")) $("hexInput").value = hex;
    $("cmpNew").style.backgroundColor = hex;
    $("cmpOld").style.backgroundColor = ui.target === "shape" ? previousHex : hex;
    updateChips();
    setSeg("targetSeg", ui.target); setSeg("modeSeg", ui.mode); setSeg("shapeSeg", state.shape);
    setSeg("dragMode", ui.dragMode); setSeg("lightModeSeg", state.lightMode);
    toggleOn("spotBtn", state.spot); toggleOn("toonBtn", state.toon); toggleOn("chromeBtn", state.chrome);
    toggleOn("trueColorBtn", ui.trueColor); toggleOn("syncBtn", ui.sync); toggleOn("compactBtn", !ui.compact);
    lightSliders.forEach(function (s) { s.update(); });
    materialSliders.forEach(function (s) { s.update(); });
    var timeRow = lightSliders.timeRow, azRow = lightSliders.azRow, elRow = lightSliders.elRow;
    if (timeRow) {
      timeRow.style.display = state.lightMode === "time" ? "flex" : "none";
      azRow.style.display = elRow.style.display = state.lightMode === "time" ? "none" : "flex";
    }
    ["previewWrap", "lightingSection"].forEach(function (id) { $(id).style.display = ui.compact ? "none" : "block"; });
    updateChannelGradients();
    renderField();
    $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length;
    if (!ui.compact) requestRender(hq); else { lastRender = R.render(sceneParams(), 48, 48, 1); renderPalette(); }
  }

  function setSeg(id, v) {
    var bs = $(id).querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) { if (bs[i].getAttribute("data-v") === v) bs[i].classList.add("on"); else bs[i].classList.remove("on"); }
  }
  function toggleOn(id, on) { if (on) $(id).classList.add("on"); else $(id).classList.remove("on"); }
  function onSeg(id, fn) {
    var bs = $(id).querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) (function (b) { b.addEventListener("click", function () { fn(b.getAttribute("data-v")); }); })(bs[i]);
  }

  /* ---------- presets ---------- */
  var BUILTIN = [
    { name: "Studio", lightMode: "manual", spot: true, az: 40, el: 45, intensity: 1.2, ambient: 0.35, colors: { sky: "#9A9A9A", horizon: "#6E6E6E", ground: "#3A3A3A", light: "#FFFFFF" } },
    { name: "Overcast", lightMode: "manual", spot: false, az: 20, el: 70, intensity: 0.35, ambient: 0.9, colors: { sky: "#C9CED6", horizon: "#B7BCC2", ground: "#5E5E58", light: "#F2F4F8" } },
    { name: "Golden hour", lightMode: "time", time: 18, intensity: 1, ambient: 0.5 },
    { name: "Midday sun", lightMode: "time", time: 12.5, intensity: 1, ambient: 0.5 },
    { name: "Moonlight", lightMode: "time", time: 23, intensity: 1, ambient: 0.5 },
    { name: "Rim light", lightMode: "manual", spot: false, az: 200, el: 25, intensity: 1.4, ambient: 0.3, colors: { sky: "#33405A", horizon: "#4A4A5C", ground: "#1E1E24", light: "#BFE3FF" } },
    { name: "Campfire", lightMode: "manual", spot: true, az: -60, el: 8, intensity: 1.5, ambient: 0.25, colors: { sky: "#0E1222", horizon: "#2A1E1C", ground: "#24170F", light: "#FF8A3A" } }
  ];
  var PRESET_KEYS = ["lightMode", "spot", "az", "el", "time", "intensity", "ambient"];

  function buildPresetSelect() {
    var sel = $("presetSelect"); sel.innerHTML = "";
    var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Lighting setups…"; sel.appendChild(o0);
    BUILTIN.concat(userPresets).forEach(function (p, i) {
      var o = document.createElement("option"); o.value = String(i); o.textContent = (i >= BUILTIN.length ? "★ " : "") + p.name; sel.appendChild(o);
    });
    sel.value = "";
  }
  function applyPreset(p) {
    beginEdit();
    PRESET_KEYS.forEach(function (k) { if (p[k] != null) state[k] = p[k]; });
    if (p.colors) Object.keys(p.colors).forEach(function (k) { state.colors[k] = p.colors[k]; });
    endEdit(); refreshAll(true); status("Lighting: " + p.name);
  }

  /* ---------- build UI ---------- */
  function buildLightSliders() {
    var box = $("lightSliders"); box.innerHTML = ""; lightSliders = [];
    function add(label, key, min, max, dec, bake) {
      var s = makeSlider(box, {
        label: label, min: min, max: max, decimals: dec, step: dec ? 0.05 : 1,
        get: function () { return state[key]; },
        set: function (v, live) { if (bake) bakeToManual(); state[key] = v; refreshAll(!live); }
      });
      lightSliders.push(s); return s;
    }
    lightSliders.timeRow = add("Time", "time", 0, 24, 1).row;
    lightSliders.azRow = add("Direction", "az", -180, 180, 0, true).row;
    lightSliders.elRow = add("Height", "el", -5, 89, 0, true).row;
    add("Intensity", "intensity", 0, 2, 2);
    add("Ambient", "ambient", 0, 1.5, 2);
  }

  function buildMaterialSliders() {
    var box = $("materialSliders"); box.innerHTML = ""; materialSliders = [];
    [["Specular", "specular", 0, 1], ["Reflectivity", "reflectivity", 0, 1], ["Subsurface", "subsurface", 0, 1],
      ["Depth fog", "fog", 0, 1], ["Contrast", "contrast", 0.5, 1.6]].forEach(function (d) {
      materialSliders.push(makeSlider(box, {
        label: d[0], min: d[2], max: d[3], decimals: 2, step: 0.05,
        get: function () { return state[d[1]]; },
        set: function (v, live) { state[d[1]] = v; refreshAll(!live); }
      }));
    });
  }

  function bind() {
    onSeg("targetSeg", function (v) { ui.target = v; persist(); refreshAll(false); });
    onSeg("modeSeg", function (v) { ui.mode = v; buildChannelSliders(); persist(); refreshAll(false); });
    onSeg("shapeSeg", function (v) { beginEdit(); state.shape = v; endEdit(); });
    onSeg("dragMode", function (v) { ui.dragMode = v; persist(); refreshAll(false); });
    onSeg("lightModeSeg", function (v) {
      beginEdit();
      if (v === "manual") bakeToManual(); else state.lightMode = "time";
      endEdit(); refreshAll(true);
    });
    $("spotBtn").addEventListener("click", function () { beginEdit(); state.spot = !state.spot; endEdit(); });
    $("toonBtn").addEventListener("click", function () { beginEdit(); state.toon = !state.toon; endEdit(); });
    $("chromeBtn").addEventListener("click", function () { beginEdit(); state.chrome = !state.chrome; endEdit(); });
    $("trueColorBtn").addEventListener("click", function () { ui.trueColor = !ui.trueColor; persist(); refreshAll(true); });
    $("syncBtn").addEventListener("click", function () {
      ui.sync = !ui.sync; persist(); refreshAll(false);
      status(ui.sync ? "Sync on" : "Sync off");
      if (ui.sync) pushForeground(state.colors.shape, true);
    });
    $("compactBtn").addEventListener("click", function () { ui.compact = !ui.compact; persist(); refreshAll(true); });
    $("swapBtn").addEventListener("click", swapColors);
    $("resetBtn").addEventListener("click", resetColors);
    $("copyHexBtn").addEventListener("click", function () { copyHex(targetHex()); });
    $("cmpOld").addEventListener("click", function () { if (ui.target === "shape") applyShapeHex(previousHex); });
    $("fgChip").addEventListener("click", function () { ui.target = "shape"; refreshAll(false); });
    $("bgChip").addEventListener("click", function () { pushBackground(state.colors.shape); status("Background set to current color"); });

    var hexIn = $("hexInput");
    function commitHex() {
      var rgb = C.hexToRgb(hexIn.value);
      if (!rgb) { hexIn.value = targetHex(); return; }
      var hex = C.rgbToHex(rgb);
      beginEdit(); setTargetHex(ui.target, hex, false); endEdit();
    }
    hexIn.addEventListener("change", commitHex);
    hexIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { commitHex(); hexIn.blur && hexIn.blur(); } });

    // picker field
    dragOn($("field"), {
      start: function () { beginEdit(); fieldDragging = true; },
      move: function (p) {
        var m = MODES[ui.mode], vals = getVals();
        vals[m.fx] = chanAt(m, m.fx, p[0]);
        vals[m.fy] = chanAt(m, m.fy, m.invertY ? p[1] : 1 - p[1]);
        setVals(vals, true);
      },
      end: function () { fieldDragging = false; endEdit(); }
    });
    dragOn($("strip"), {
      start: function () { beginEdit(); },
      move: function (p) {
        var m = MODES[ui.mode], vals = getVals();
        vals[m.strip] = chanAt(m, m.strip, m.invertY ? p[1] : 1 - p[1]);
        setVals(vals, true);
      },
      end: function () { endEdit(); }
    });

    // 3D preview interaction
    var drag = null;
    dragOn($("preview"), {
      start: function (p) {
        if (ui.trueColor && Math.abs(p[0] - ui.split) < 0.05) { drag = { kind: "split" }; return; }
        if (ui.dragMode === "sample") { drag = { kind: "sample" }; return; }
        beginEdit();
        drag = ui.dragMode === "orbit" ? { kind: "orbit", yaw: state.yaw, pitch: state.pitch } : { kind: "light" };
        if (drag.kind === "light") bakeToManual();
      },
      move: function (p, s) {
        if (!drag) return;
        if (drag.kind === "split") { ui.split = clamp(p[0], 0.02, 0.98); requestRender(false); return; }
        if (drag.kind === "orbit") {
          state.yaw = drag.yaw - (p[0] - s[0]) * 270;
          state.pitch = clamp(drag.pitch + (p[1] - s[1]) * 110, 2, 70);
          requestRender(false); lightSliders.forEach(function (x) { x.update(); }); return;
        }
        if (drag.kind === "light") {
          state.az = ((state.yaw + (p[0] - 0.5) * 300 + 540) % 360) - 180;
          state.el = clamp((0.5 - p[1]) * 170 + 10, -5, 89);
          requestRender(false); lightSliders.forEach(function (x) { x.update(); });
        }
      },
      end: function (p) {
        if (!drag) return;
        var k = drag.kind; drag = null;
        if (k === "split") { persist(); requestRender(true); return; }
        if (k === "sample") { sampleAt(p); return; }
        endEdit(); requestRender(true);
      }
    });

    $("pinBtn").addEventListener("click", function () {
      var hex = state.colors.shape;
      favorites = favorites.filter(function (h) { return h !== hex; }); favorites.push(hex);
      renderSwatches(); persist(); status("Pinned " + hex);
    });
    $("exportAseBtn").addEventListener("click", function () {
      B.saveFile("chroma-picker.ase", "ase", SW.toASE(exportColors()), true).then(function (ok) { if (ok) status("Saved .ase"); }, function (e) { status("Export failed"); console.error(e); });
    });
    $("exportGplBtn").addEventListener("click", function () {
      B.saveFile("chroma-picker.gpl", "gpl", SW.toGPL("Chroma Picker", exportColors()), false).then(function (ok) { if (ok) status("Saved .gpl"); }, function (e) { status("Export failed"); console.error(e); });
    });
    $("undoBtn").addEventListener("click", undo);
    $("redoBtn").addEventListener("click", redo);

    $("presetSelect").addEventListener("change", function () {
      var v = $("presetSelect").value; if (v === "") return;
      applyPreset(BUILTIN.concat(userPresets)[parseInt(v, 10)]);
      $("presetSelect").value = "";
    });
    $("savePresetBtn").addEventListener("click", function () {
      var p = { name: "Setup " + (userPresets.length + 1), colors: {} };
      PRESET_KEYS.forEach(function (k) { p[k] = state[k]; });
      ["sky", "horizon", "ground", "light"].forEach(function (k) { p.colors[k] = state.colors[k]; });
      if (state.lightMode === "time") delete p.colors;
      userPresets.push(p); persist(); buildPresetSelect(); status("Saved " + p.name);
    });
    $("deletePresetBtn").addEventListener("click", function () {
      if (!userPresets.length) { status("No saved setups"); return; }
      var p = userPresets.pop(); persist(); buildPresetSelect(); status("Deleted " + p.name);
    });

    var heads = document.querySelectorAll(".section-head");
    for (var i = 0; i < heads.length; i++) (function (h) {
      var id = h.getAttribute("data-toggle");
      function apply() { $(id).style.display = ui.closed[id] ? "none" : "block"; if (ui.closed[id]) h.classList.add("closed"); else h.classList.remove("closed"); }
      h.addEventListener("click", function () { ui.closed[id] = !ui.closed[id]; apply(); persist(); });
      apply();
    })(heads[i]);

    document.addEventListener("keydown", function (e) {
      var tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (mod) return;
      if (e.key === "x" || e.key === "X") swapColors();
      else if (e.key === "d" || e.key === "D") resetColors();
      else if (ui.trueColor && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        ui.split = clamp(ui.split + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.1 : 0.02), 0.02, 0.98);
        requestRender(true);
      }
    });
  }

  function sampleAt(p) {
    if (!lastRender) return;
    var x = clamp(Math.floor(p[0] * lastRender.w), 0, lastRender.w - 1), y = clamp(Math.floor(p[1] * lastRender.h), 0, lastRender.h - 1);
    var k = (y * lastRender.w + x) * 3, r = lastRender.rgb;
    var hex = C.rgbToHex([r[k], r[k + 1], r[k + 2]]);
    sendToForeground(hex); copyHex(hex);
    status("Sampled " + hex + " to foreground");
  }

  function swapColors() {
    var fg = host.fg, bg = host.bg;
    beginEdit(); state.colors.shape = bg; state.bg = fg; endEditQuiet();
    host.fg = bg; host.bg = fg;
    pushBackground(fg); pushForeground(bg, true); refreshAll(true);
  }
  function resetColors() {
    beginEdit(); state.colors.shape = "#000000"; state.bg = "#FFFFFF"; endEditQuiet();
    pushBackground("#FFFFFF"); pushForeground("#000000", true); refreshAll(true);
  }
  /* like endEdit but leaves pushing to the caller */
  function endEditQuiet() {
    if (!editSnap) return;
    var before = editSnap; editSnap = null;
    undoStack.push(before); redoStack = [];
    previousHex = before.colors.shape; addHistory(state.colors.shape); persist();
  }

  /* ---------- start ---------- */
  function init() {
    buildChannelSliders(); buildLightSliders(); buildMaterialSliders(); buildPresetSelect();
    bind(); renderSwatches();
    status(B.isPhotoshop ? "Connected to Photoshop" : "Browser preview (no Photoshop)");
    B.getColors().then(function (c) {
      if (c.fg) { host.fg = c.fg; if (ui.sync) { state.colors.shape = c.fg; previousHex = c.fg; } }
      if (c.bg) { host.bg = c.bg; state.bg = c.bg; }
      refreshAll(true);
    });
    setInterval(pollHost, 600);
    B.onHostColorEvent(function () { setTimeout(pollHost, 50); });
    window.addEventListener("resize", function () { requestRender(true); });
  }

  window.ChromaPicker = { state: state, ui: ui, refresh: refreshAll, undo: undo, redo: redo, host: host };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
