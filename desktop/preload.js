// Exposes the few desktop services the shared UI needs (see plugin/js/bridge.js).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('CPDesktop', {
  copyText: (text) => ipcRenderer.invoke('cp:copyText', String(text)),
  saveFile: (name, ext, data, binary) => ipcRenderer.invoke('cp:saveFile', { name, ext, data, binary })
});
