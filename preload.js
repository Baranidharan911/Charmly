// Overlay (renderer/index.html) bridge: window.charmline. The overlay only draws charms; every control
// lives in the Studio window (preload-studio.js). Main checks the sender of every message.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (cb) => {
  if (typeof cb !== 'function') return;
  ipcRenderer.on(ch, (_e, v) => cb(v));
};

// Line commands can arrive before app.js has loaded: hold them for the first onLineCmd listener
// (main times each request out after 5 s anyway).
let cmdListener = null;
const cmdQueue = [];
ipcRenderer.on('line:cmd', (_e, m) => {
  if (cmdListener) cmdListener(m);
  else if (cmdQueue.length < 50) cmdQueue.push(m);
});

contextBridge.exposeInMainWorld('charmline', {
  platform: process.platform,
  setIgnore: (v) => ipcRenderer.send('set-ignore', !!v),
  onCursor: listen('cursor'),
  onTopInset: listen('top-inset'),
  onSettings: listen('settings'),
  onShown: listen('shown'),
  settings: {
    get: invoke('settings:get')
  },
  actions: {
    list: invoke('actions:list'),
    forget: invoke('actions:forget'),
    trigger: invoke('actions:trigger')
  },
  onActionsChanged: (cb) => { if (typeof cb === 'function') ipcRenderer.on('actions:changed', () => cb()); },
  // Studio line commands: cb({ id, op, args }); answer with lineReply(id, result).
  onLineCmd: (cb) => {
    if (typeof cb !== 'function' || cmdListener) return;
    cmdListener = cb;
    for (const m of cmdQueue.splice(0)) cb(m);
  },
  lineReply: (id, result) => ipcRenderer.send('line:reply', id, result),
  lineState: (state) => ipcRenderer.send('line:state', state),
  openStudio: (cid) => ipcRenderer.send('overlay:openStudio', typeof cid === 'string' ? cid : undefined)
});
