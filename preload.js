const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (cb) => {
  if (typeof cb !== 'function') return;
  ipcRenderer.on(ch, (_e, v) => cb(v));
};

contextBridge.exposeInMainWorld('charmline', {
  platform: process.platform,
  setIgnore: (v) => ipcRenderer.send('set-ignore', !!v),
  // Main makes the window focusable + focused while the panel is open, non-activating when closed.
  panelOpened: (isOpen) => ipcRenderer.send('panel-opened', !!isOpen),
  // Deprecated v1.0 name, kept so an older renderer still works.
  focus: () => ipcRenderer.send('panel-opened', true),
  onTogglePanel: (cb) => { if (typeof cb === 'function') ipcRenderer.on('toggle-panel', () => cb()); },
  onCursor: listen('cursor'),
  onTopInset: listen('top-inset'),
  onSettings: listen('settings'),
  onShown: listen('shown'),
  settings: {
    get: invoke('settings:get'),
    patch: invoke('settings:patch')
  },
  actions: {
    list: invoke('actions:list'),
    setUrl: invoke('actions:setUrl'),
    pick: invoke('actions:pick'),
    setCopy: invoke('actions:setCopy'),
    setToggle: invoke('actions:setToggle'),
    clear: invoke('actions:clear'),
    forget: invoke('actions:forget'),
    trigger: invoke('actions:trigger'),
    test: invoke('actions:test')
  }
});
