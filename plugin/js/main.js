/* Chroma Picker - workspace UI and app logic. */
(function () {
  "use strict";
  var C = window.CPColor, R = window.CPRender, P = window.CPPng, SW = window.CPSwatches, B = window.CPBridge;
  var MODES = C.MODES;

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function cls(el, name, on) { if (on) el.classList.add(name); else el.classList.remove(name); }

  /* ---------- storage (localStorage works in UXP; guarded anyway) ---------- */
  var VER = "v2.";
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("chromaPicker." + VER + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("chromaPicker." + VER + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  /* ---------- state ---------- */
  var DEFAULTS = {
    colors: { shape: "#D14949", sky: "#2F7BEA", horizon: "#A8CFE6", ground: "#4F7F62", light: "#FFF3E2", fill: "#9FC4FF" },
    bg: "#FFFFFF",
    shape: "trio", lightMode: "manual", spot: false,
    az: -35, el: 38, intensity: 1.15,
    fillOn: true, fillAz: 120, fillEl: 18, fillInt: 0.35,
    time: 16, ambient: 0.45,
    specular: 0.35, reflectivity: 0.08, subsurface: 0, fog: 0, contrast: 1, toon: false, chrome: false,
    yaw: 25, pitch: 12
  };
  var UNDO_KEYS = Object.keys(DEFAULTS);
  var SCENE_RESET_KEYS = ["az", "el", "fillAz", "fillEl", "yaw", "pitch"];

  var state = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), store.get("state", {}));
  state.colors = Object.assign({}, DEFAULTS.colors, state.colors || {});
  var ui = Object.assign({
    target: "shape", mode: "HSB", layout: "full", sampling: false, locked: false, trueColor: false, split: 0.5,
    overlays: true, showField: false, collapsed: false, sync: true, selLight: 0, brush: 30
  }, store.get("ui", {}));
  ui.sampling = false;
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
  function idleStatus() { return B.isPhotoshop ? (ui.sync ? "Synced with Photoshop" : "Sync off") : "Browser preview (no Photoshop)"; }
  function status(msg) {
    $("status").textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { $("status").textContent = idleStatus(); }, 2200);
  }

  /* ---------- time of day ---------- */
  var TOD = [
    // hour, sky, horizon, ground, sun color, intensity, ambient multiplier
    [0, "#0B1024", "#1A2038", "#0D0E12", "#8DA2D8", 0.18, 0.55],
    [5, "#18203F", "#3A3550", "#15141A", "#9AA8D8", 0.2, 0.6],
    [6.5, "#5A6C9E", "#F0A070", "#3B3028", "#FF9A55", 0.55, 0.8],
    [9, "#4F8FEA", "#C6DDEB", "#4E7558", "#FFE2BC", 0.95, 1],
    [12, "#2F7BEA", "#A8CFE6", "#4F7F62", "#FFF8EE", 1.15, 1],
    [15, "#3D84E8", "#B4D2E4", "#4C7A5C", "#FFEBD2", 1.05, 1],
    [17.5, "#6E86C8", "#F2BC80", "#4A5B40", "#FFB066", 0.85, 0.9],
    [19, "#4A4E86", "#E8785A", "#2E2E24", "#FF7040", 0.45, 0.75],
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

  /* Effective lighting, whether manual or time based. The fill light is never driven by time. */
  function lighting() {
    if (state.lightMode === "time") {
      var t = timeOfDay(state.time);
      return { sky: t.sky, horizon: t.horizon, ground: t.ground, light: t.light,
        intensity: state.intensity * t.intensity, ambient: state.ambient * t.ambientMul, az: t.az, el: t.el };
    }
    return { sky: state.colors.sky, horizon: state.colors.horizon, ground: state.colors.ground, light: state.colors.light,
      intensity: state.intensity, ambient: state.ambient, az: state.az, el: state.el };
  }

  /* Editing an environment color or the key light in time-of-day mode bakes the current time into manual mode. */
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
    var lights = [{ dir: R.dirFromAngles(L.az, L.el), color: lin(L.light), intensity: L.intensity, spot: state.spot }];
    lights.push({ dir: R.dirFromAngles(state.fillAz, state.fillEl), color: lin(state.colors.fill), intensity: state.fillOn ? state.fillInt : 0, spot: false });
    return {
      albedo: lin(state.colors.shape), flatAlbedoRgb: C.hexToRgb(state.colors.shape),
      sky: lin(L.sky), horizon: lin(L.horizon), ground: lin(L.ground), groundEnv: lin(L.ground),
      lights: lights, ambient: L.ambient,
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

  function viewSize() {
    var r = $("viewport").getBoundingClientRect();
    return { w: r.width || 300, h: r.height || 300 };
  }

  function doRender(hq) {
    var S = sceneParams();
    if (ui.layout === "classic") {
      lastRender = R.render(S, 64, 64, 1);
      renderPalette();
      return;
    }
    var sz = viewSize();
    var base = hq ? 300 : 150;
    var w = base, h = Math.max(40, Math.round(base * sz.h / sz.w));
    var res = R.render(S, w, h, hq ? 2 : 1);
    lastRender = res;
    $("previewImg").src = P.dataUrl(res.rgb, w, h);
    placeOverlay(S, w / h);
    renderPalette();
  }

  function placeOverlay(S, aspect) {
    var L = lighting();
    [0, 1].forEach(function (i) {
      var hEl = $("handle" + i);
      var show = ui.overlays && (i === 0 || state.fillOn);
      var uv = show ? R.lightHandle(S, aspect, i) : null;
      if (uv) {
        hEl.style.display = "block";
        hEl.style.left = (clamp(uv[0], 0.04, 0.96) * 100) + "%";
        hEl.style.top = (clamp(uv[1], 0.06, 0.94) * 100) + "%";
        var col = C.hexToRgb(i === 0 ? L.light : state.colors.fill);
        hEl.style.backgroundColor = "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0.45)";
      } else hEl.style.display = "none";
      cls(hEl, "sel", ui.selLight === i && (ui.target === (i === 0 ? "light" : "fill")));
    });
    var el = ui.selLight === 0 ? L.el : state.fillEl;
    $("railLightKnob").style.top = ((1 - (el + 5) / 94) * 100) + "%";
    $("railCamKnob").style.top = ((1 - (state.pitch - 2) / 68) * 100) + "%";
    $("overlay").style.display = ui.overlays ? "block" : "none";
    $("vpMore").style.display = ui.overlays ? "flex" : "none";
    $("btnResetScene").style.display = ui.overlays ? "flex" : "none";
    var sh = $("splitHandle"), lbl = $("splitLabel");
    cls(sh, "hidden", !ui.trueColor); cls(lbl, "hidden", !ui.trueColor);
    if (ui.trueColor) sh.style.left = (ui.split * 100) + "%";
  }

  /* ---------- color access for the current target ---------- */
  var TARGET_LABEL = { shape: "SHAPE COLOR", sky: "SKY COLOR", horizon: "HORIZON COLOR", ground: "GROUND COLOR", light: "KEY LIGHT COLOR", fill: "FILL LIGHT COLOR" };
  var cache = { key: null, vals: null, hex: null };

  function hexOf(target) {
    if (target === "shape" || target === "fill") return state.colors[target];
    if (state.lightMode === "time") return lighting()[target];
    return state.colors[target];
  }
  function targetHex() { return hexOf(ui.target); }

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
    if (target !== "shape" && target !== "fill") bakeToManual();
    state.colors[target] = hex;
    if (target === "shape") pushForeground(hex, false);
    refreshAll(!live);
  }

  function applyShapeHex(hex) {
    beginEdit(); state.colors.shape = hex; endEdit(); refreshAll(true);
  }

  function selectTarget(t) {
    ui.target = t;
    if (t === "light") ui.selLight = 0;
    if (t === "fill") ui.selLight = 1;
    persist(); refreshAll(false);
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
        if (!ui.locked && c.fg !== state.colors.shape) {
          previousHex = state.colors.shape;
          state.colors.shape = c.fg;
          addHistory(c.fg); persist(); refreshAll(true);
        } else updateChips();
      }
    });
  }

  /* ---------- swatches ---------- */
  function addHistory(hex) {
    history = history.filter(function (h) { return h !== hex; });
    history.unshift(hex);
    if (history.length > 30) history.length = 30;
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
  function emptyNote(box, text) { var e = document.createElement("span"); e.className = "empty"; e.textContent = text; box.appendChild(e); }

  function renderSwatches() {
    var fav = $("favorites"), his = $("history");
    fav.innerHTML = ""; his.innerHTML = "";
    if (!favorites.length) emptyNote(fav, "Nothing pinned yet");
    if (!history.length) emptyNote(his, "No colors yet");
    favorites.forEach(function (hex) {
      fav.appendChild(swatchEl(hex, function (e) {
        if (e.shiftKey) { favorites = favorites.filter(function (h) { return h !== hex; }); renderSwatches(); persist(); return; }
        if (e.altKey) { pushBackground(hex); return; }
        applyShapeHex(hex);
      }, hex));
    });
    history.forEach(function (hex) {
      his.appendChild(swatchEl(hex, function (e) { if (e.altKey) pushBackground(hex); else applyShapeHex(hex); }, hex));
    });
  }

  var PAL_NAMES = [["base", "Base"], ["hi", "Highlight"], ["mid", "Midtone"], ["shadow", "Shadow"], ["bounce", "Bounce"]];
  function paletteColors() {
    var out = [{ name: "Base", hex: state.colors.shape }];
    if (lastRender) PAL_NAMES.slice(1).forEach(function (p) { out.push({ name: p[1], hex: C.rgbToHex(lastRender.palette[p[0]]) }); });
    return out;
  }
  function renderPalette() {
    var box = $("palette"); box.innerHTML = "";
    paletteColors().forEach(function (c) {
      var cell = document.createElement("div"); cell.className = "pal"; cell.title = c.name + " " + c.hex;
      var sw = document.createElement("div"); sw.className = "sw"; sw.style.backgroundColor = c.hex;
      var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = c.name;
      var hx = document.createElement("div"); hx.className = "hx"; hx.textContent = c.hex.slice(1);
      cell.appendChild(sw); cell.appendChild(nm); cell.appendChild(hx);
      cell.addEventListener("click", function (e) {
        if (e.altKey) { pushBackground(c.hex); status("Background " + c.hex); return; }
        if (c.name === "Base") pushForeground(c.hex, true); else sendToForeground(c.hex);
        copyHex(c.hex);
      });
      box.appendChild(cell);
    });
  }
  function exportColors() {
    var list = paletteColors();
    favorites.forEach(function (h, i) { list.push({ name: "Pinned " + (i + 1), hex: h }); });
    return list;
  }

  /* ---------- drag helper ---------- */
  function dragOn(el, handlers) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      if (handlers.stop) e.stopPropagation();
      e.preventDefault();
      var rect = (handlers.relativeTo || el).getBoundingClientRect();
      function pos(ev) {
        return [clamp((ev.clientX - rect.left) / (rect.width || 1), 0, 1), clamp((ev.clientY - rect.top) / (rect.height || 1), 0, 1)];
      }
      var start = pos(e), moved = false, sx = e.clientX, sy = e.clientY;
      if (handlers.start && handlers.start(start, e) === false) return;
      function mv(ev) {
        if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
        moved = true;
        if (handlers.move) handlers.move(pos(ev), start, ev);
      }
      function up(ev) {
        document.removeEventListener("pointermove", mv);
        document.removeEventListener("pointerup", up);
        if (handlers.end) handlers.end(pos(ev), start, moved, ev);
      }
      if (handlers.immediate && handlers.move) { moved = true; handlers.move(start, start, e); }
      document.addEventListener("pointermove", mv);
      document.addEventListener("pointerup", up);
    });
  }
  function noDrag(el) { el.addEventListener("pointerdown", function (e) { e.stopPropagation(); }); }

  /* ---------- sliders ---------- */
  function makeSlider(parent, opt) {
    var row = document.createElement("div"); row.className = "slider-row";
    var lab = document.createElement("span"); lab.className = "s-label" + (opt.short ? " short" : ""); lab.textContent = opt.label;
    var track = document.createElement("div"); track.className = "track";
    var img = document.createElement("img"); img.className = "fill";
    var bar = document.createElement("div"); bar.className = "fillbar";
    var thumb = document.createElement("div"); thumb.className = "thumb";
    var num = document.createElement("input"); num.className = "num"; num.type = "text";
    if (opt.gradient) track.appendChild(img); else track.appendChild(bar);
    track.appendChild(thumb);
    row.appendChild(lab); row.appendChild(track); row.appendChild(num);
    parent.appendChild(row);
    var dec = opt.decimals || 0, unit = opt.unit || "";
    function fmt(v) { return (dec ? v.toFixed(dec) : String(Math.round(v))) + unit; }
    function update() {
      var v = opt.get(), t = (v - opt.min) / (opt.max - opt.min);
      thumb.style.left = (clamp(t, 0, 1) * 100) + "%";
      bar.style.width = (clamp(t, 0, 1) * 100) + "%";
      if (document.activeElement !== num) num.value = fmt(v);
    }
    dragOn(track, {
      immediate: true,
      start: function () { if (!opt.noUndo) beginEdit(); },
      move: function (p) { opt.set(opt.min + p[0] * (opt.max - opt.min), true); },
      end: function () { if (!opt.noUndo) endEdit(); if (opt.commit) opt.commit(); }
    });
    num.addEventListener("change", function () {
      var v = parseFloat(num.value);
      if (!isNaN(v)) { beginEdit(); opt.set(clamp(v, opt.min, opt.max), false); endEdit(); if (opt.commit) opt.commit(); }
      update();
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

  var chanSliders = [], allSliders = [];
  function buildChannelSliders() {
    var box = $("sliders"); box.innerHTML = ""; chanSliders = [];
    var m = MODES[ui.mode];
    m.channels.forEach(function (ch, i) {
      chanSliders.push(makeSlider(box, {
        label: ch.key, short: true, min: ch.min, max: ch.max, gradient: true, step: 1, unit: ch.unit,
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
        if ((ui.mode === "HSB" || ui.mode === "CUBE") && i === 0) { v[1] = 100; v[2] = 100; }
        return m.to(v);
      }, 96));
      s.update();
    });
  }

  /* ---------- 2D field + strip ---------- */
  var FIELD_N = 96, fieldDragging = false;
  function chanAt(m, i, t) { var ch = m.channels[i]; return ch.min + t * (ch.max - ch.min); }
  function norm01(m, i, v) { var ch = m.channels[i]; return (v - ch.min) / (ch.max - ch.min); }

  function renderField() {
    if (!ui.showField && ui.layout !== "classic") return;
    var m = MODES[ui.mode], vals = getVals();
    if (!fieldDragging) {
      var n = FIELD_N, rgb = new Uint8Array(n * n * 3), v = vals.slice();
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
      var sc = m.strip === 0 && ui.mode === "HSB" ? C.hsbToRgb([sv[0], 100, 100]) : m.to(sv);
      for (var sx = 0; sx < 4; sx++) { var q = (sy * 4 + sx) * 3; srgb[q] = sc[0]; srgb[q + 1] = sc[1]; srgb[q + 2] = sc[2]; }
    }
    $("stripImg").src = P.dataUrl(srgb, 4, sn);
    var fx = norm01(m, m.fx, vals[m.fx]), fy = norm01(m, m.fy, vals[m.fy]), stv = norm01(m, m.strip, vals[m.strip]);
    $("fieldDot").style.left = (fx * 100) + "%";
    $("fieldDot").style.top = ((m.invertY ? fy : 1 - fy) * 100) + "%";
    $("stripMark").style.top = ((m.invertY ? stv : 1 - stv) * 100) + "%";
  }

  /* ---------- refresh ---------- */
  function updateChips() {
    $("fgChip").style.backgroundColor = host.fg;
    $("bgChip").style.backgroundColor = host.bg;
  }

  var LAYOUT_NAMES = { full: "Full", compact: "Compact", classic: "Classic" };
  function refreshAll(hq) {
    var hex = targetHex();
    if (document.activeElement !== $("hexInput")) $("hexInput").value = hex.slice(1);
    $("targetLabel").textContent = TARGET_LABEL[ui.target];
    $("cmpNew").style.backgroundColor = hex;
    $("cmpOld").style.backgroundColor = ui.target === "shape" ? previousHex : hex;
    $("modeSelect").value = ui.mode;
    updateChips();
    var L = lighting();
    $("tShape").style.backgroundColor = state.colors.shape;
    $("tSky").style.backgroundColor = L.sky;
    $("tHorizon").style.backgroundColor = L.horizon;
    $("tGround").style.backgroundColor = L.ground;
    each(document.querySelectorAll(".target"), function (t) { cls(t, "sel", t.getAttribute("data-t") === ui.target); });
    setSeg("shapeSeg", state.shape); setSeg("lightModeSeg", state.lightMode);
    cls($("spotBtn"), "on", state.spot); cls($("fillOnBtn"), "on", state.fillOn);
    cls($("toonBtn"), "on", state.toon); cls($("chromeBtn"), "on", state.chrome);
    cls($("syncBtn"), "on", ui.sync);
    cls($("btnTrue"), "on", ui.trueColor); cls($("btnEye"), "on", !ui.overlays);
    cls($("btnSample"), "on", ui.sampling); cls($("btnLock"), "on", ui.locked);
    $("lockImg").src = ui.locked ? "icons/ui/lock.svg" : "icons/ui/unlock.svg";
    cls($("sampleHint"), "hidden", !ui.sampling);
    $("viewport").style.cursor = ui.sampling ? "crosshair" : "";
    var app = $("app");
    cls(app, "compact", ui.layout === "compact"); cls(app, "classic", ui.layout === "classic");
    $("layoutName").textContent = LAYOUT_NAMES[ui.layout];
    $("csBody").style.display = ui.collapsed ? "none" : "block";
    /* swap icons instead of CSS transforms, which UXP may not apply */
    $("btnCollapse").querySelector("img").src = ui.collapsed ? "icons/ui/chevron.svg" : "icons/ui/collapse.svg";
    var fieldVisible = ui.showField || ui.layout === "classic";
    $("fieldWrap").style.display = fieldVisible ? "flex" : "none";
    $("btnField").querySelector("img").src = fieldVisible ? "icons/ui/collapse.svg" : "icons/ui/chevron.svg";
    $("timeSliders").style.opacity = state.lightMode === "time" ? "1" : "0.5";
    allSliders.forEach(function (s) { s.update(); });
    updateChannelGradients();
    renderField();
    $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length;
    requestRender(hq);
  }

  function setSeg(id, v) { each($(id).querySelectorAll("button"), function (b) { cls(b, "on", b.getAttribute("data-v") === v); }); }
  function onSeg(id, fn) { each($(id).querySelectorAll("button"), function (b) { b.addEventListener("click", function () { fn(b.getAttribute("data-v")); }); }); }

  /* ---------- popovers ---------- */
  var openPop = null;
  function showPop(id) {
    if (openPop === id) id = null;
    openPop = id;
    each(document.querySelectorAll(".pop"), function (p) { cls(p, "open", p.id === id); });
    cls($("popover"), "hidden", !id);
    each(document.querySelectorAll("[data-pop]"), function (b) { cls(b, "active", b.getAttribute("data-pop") === id); });
  }

  /* ---------- presets ---------- */
  var BUILTIN = [
    { name: "Clear day", lightMode: "manual", spot: false, az: -35, el: 38, intensity: 1.15, ambient: 0.45, fillOn: true, fillInt: 0.35, colors: { sky: "#2F7BEA", horizon: "#A8CFE6", ground: "#4F7F62", light: "#FFF3E2", fill: "#9FC4FF" } },
    { name: "Studio", lightMode: "manual", spot: true, az: 40, el: 45, intensity: 1.2, ambient: 0.35, fillOn: true, fillInt: 0.25, colors: { sky: "#9A9A9A", horizon: "#6E6E6E", ground: "#3A3A3A", light: "#FFFFFF", fill: "#FFFFFF" } },
    { name: "Overcast", lightMode: "manual", spot: false, az: 20, el: 70, intensity: 0.35, ambient: 0.9, fillOn: false, colors: { sky: "#C9CED6", horizon: "#B7BCC2", ground: "#5E5E58", light: "#F2F4F8" } },
    { name: "Golden hour", lightMode: "time", time: 18, intensity: 1, ambient: 0.5 },
    { name: "Midday sun", lightMode: "time", time: 12.5, intensity: 1, ambient: 0.5 },
    { name: "Moonlight", lightMode: "time", time: 23, intensity: 1, ambient: 0.5 },
    { name: "Rim light", lightMode: "manual", spot: false, az: 200, el: 25, intensity: 1.4, ambient: 0.3, fillOn: true, fillInt: 0.2, colors: { sky: "#33405A", horizon: "#4A4A5C", ground: "#1E1E24", light: "#BFE3FF", fill: "#FFB070" } },
    { name: "Campfire", lightMode: "manual", spot: true, az: -60, el: 8, intensity: 1.5, ambient: 0.25, fillOn: false, colors: { sky: "#0E1222", horizon: "#2A1E1C", ground: "#24170F", light: "#FF8A3A" } }
  ];
  var PRESET_KEYS = ["lightMode", "spot", "az", "el", "time", "intensity", "ambient", "fillOn", "fillAz", "fillEl", "fillInt"];

  function presetPreview(p) {
    if (p.colors && p.colors.sky) return [p.colors.sky, p.colors.horizon, p.colors.ground];
    var t = timeOfDay(p.time || 12); return [t.sky, t.horizon, t.ground];
  }
  function buildPresetList() {
    var box = $("presetList"); box.innerHTML = "";
    BUILTIN.concat(userPresets).forEach(function (p, i) {
      var row = document.createElement("div"); row.className = "preset-item";
      var pv = document.createElement("div"); pv.className = "pv";
      var cols = presetPreview(p);
      pv.style.backgroundColor = cols[1];
      pv.style.borderTopColor = cols[0]; pv.style.borderBottomColor = cols[2];
      pv.style.borderTopWidth = "4px"; pv.style.borderBottomWidth = "4px"; pv.style.height = "4px";
      var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = p.name;
      row.appendChild(pv); row.appendChild(nm);
      if (i >= BUILTIN.length) {
        var x = document.createElement("span"); x.className = "x"; x.textContent = "✕"; x.title = "Delete";
        x.addEventListener("click", function (e) {
          e.stopPropagation();
          userPresets.splice(i - BUILTIN.length, 1); persist(); buildPresetList(); status("Deleted " + p.name);
        });
        row.appendChild(x);
      }
      row.addEventListener("click", function () { applyPreset(p); });
      box.appendChild(row);
    });
  }
  function applyPreset(p) {
    beginEdit();
    PRESET_KEYS.forEach(function (k) { if (p[k] != null) state[k] = p[k]; });
    if (p.colors) Object.keys(p.colors).forEach(function (k) { state.colors[k] = p.colors[k]; });
    endEdit(); refreshAll(true); status("Lighting: " + p.name);
  }

  /* ---------- build UI ---------- */
  function addSlider(boxId, label, key, min, max, dec, opts) {
    opts = opts || {};
    var s = makeSlider($(boxId), {
      label: label, min: min, max: max, decimals: dec, step: dec ? 0.05 : 1, unit: opts.unit,
      get: function () { return state[key]; },
      set: function (v, live) { if (opts.bake) bakeToManual(); if (opts.time) state.lightMode = "time"; state[key] = v; refreshAll(!live); }
    });
    allSliders.push(s); return s;
  }

  function buildSliders() {
    $("timeSliders").innerHTML = ""; $("keySliders").innerHTML = ""; $("fillSliders").innerHTML = "";
    $("ambientSliders").innerHTML = ""; $("materialSliders").innerHTML = ""; $("brushRow").innerHTML = "";
    allSliders = [];
    addSlider("timeSliders", "Time", "time", 0, 24, 1, { time: true, unit: "h" });
    addSlider("keySliders", "Direction", "az", -180, 180, 0, { bake: true, unit: "°" });
    addSlider("keySliders", "Height", "el", -5, 89, 0, { bake: true, unit: "°" });
    addSlider("keySliders", "Intensity", "intensity", 0, 2, 2);
    addSlider("fillSliders", "Direction", "fillAz", -180, 180, 0, { unit: "°" });
    addSlider("fillSliders", "Height", "fillEl", -5, 89, 0, { unit: "°" });
    addSlider("fillSliders", "Intensity", "fillInt", 0, 1.5, 2);
    addSlider("ambientSliders", "Ambient", "ambient", 0, 1.5, 2);
    [["Specular", "specular", 0, 1], ["Reflectivity", "reflectivity", 0, 1], ["Subsurface", "subsurface", 0, 1],
      ["Depth fog", "fog", 0, 1], ["Contrast", "contrast", 0.5, 1.6]].forEach(function (d) { addSlider("materialSliders", d[0], d[1], d[2], d[3], 2); });
    allSliders.push(makeSlider($("brushRow"), {
      label: "Brush", min: 1, max: 500, step: 1, unit: "px", noUndo: true,
      get: function () { return ui.brush; },
      set: function (v) { ui.brush = Math.round(v); allSliders.forEach(function (s) { s.update(); }); },
      commit: function () { persist(); B.setBrushSize(ui.brush); status("Brush " + ui.brush + " px"); }
    }));
  }

  function lightAngles(i) { var L = lighting(); return i === 0 ? { az: L.az, el: L.el } : { az: state.fillAz, el: state.fillEl }; }
  function setLightAngles(i, az, el) {
    if (i === 0) { bakeToManual(); state.az = az; state.el = el; } else { state.fillAz = az; state.fillEl = el; }
  }

  function bind() {
    each(document.querySelectorAll("[data-pop]"), function (b) {
      noDrag(b);
      b.addEventListener("click", function () { showPop(b.getAttribute("data-pop")); });
    });
    document.addEventListener("pointerdown", function (e) {
      if (!openPop) return;
      var n = e.target, inside = false;
      while (n) { if (n.id === "popover" || (n.getAttribute && n.getAttribute("data-pop"))) { inside = true; break; } n = n.parentNode; }
      if (!inside) showPop(null);
    });

    $("btnLayout").addEventListener("click", function () {
      ui.layout = ui.layout === "full" ? "compact" : ui.layout === "compact" ? "classic" : "full";
      persist(); refreshAll(true); status("Layout: " + LAYOUT_NAMES[ui.layout]);
    });

    onSeg("shapeSeg", function (v) { beginEdit(); state.shape = v; endEdit(); });
    onSeg("lightModeSeg", function (v) { beginEdit(); if (v === "manual") bakeToManual(); else state.lightMode = "time"; endEdit(); refreshAll(true); });
    $("spotBtn").addEventListener("click", function () { beginEdit(); state.spot = !state.spot; endEdit(); });
    $("fillOnBtn").addEventListener("click", function () { beginEdit(); state.fillOn = !state.fillOn; endEdit(); });
    $("toonBtn").addEventListener("click", function () { beginEdit(); state.toon = !state.toon; endEdit(); });
    $("chromeBtn").addEventListener("click", function () { beginEdit(); state.chrome = !state.chrome; endEdit(); });
    $("editKeyBtn").addEventListener("click", function () { selectTarget("light"); showPop(null); });
    $("editFillBtn").addEventListener("click", function () { selectTarget("fill"); showPop(null); });
    $("syncBtn").addEventListener("click", function () {
      ui.sync = !ui.sync; persist(); refreshAll(false);
      status(ui.sync ? "Sync on" : "Sync off");
      if (ui.sync) pushForeground(state.colors.shape, true);
    });
    $("copyHexBtn").addEventListener("click", function () { copyHex(targetHex()); });
    $("exportAseBtn").addEventListener("click", function () {
      B.saveFile("chroma-picker.ase", "ase", SW.toASE(exportColors()), true).then(function (ok) { if (ok) status("Saved .ase"); }, function (e) { status("Export failed"); console.error(e); });
    });
    $("exportGplBtn").addEventListener("click", function () {
      B.saveFile("chroma-picker.gpl", "gpl", SW.toGPL("Chroma Picker", exportColors()), false).then(function (ok) { if (ok) status("Saved .gpl"); }, function (e) { status("Export failed"); console.error(e); });
    });
    $("undoBtn").addEventListener("click", undo);
    $("redoBtn").addEventListener("click", redo);
    $("pinBtn").addEventListener("click", function () {
      var hex = state.colors.shape;
      favorites = favorites.filter(function (h) { return h !== hex; }); favorites.push(hex);
      renderSwatches(); persist(); status("Pinned " + hex);
    });
    $("savePresetBtn").addEventListener("click", function () {
      var p = { name: "My setup " + (userPresets.length + 1), colors: {} };
      PRESET_KEYS.forEach(function (k) { p[k] = state[k]; });
      ["sky", "horizon", "ground", "light", "fill"].forEach(function (k) { p.colors[k] = state.colors[k]; });
      if (state.lightMode === "time") p.colors = { fill: state.colors.fill };
      userPresets.push(p); persist(); buildPresetList(); status("Saved " + p.name);
    });

    // viewport tool buttons
    ["btnEye", "btnTrue", "btnResetScene"].forEach(function (id) { noDrag($(id)); });
    $("btnEye").addEventListener("click", function () { ui.overlays = !ui.overlays; persist(); refreshAll(false); });
    $("btnTrue").addEventListener("click", function () { ui.trueColor = !ui.trueColor; persist(); refreshAll(true); });
    $("btnResetScene").addEventListener("click", function () {
      beginEdit(); SCENE_RESET_KEYS.forEach(function (k) { state[k] = DEFAULTS[k]; }); endEdit(); status("Scene reset");
    });

    // light handles: drag to move, click to edit color
    [0, 1].forEach(function (i) {
      dragOn($("handle" + i), {
        stop: true, relativeTo: $("viewport"),
        start: function () { beginEdit(); ui.selLight = i; },
        move: function (p) {
          var az = ((state.yaw + (p[0] - 0.5) * 300 + 540) % 360) - 180;
          var el = clamp((0.5 - p[1]) * 170 + 10, -5, 89);
          setLightAngles(i, az, el); requestRender(false);
          allSliders.forEach(function (s) { s.update(); });
        },
        end: function (p, s, moved) {
          endEdit();
          if (!moved) selectTarget(i === 0 ? "light" : "fill"); else refreshAll(true);
        }
      });
    });
    // rails
    dragOn($("railLight"), {
      stop: true, immediate: true,
      start: function () { beginEdit(); },
      move: function (p) { var a = lightAngles(ui.selLight); setLightAngles(ui.selLight, a.az, clamp(-5 + (1 - p[1]) * 94, -5, 89)); requestRender(false); allSliders.forEach(function (s) { s.update(); }); },
      end: function () { endEdit(); }
    });
    dragOn($("railCam"), {
      stop: true, immediate: true,
      start: function () { beginEdit(); },
      move: function (p) { state.pitch = 2 + (1 - p[1]) * 68; requestRender(false); },
      end: function () { endEdit(); }
    });
    // viewport: orbit, sample, or move the True Color split
    var drag = null;
    dragOn($("viewport"), {
      start: function (p) {
        if (ui.trueColor && Math.abs(p[0] - ui.split) < 0.05) { drag = { kind: "split" }; return; }
        if (ui.sampling) { drag = { kind: "sample" }; return; }
        beginEdit(); drag = { kind: "orbit", yaw: state.yaw, pitch: state.pitch };
      },
      move: function (p, s) {
        if (!drag) return;
        if (drag.kind === "split") { ui.split = clamp(p[0], 0.02, 0.98); requestRender(false); return; }
        if (drag.kind === "orbit") {
          state.yaw = drag.yaw - (p[0] - s[0]) * 270;
          state.pitch = clamp(drag.pitch + (p[1] - s[1]) * 110, 2, 70);
          requestRender(false);
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

    // targets, sample, lock, PS chips
    each(document.querySelectorAll(".target"), function (t) { t.addEventListener("click", function () { selectTarget(t.getAttribute("data-t")); }); });
    $("btnSample").addEventListener("click", function () { ui.sampling = !ui.sampling; refreshAll(false); if (ui.sampling) status("Click the render to sample"); });
    $("btnLock").addEventListener("click", function () {
      ui.locked = !ui.locked; persist(); refreshAll(false);
      status(ui.locked ? "Base color locked" : "Base color follows Photoshop");
    });
    $("fgChip").addEventListener("click", function () { pushForeground(targetHex(), true); addHistory(targetHex()); status("Foreground " + targetHex()); });
    $("bgChip").addEventListener("click", function (e) {
      if (e.altKey) { swapColors(); return; }
      pushBackground(targetHex()); status("Background " + targetHex());
    });

    // color section
    $("btnCollapse").addEventListener("click", function () { ui.collapsed = !ui.collapsed; persist(); refreshAll(false); });
    $("btnField").addEventListener("click", function () { ui.showField = !ui.showField; if (ui.collapsed) ui.collapsed = false; persist(); refreshAll(false); });
    $("modeSelect").addEventListener("change", function () { ui.mode = $("modeSelect").value; buildChannelSliders(); persist(); refreshAll(false); });
    $("cmpOld").addEventListener("click", function () { if (ui.target === "shape") applyShapeHex(previousHex); });
    var hexIn = $("hexInput");
    function commitHex() {
      var rgb = C.hexToRgb(hexIn.value);
      if (!rgb) { hexIn.value = targetHex().slice(1); return; }
      beginEdit(); setTargetHex(ui.target, C.rgbToHex(rgb), false); endEdit();
    }
    hexIn.addEventListener("change", commitHex);
    hexIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { commitHex(); if (hexIn.blur) hexIn.blur(); } });

    dragOn($("field"), {
      immediate: true,
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
      immediate: true,
      start: function () { beginEdit(); },
      move: function (p) {
        var m = MODES[ui.mode], vals = getVals();
        vals[m.strip] = chanAt(m, m.strip, m.invertY ? p[1] : 1 - p[1]);
        setVals(vals, true);
      },
      end: function () { endEdit(); }
    });

    document.addEventListener("keydown", function (e) {
      var tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (mod) return;
      if (e.key === "Escape") { showPop(null); if (ui.sampling) { ui.sampling = false; refreshAll(false); } }
      else if (e.key === "x" || e.key === "X") swapColors();
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

  function endEditQuiet() {
    if (!editSnap) return;
    var before = editSnap; editSnap = null;
    undoStack.push(before); redoStack = [];
    previousHex = before.colors.shape; addHistory(state.colors.shape); persist();
  }
  function swapColors() {
    var fg = host.fg, bg = host.bg;
    beginEdit(); state.colors.shape = bg; state.bg = fg; endEditQuiet();
    pushBackground(fg); pushForeground(bg, true); refreshAll(true);
  }
  function resetColors() {
    beginEdit(); state.colors.shape = "#000000"; state.bg = "#FFFFFF"; endEditQuiet();
    pushBackground("#FFFFFF"); pushForeground("#000000", true); refreshAll(true);
  }

  /* Fit the viewport to the panel height in the Full layout. */
  function fitViewport() {
    if (ui.layout !== "full") { $("viewport").style.height = ""; return; }
    var total = window.innerHeight || 700;
    var other = $("topbar").offsetHeight + document.querySelector(".targets").offsetHeight +
      document.querySelector(".colorsec").offsetHeight + $("status").offsetHeight;
    var w = $("viewport").getBoundingClientRect().width || 300;
    $("viewport").style.height = clamp(total - other - 2, 180, Math.max(180, w * 1.05)) + "px";
  }

  /* ---------- start ---------- */
  function init() {
    buildChannelSliders(); buildSliders(); buildPresetList();
    bind(); renderSwatches();
    $("status").textContent = idleStatus();
    B.getColors().then(function (c) {
      if (c.fg) { host.fg = c.fg; if (ui.sync && !ui.locked) { state.colors.shape = c.fg; previousHex = c.fg; } }
      if (c.bg) { host.bg = c.bg; state.bg = c.bg; }
      refreshAll(false); fitViewport(); requestRender(true);
    });
    setInterval(pollHost, 600);
    B.onHostColorEvent(function () { setTimeout(pollHost, 50); });
    window.addEventListener("resize", function () { fitViewport(); requestRender(true); });
    var lastLayout = ui.layout, lastCollapsed = ui.collapsed, lastField = ui.showField;
    setInterval(function () {
      if (ui.layout !== lastLayout || ui.collapsed !== lastCollapsed || ui.showField !== lastField) {
        lastLayout = ui.layout; lastCollapsed = ui.collapsed; lastField = ui.showField;
        fitViewport(); requestRender(true);
      }
    }, 200);
  }

  window.ChromaPicker = { state: state, ui: ui, refresh: refreshAll, undo: undo, redo: redo, host: host };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
