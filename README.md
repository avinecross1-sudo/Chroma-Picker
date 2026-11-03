# Chroma Picker for Photoshop

A UXP panel for Photoshop that picks colors under light. You choose a base color and see it on a lit sphere or cube, with a key light and a sky / horizon / ground environment. You can then send the lit shades (highlight, midtone, shadow, bounce) straight to Photoshop's foreground and background colors.

Inspired by the idea behind colgart's Chroma Space. This is an independent implementation with its own code and no shared assets.

![Chroma Picker panel](docs/screenshot.png)

## Workspace

From top to bottom, the panel is laid out as one workspace:

1. **Layout and history** (top left)
   - The sliders button cycles the layout: **Full** (the view fills the panel), **Compact** (a short view) or **Classic** (no 3D view, color field always shown).
   - The clock opens recent colors and undo/redo.
2. **Favorites, time of day, lights, presets and settings** (top right)
   - ★ opens pinned colors.
   - The sunrise icon opens the Time of day slider, which runs from night through sunrise, noon and sunset, and moves the sun and recolors the sky, horizon and ground together.
   - The bulb opens the key and fill lights: direction, height, intensity, a spot option, ambient, and each light's color.
   - The bookmark opens lighting setups: built-in ones, plus your own that you can save and delete.
   - The globe opens Photoshop sync, copy hex, and .ase/.gpl export.
3. **Viewport tools** (inside the view, top)
   - The eye hides or shows the canvas controls.
   - The sliders icon opens the scene and material settings: Sphere, Trio or Cube; specular, reflectivity, subsurface, depth fog, contrast, toon and chrome.
   - The half circle toggles **True Color**, a split view against the unlit local color on neutral gray. Drag the divider or use the ← → keys.
   - ↻ resets the camera and lights.
4. **Lighting rig**
   - Drag the sun handles (key and fill) around the subject.
   - Click a handle to edit that light's color.
   - The left rail sets the height of the selected light.
5. **Camera**
   - Drag anywhere in the view to orbit.
   - The right rail tilts the camera.
6. **Quick-select targets**: Shape (the large circle), Sky, Horizon and Ground. The color section edits whichever target is selected.
7. **Color section**
   - The header shows the target name, a hex field and the mode menu (HSB, RGB, Lab, CMYK, Hue Cube).
   - The ⌄ button shows the 2D color field, and ↑ collapses the section.
   - Below that are the channel sliders and a Brush size slider that sets Photoshop's brush tip.
   - The **lit palette** gives base, highlight, midtone, shadow and bounce colors estimated from the render. Click a color to set the foreground and copy its hex, or Alt-click it to set the background.
8. **Sample, lock and sync**
   - The eyedropper samples a lit shade from the render and sends it to the foreground.
   - The lock keeps the base color when Photoshop's foreground changes.
   - The two squares are Photoshop's foreground and background. Click either one to send the current color to it, and Alt-click the background square to swap them.
   - **X** swaps foreground and background, **D** resets them, and Ctrl/Cmd+Z undoes.

## Requirements

Photoshop 2022 (23.3) or later on Windows or macOS.

## Install

### Option A: the packaged plugin (`dist/ChromaPicker.ccx`)

1. Double-click `ChromaPicker.ccx`. The Creative Cloud desktop app opens and offers to install it. Confirm the warning about a plugin from outside the Marketplace.
2. Restart Photoshop and open **Plugins → Chroma Picker → Chroma Picker**.

If Creative Cloud will not install an unsigned `.ccx` on your system, use Option B.

You can also install from a terminal with Adobe's UnifiedPluginInstallerAgent (UPIA):

- **macOS**:
  `"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install /path/to/ChromaPicker.ccx`
- **Windows**:
  `"C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install C:\path\to\ChromaPicker.ccx`

### Option B: UXP Developer Tool (always works, best for editing)

1. Install **UXP Developer Tool** from the Creative Cloud desktop app (under All apps, then Developer tools).
2. Turn on Developer Mode when it asks (Photoshop: **Settings → Plugins → Enable Developer Mode**), then restart Photoshop.
3. In UXP Developer Tool, click **Add Plugin** and choose `plugin/manifest.json`.
4. Click **••• → Load**. The panel appears under **Plugins → Chroma Picker**.
5. To make your own `.ccx`, use **••• → Package**.

## Develop

- `plugin/` holds the whole plugin as plain HTML, CSS and JavaScript, with no build step.
- Open `plugin/index.html` in a browser to try the UI with a mock Photoshop.
- Run `node test/unit.js` for the color math, swatch writer and renderer checks.
- Run `node test/browser.js <outdir>` for a Playwright UI smoke test with screenshots.
- `node test/make-icons.js` re-renders the icons.

| File | What it does |
|---|---|
| `js/color.js` | sRGB, HSB, Lab (D50), CMYK, and the picker mode definitions |
| `js/render.js` | Ray-traced lit preview and palette estimation |
| `js/png.js` | PNG encoder (UXP has no reliable canvas pixel API, so images are data URLs) |
| `js/bridge.js` | Photoshop foreground/background, clipboard and file saving, with a browser fallback |
| `js/swatches.js` | `.ase` and `.gpl` writers |
| `js/main.js` | Panel UI and state |
