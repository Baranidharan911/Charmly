const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('charmline', {
  platform: process.platform,
  setIgnore: (v) => ipcRenderer.send('set-ignore', v),
  focus: () => ipcRenderer.send('focus-overlay'),
  onTogglePanel: (cb) => ipcRenderer.on('toggle-panel', () => cb()),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  onTopInset: (cb) => ipcRenderer.on('top-inset', (_e, v) => cb(v))
});
