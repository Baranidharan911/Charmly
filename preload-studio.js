// Studio window (renderer/studio.html) bridge: window.studio. Main checks the sender of every call and
// validates every argument; nothing here trusts the page.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
// Subscribe; returns an unsubscribe function.
const listen = (ch) => (cb) => {
  if (typeof cb !== 'function') return () => {};
  const h = (_e, v) => cb(v);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

const arg = process.argv.find((a) => a.startsWith('--charmline-version='));
const version = arg ? arg.slice('--charmline-version='.length) : '';

// Navigation requests can arrive before the page registers onNavigate (overlay double-click opening a
// closed Studio): keep the latest one and hand it to the first listener.
let navQueued = null;
const navListeners = new Set();
ipcRenderer.on('navigate', (_e, v) => {
  if (navListeners.size) for (const cb of navListeners) cb(v);
  else navQueued = v;
});

contextBridge.exposeInMainWorld('studio', {
  platform: process.platform,
  version,
  settings: {
    get: invoke('settings:get'),
    patch: invoke('settings:patch')
  },
  onSettings: listen('settings'),
  actions: {
    list: invoke('actions:list'),
    setUrl: invoke('actions:setUrl'),
    pick: invoke('actions:pick'),
    setCopy: invoke('actions:setCopy'),
    setToggle: invoke('actions:setToggle'),
    clear: invoke('actions:clear'),
    test: invoke('actions:test')
  },
  onActionsChanged: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const h = () => cb();
    ipcRenderer.on('actions:changed', h);
    return () => ipcRenderer.removeListener('actions:changed', h);
  },
  line: {
    getState: invoke('line:getState'),
    cmd: (op, args) => ipcRenderer.invoke('line:cmd', op, args)
  },
  onLine: listen('line'),
  charms: {
    toggle: invoke('charms:toggle'),
    shown: invoke('charms:shown')
  },
  onShown: listen('shown'),
  onNavigate: (cb) => {
    if (typeof cb !== 'function') return () => {};
    navListeners.add(cb);
    if (navQueued) { const v = navQueued; navQueued = null; cb(v); }
    return () => navListeners.delete(cb);
  },
  openWebsite: () => ipcRenderer.invoke('app:openWebsite')
});
