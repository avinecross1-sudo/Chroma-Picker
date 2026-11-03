# Chroma Picker for Photoshop

A UXP panel for Photoshop that picks colors under light. You choose a base color and see it on a lit sphere or cube, with a key light and a sky / horizon / ground environment. You can then send the lit shades (highlight, midtone, shadow, bounce) straight to Photoshop's foreground and background colors.

Inspired by the idea behind colgart's Chroma Space. This is an independent implementation with its own code and no shared assets.

![Chroma Picker panel](docs/screenshot.png)

## Features

- **Lit 3D preview**: a sphere or cube on a ground plane, drawn by a small CPU ray tracer.
  - **Light**: drag the preview to place the key light.
  - **Orbit**: drag to turn the camera.
  - **Sample**: click a lit pixel to send that shade to the foreground.
  - **True**: compares the lit render with the unlit local color on neutral gray. Drag the divider, or use the ← → arrow keys (Shift moves it faster).
- **Targets**: Shape, Sky, Horizon, Ground and Light. The picker edits whichever target is selected.
- **Picker modes**: HSB, RGB, Lab (D50, with colors outside sRGB dimmed), CMYK (simple device CMYK) and Hue Cube (hue across, brightness up, saturation on the strip). Each mode has a 2D field, a strip, gradient channel sliders and number inputs. Arrow keys nudge a number input, and Shift nudges by 10.
- **Lighting**
  - **Manual**: direction, height, intensity and ambient.
  - **Time of day**: one slider drives the sun position, sun color, sky, horizon and ground together.
  - Directional sun or spot light.
  - Built-in lighting setups (Studio, Overcast, Golden hour, Midday sun, Moonlight, Rim light, Campfire). You can also save your own.
  - Editing an environment color while in Time of day mode bakes the current time into Manual mode.
- **Material**: specular, reflectivity, subsurface, depth fog, contrast, toon (three-tone) shading and chrome.
- **Lit palette**: base, highlight, midtone, shadow and bounce colors, estimated from the render.
  - Click a row to set the foreground and copy its hex.
  - Alt-click a row to set the background.
- **Photoshop sync** (two-way)
  - Changing the base color sets Photoshop's foreground.
  - Changing the foreground or background in Photoshop updates the panel.
  - **X** swaps foreground and background. **D** resets them to black and white.
- **Swatches**
  - Pinned colors: Shift-click to unpin, Alt-click to set as background.
  - History of the last 24 colors.
  - Export the palette and pinned colors as **.ase** (Adobe) or **.gpl** (Krita, GIMP).
- **Undo and redo** for color and lighting changes: the buttons, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.
- **3D button**: hides the 3D view and lighting for a compact, classic picker.

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
