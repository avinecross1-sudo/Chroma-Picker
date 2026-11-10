// Chroma Picker desktop app: an Electron window around the shared panel UI in ./ui (copied from plugin/).
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } = require('electron');
const path = require('path'), fs = require('fs');

let win = null;
const prefsFile = () => path.join(app.getPath('userData'), 'window.json');
function readPrefs() { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch (e) { return {}; } }
function writePrefs(p) { try { fs.writeFileSync(prefsFile(), JSON.stringify(p)); } catch (e) { /* ignore */ } }

function createWindow() {
  const prefs = readPrefs();
  const b = prefs.bounds || {};
  win = new BrowserWindow({
    width: b.width || 340, height: b.height || 820, x: b.x, y: b.y,
    minWidth: 260, minHeight: 420,
    title: 'Chroma Picker',
    backgroundColor: '#2B2D31',
    alwaysOnTop: !!prefs.alwaysOnTop,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Keep the app self-contained: no new windows, links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const save = () => { if (!win || win.isMinimized() || win.isMaximized()) return; writePrefs(Object.assign(readPrefs(), { bounds: win.getBounds() })); };
  win.on('resized', save); win.on('moved', save); win.on('close', save);
  win.on('closed', () => { win = null; });
  buildMenu();
}

function setAlwaysOnTop(on) {
  if (win) win.setAlwaysOnTop(on);
  writePrefs(Object.assign(readPrefs(), { alwaysOnTop: on }));
  buildMenu();
}

function buildMenu() {
  const onTop = !!readPrefs().alwaysOnTop;
  const template = [
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Always on Top', type: 'checkbox', checked: onTop, accelerator: 'CmdOrCtrl+T', click: (m) => setAlwaysOnTop(m.checked) },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' }
    ] },
    { label: 'Help', submenu: [{ label: 'About Chroma Picker', click: () => dialog.showMessageBox(win, {
      type: 'info', title: 'Chroma Picker', message: 'Chroma Picker ' + app.getVersion(),
      detail: 'Pick colors under light. Standalone version of the Chroma Picker Photoshop panel.' }) }] }
  ];
  if (process.platform === 'darwin') template.unshift({ role: 'appMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('cp:copyText', (_e, text) => { clipboard.writeText(text); return true; });
ipcMain.handle('cp:saveFile', async (_e, { name, ext, data, binary }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: ext.toUpperCase() + ' swatches', extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return false;
  const buf = binary ? Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data) : String(data);
  fs.writeFileSync(r.filePath, buf);
  return true;
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!win) createWindow(); });
}
