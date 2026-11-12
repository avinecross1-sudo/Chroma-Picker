# Chroma Picker for Photoshop

A UXP panel for Photoshop that picks colors under light. You choose a base color and see it on a lit sphere, cube or planar (Asaro-style) head, with a key light and a sky / horizon / ground environment. You can then send the lit shades (highlight, midtone, shadow, bounce) straight to Photoshop's foreground and background colors.

Inspired by the idea behind colgart's Chroma Space. This is an independent implementation with its own code and no shared assets.

![Chroma Picker panel](docs/screenshot.png)

## Standalone app

Chroma Picker also runs on its own, without Photoshop, as a small desktop window (Windows, macOS, Linux). It is the same panel and the same code: `desktop/` is an Electron shell that loads the files in `plugin/`.

What is different from the plugin:

- The foreground and background chips belong to the app and are remembered between runs. There is no Photoshop sync, lock or brush size.
- **Pick from screen**: the monitor icon next to the eyedropper (or the `I` key) picks any color on your screen into the selected target.
- Copy hex goes to the system clipboard, and .ase / .gpl export opens a normal save dialog.
- View > Always on Top (`Ctrl/Cmd+T`) keeps the window above your painting app. The window remembers its size and position.

Run or build it (needs Node.js 20 or newer):

```
cd desktop
npm install
npm start            # run from source
npm run dist:win     # Windows installer, portable .exe and .zip in desktop/dist (run on Windows)
npm run dist:mac     # macOS .dmg (run on a Mac)
npm run dist:linux   # Linux AppImage
```

The builds are not code signed, so Windows SmartScreen shows a warning the first time; choose More info > Run anyway. `desktop/ui/` is copied from `plugin/` on every start and build, so edit the files under `plugin/`.

## Workspace

From top to bottom, the panel is laid out as one workspace:

1. **Tool row** (one slim row at the top). Settings open as popovers that float over the view.
   - Left: the layout icon opens the scene and material settings (Sphere, Trio, Cube, Asaro or Asaro Low; the two Asaro heads are planar study busts whose facets shadow each other, Asaro Low with fewer, larger planes; sheen, shadow softness, specular, reflectivity, subsurface, depth fog, contrast, toon and chrome). The sliders icon floats the color controls over the bottom of the view. The half circle toggles **True Color**, a split view against the unlit local color on neutral gray (drag the divider or use the ← → keys).
   - Right: the sunrise icon shows or hides the time bar along the bottom of the view (RISE, SUNNY, G.HOUR, SUNSET, NIGHT). The bulb opens the lights: the sun's current time, then the key and rim lights (direction, height, intensity up to 2×, spot, ambient and each light's color). The bookmark opens lighting setups, built in and your own. The globe opens pinned colors, history with undo/redo, the 3D or Classic layout, the canvas handles toggle, brush size, Photoshop sync, copy hex and .ase/.gpl export.
2. **View**: fills whatever height the panel has. ↻ in its corner resets the camera and lights.
3. **Targets row**: Shape (the large circle), Sky, Horizon and Ground, then the eyedropper, the lock, and Photoshop's foreground and background colors.
4. **Color section**, then a **status bar** showing which target is being edited (BASE MODE, SKY MODE, GROUND MODE and so on).
5. **Responsiveness**: while you drag, the view draws a quick low-resolution frame; the sharp frame is computed in small slices between events and is dropped if anything changes, so dragging never waits on it. The panel re-lays itself out when Photoshop resizes it.

### Details

1. **Lighting**
   - Sky, horizon and ground are three independent colors. Together they form the backdrop and also light the subject: sky fill from above, bounce from the ground below, and a sheen at the edges that picks up the horizon. Shadows on the ground are soft and spread out with distance.
   - The material popover has Sheen and Shadow softness sliders.
2. **Lighting rig**: three lights.
   - **Sun**: part of the skybox. Its direction, color and strength, and the sky and horizon colors, follow the time of day, and only the time bar changes them. It shows as a small sun mark on the view. Editing Sky or Horizon by hand keeps a custom sky until you drag the time bar again.
   - **Key light**: your main light, with color and intensity from 0 to 2×.
   - **Rim light**: a back light that only catches the edges turned away from the camera, with color and intensity from 0 to 2×.
   - Drag the key and rim handles around the subject. They reach the whole sphere, including behind and below it: the middle of the view puts a light at the camera, the left and right edges put it behind the subject, and the top and bottom edges put it above and below. The sun keeps following the time of day.
   - Click a handle to edit that light's color.
   - The left rail sets the height of the selected light, from straight below (-90°) to straight above (90°).
3. **Camera**
   - Drag anywhere in the view to orbit a full 360° in any direction, over the top and underneath. Seen from below, the ground turns see-through so the subject stays in view.
   - The right rail tilts the camera all the way around (-180° to 180°).
4. **Quick-select targets**: Shape (the large circle), Sky, Horizon and Ground. The color section edits whichever target is selected.
5. **Color section**
   - The header shows the target name, a hex field and the mode menu (HSB, RGB, Lab, CMYK, Hue Cube).
   - The ⌄ button shows the 2D color field.
   - Below that are the channel sliders (the Brush size slider that sets Photoshop's brush tip is in the globe menu).
   - The **lit palette** gives base, highlight, midtone, shadow and bounce colors estimated from the render. Click a color to set the foreground and copy its hex, or Alt-click it to set the background.
6. **Sample, lock and sync**
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
| `js/model-asaro.js`, `js/model-asaro-low.js` | Packed meshes for the two Asaro heads. `test/pack-model.py` regenerates them from a source `.obj` (see the top of that script) |
| `js/png.js` | PNG encoder (UXP has no reliable canvas pixel API, so images are data URLs) |
| `js/bridge.js` | Photoshop foreground/background, clipboard and file saving, with a browser fallback |
| `js/swatches.js` | `.ase` and `.gpl` writers |
| `js/main.js` | Panel UI and state |

## Model credits

The **Asaro** and **Asaro Low** preview models are packed copies of `ASARO_HEAD.obj` (reduced from 1.27 million to 6,000 triangles) and `Asaro_low.obj`, both supplied by the project owner. The planes-of-the-head design is John Asaro's. Check the terms of the source files before distributing builds that include them; removing a model only takes deleting its `js/model-*.js` file and its button and script tag in `index.html`.
