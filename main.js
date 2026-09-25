const {
  app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage,
  shell, dialog, clipboard, powerMonitor
} = require('electron');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { createStore } = require('./src/settings');
const { createActions } = require('./src/actions');
const { createShortcuts } = require('./src/shortcuts');
const { createLogin, APP_ID } = require('./src/login');
const V = require('./src/validate');
const winPlatform = require('./src/platform-win');

const isMac = process.platform === 'darwin', isLinux = process.platform === 'linux', isWin = process.platform === 'win32';
const log = (...a) => { try { console.log('[charm-line]', ...a); } catch { /* stdout closed */ } };

if (isLinux) app.commandLine.appendSwitch('ozone-platform', 'x11');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Fixes the HKCU Run value name used by setLoginItemSettings (see src/login.js, build/installer.nsh).
if (isWin) app.setAppUserModelId(APP_ID);

const RENDERER_FILE = path.join(__dirname, 'renderer', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER_FILE).href;

let win = null, tray = null, hwnd = 0n;
let store, actions, shortcuts, login, winApi = null, caps;
let shortcutErrors = {}, loginState = false;
let pollTimer = null, deskTimer = null, fsTimer = null;
// Visibility: user choice is session-only (always shown on launch); auto/power hides are layered on top.
let userShown = true, autoHidden = false, fsOverride = false, powerHidden = false, lastShown = null;
let panelOpen = false, lastZ = null;

const isVisible = () => userShown && !autoHidden && !powerHidden;
const send = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };

function displayGeom() {
  const d = screen.getPrimaryDisplay();
  return { b: d.bounds, wa: d.workArea };
}

function captureSupported() {
  if (isMac) return true;
  if (!isWin) return false;
  const build = parseInt(String(os.release()).split('.')[2], 10);
  return build >= 19041;
}

// ---------- settings view ----------
const mode = () => (caps.desktopOnly && store.data.visibility === 'desktop' ? 'desktop' : 'top');

function publicSettings() {
  const d = store.data;
  const c = { ...caps };
  if (c.loginNote === undefined) delete c.loginNote;
  return {
    v: 1,
    shortcuts: { ...d.shortcuts },
    shortcutErrors: { ...shortcutErrors },
    visibility: mode(),
    autoHideFullscreen: d.autoHideFullscreen,
    hideFromCapture: d.hideFromCapture,
    openAtLogin: loginState,
    firstRunDone: d.firstRunDone,
    caps: c
  };
}

function broadcastSettings() { send('settings', publicSettings()); buildTrayMenu(); }

function applyShortcuts(extraErrors = {}) {
  shortcutErrors = { ...shortcuts.apply(store.data.shortcuts), ...extraErrors };
}

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

function patchSettings(partial) {
  if (!isObj(partial)) return publicSettings();
  const d = store.data, next = {}, errs = {};
  let shortcutsTouched = false;
  if (isObj(partial.shortcuts)) {
    const sc = { ...d.shortcuts };
    for (const k of ['toggle', 'panel']) {
      if (!(k in partial.shortcuts)) continue;
      shortcutsTouched = true;
      const r = V.validateAccelerator(partial.shortcuts[k]);
      if (!r.ok) { errs[k] = r.error; continue; }
      const other = k === 'toggle' ? 'panel' : 'toggle';
      if (r.value && r.value === sc[other]) { errs[k] = `Already used to ${other === 'toggle' ? 'show/hide charms' : 'open the panel'}.`; continue; }
      sc[k] = r.value;
    }
    next.shortcuts = sc;
  }
  if (partial.visibility === 'top' || (partial.visibility === 'desktop' && caps.desktopOnly)) next.visibility = partial.visibility;
  for (const k of ['autoHideFullscreen', 'hideFromCapture', 'firstRunDone']) if (typeof partial[k] === 'boolean') next[k] = partial[k];
  if (typeof partial.openAtLogin === 'boolean' && caps.login) {
    loginState = login.set(partial.openAtLogin);
    next.openAtLogin = partial.openAtLogin;
  }
  store.update((draft) => Object.assign(draft, next));
  if (shortcutsTouched) applyShortcuts(errs);
  if ('visibility' in next) applyVisibilityMode();
  if ('autoHideFullscreen' in next) applyAutoHide();
  if ('hideFromCapture' in next) applyCapture();
  buildTrayMenu();
  return publicSettings();
}

// ---------- visibility ----------
function applyShown(initial = false) {
  if (!win) return;
  const vis = isVisible();
  if (vis === lastShown) return;
  lastShown = vis;
  if (vis) {
    win.webContents.setBackgroundThrottling(false);
    win.showInactive();
    if (mode() === 'top') win.setAlwaysOnTop(true, 'screen-saver');
    lastZ = null; deskTick();
  } else {
    win.hide();
    // Let the page go "hidden" so rAF / GPU work stops while hidden.
    win.webContents.setBackgroundThrottling(true);
  }
  if (!initial) send('shown', vis);
  buildTrayMenu();
}

function showNow() {
  userShown = true;
  if (autoHidden) { autoHidden = false; fsOverride = true; }
  applyShown();
}

function toggleCharms() {
  if (isVisible()) { userShown = false; applyShown(); } else showNow();
}

function togglePanel() {
  if (!win) return;
  if (!isVisible()) showNow();
  send('toggle-panel');
}

function openPanel() {
  if (!win) return;
  showNow();
  if (!panelOpen) send('toggle-panel');
}

function setPanelOpen(open) {
  panelOpen = !!open;
  if (!win) return;
  if (isWin || isMac) {
    if (panelOpen) { win.setFocusable(true); win.focus(); }
    else { if (win.isFocused()) win.blur(); win.setFocusable(false); }
  } else if (panelOpen) win.focus();
  lastZ = null; deskTick();
}

// Desktop-only mode (Windows + koffi): sit at the bottom, come up when the desktop is foreground.
const KEEP_Z_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', '#32768']);
function deskTick() {
  if (!win || !winApi || mode() !== 'desktop' || !isVisible()) return;
  let want;
  if (panelOpen) want = 'top';
  else {
    const fg = winApi.foreground();
    if (!fg || fg === hwnd) return;
    const cls = winApi.className(fg);
    if (KEEP_Z_CLASSES.has(cls)) return; // tray / taskbar / menus: don't flicker
    want = winApi.isDesktopClass(cls) ? 'top' : 'bottom';
  }
  if (want === lastZ) return;
  lastZ = want;
  if (want === 'top') winApi.toTop(hwnd); else winApi.toBottom(hwnd);
}

function applyVisibilityMode() {
  if (!win) return;
  if (deskTimer) { clearInterval(deskTimer); deskTimer = null; }
  lastZ = null;
  if (mode() === 'desktop') {
    win.setAlwaysOnTop(false);
    deskTick();
    deskTimer = setInterval(deskTick, 300);
  } else {
    win.setAlwaysOnTop(true, 'screen-saver');
  }
}

// Auto-hide while a fullscreen app / game / presentation is in front.
function fsTick() {
  if (!winApi) return;
  const fg = winApi.foreground();
  if (fg && fg === hwnd) return;
  const full = winApi.fullscreenInFront(fg);
  if (!full) {
    fsOverride = false;
    if (autoHidden) { autoHidden = false; applyShown(); }
  } else if (!fsOverride && !autoHidden) { autoHidden = true; applyShown(); }
}

function applyAutoHide() {
  const on = caps.autoHide && store.data.autoHideFullscreen;
  if (isMac && win) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !on });
  if (isWin) {
    if (fsTimer) { clearInterval(fsTimer); fsTimer = null; }
    if (on) fsTimer = setInterval(fsTick, 1000);
    else if (autoHidden || fsOverride) { autoHidden = false; fsOverride = false; applyShown(); }
  }
}

function applyCapture() {
  if (win) win.setContentProtection(!!(caps.capture && store.data.hideFromCapture));
}

// ---------- window ----------
function createOverlay() {
  const { b, wa } = displayGeom();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    focusable: isLinux, // win32/darwin: never activate unless the panel is open
    backgroundColor: '#00000000', title: 'Charm Line',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false
    }
  });
  try { hwnd = isWin ? winPlatform.hwndFromBuffer(win.getNativeWindowHandle()) : 0n; } catch { hwnd = 0n; }
  win.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  applyCapture();
  win.loadFile(RENDERER_FILE, { query: { top: String(Math.max(0, wa.y - b.y)) } });
  win.once('ready-to-show', () => {
    applyShown(true);
    applyVisibilityMode();
    applyAutoHide();
  });
  win.on('closed', () => { win = null; });

  if (isLinux) {
    let last = '';
    pollTimer = setInterval(() => {
      if (!win || !isVisible()) return;
      const p = screen.getCursorScreenPoint(), g = displayGeom().b, key = p.x + ',' + p.y;
      if (key !== last) { last = key; win.webContents.send('cursor', { x: p.x - g.x, y: p.y - g.y }); }
    }, 33);
  }
}

function fitToDisplay() {
  if (!win) return;
  const { b, wa } = displayGeom();
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.webContents.send('top-inset', Math.max(0, wa.y - b.y));
}

// ---------- tray ----------
const accel = (s) => (s ? { accelerator: s, registerAccelerator: false } : {});

function buildTrayMenu() {
  if (!tray) return;
  const d = store.data, vis = isVisible();
  const showLabel = vis ? 'Hide charms' : userShown ? 'Show charms now' : 'Show charms';
  const setMode = (m) => { patchSettings({ visibility: m }); broadcastSettings(); };
  const template = [
    { label: 'Open charm panel', ...accel(d.shortcuts.panel), click: togglePanel },
    { label: showLabel, ...accel(d.shortcuts.toggle), click: toggleCharms }
  ];
  if (caps.desktopOnly) {
    template.push({ label: 'Where charms appear', submenu: [
      { label: 'Over everything', type: 'radio', checked: mode() === 'top', click: () => setMode('top') },
      { label: 'Desktop only', type: 'radio', checked: mode() === 'desktop', click: () => setMode('desktop') }
    ] });
  }
  template.push({ type: 'separator' });
  if (caps.login) {
    template.push({ label: 'Start at login', type: 'checkbox', checked: loginState, click: (i) => { patchSettings({ openAtLogin: i.checked }); broadcastSettings(); } });
    template.push({ type: 'separator' });
  }
  template.push({ label: 'Quit Charm Line', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(template));
  const why = vis ? '' : autoHidden ? ' (hidden for a fullscreen app)' : powerHidden ? '' : ' (hidden)';
  tray.setToolTip('Charm Line' + (mode() === 'desktop' ? ' - desktop only' : '') + why);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', togglePanel);
  buildTrayMenu();
}

// ---------- IPC ----------
function sameUrlPrefix(u) {
  if (typeof u !== 'string') return false;
  let a = u, b = RENDERER_URL;
  try { a = decodeURI(a); b = decodeURI(b); } catch { return false; }
  if (isWin || isMac) { a = a.toLowerCase(); b = b.toLowerCase(); }
  return a === b || a.startsWith(b + '?') || a.startsWith(b + '#');
}

function trusted(e) {
  return !!win && e.sender === win.webContents && !!e.senderFrame && sameUrlPrefix(e.senderFrame.url);
}

const MAX_ARG_STRING = 10000;
const argsOk = (args) => args.every((a) => typeof a !== 'string' || a.length <= MAX_ARG_STRING);

function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    if (!trusted(e)) throw new Error('Not allowed');
    if (!argsOk(args)) return { ok: false, error: 'Too long.' };
    return fn(...args);
  });
}

function registerIpc() {
  ipcMain.on('set-ignore', (e, ignore) => {
    if (!trusted(e) || !win) return;
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.on('panel-opened', (e, open) => { if (trusted(e)) setPanelOpen(open === true); });
  ipcMain.on('focus-overlay', (e) => { if (trusted(e)) setPanelOpen(true); }); // v1.0 channel

  handle('settings:get', () => publicSettings());
  handle('settings:patch', (partial) => patchSettings(partial));
  handle('actions:list', () => actions.list());
  handle('actions:setUrl', (cid, slot, url, label) => actions.setUrl(cid, slot, url, label));
  handle('actions:pick', (cid, slot, kind) => actions.pick(cid, slot, kind));
  handle('actions:setCopy', (cid, slot, text, label) => actions.setCopy(cid, slot, text, label));
  handle('actions:setToggle', (cid, slot) => actions.setToggle(cid, slot));
  handle('actions:clear', (cid, slot) => actions.clear(cid, slot));
  handle('actions:forget', (cid) => actions.forget(cid));
  handle('actions:trigger', (cid, slot) => actions.trigger(cid, slot));
  handle('actions:test', (cid, slot) => actions.test(cid, slot));
}

// ---------- startup ----------
function init() {
  store = createStore({ file: path.join(app.getPath('userData'), 'settings.json'), log });
  const loaded = store.load();
  if (loaded.source !== 'file') log('settings loaded from', loaded.source, loaded.corruptFile || '');

  winApi = isWin ? winPlatform.load({ log }) : null;
  login = createLogin({ app, log });
  caps = {
    desktopOnly: !!winApi,
    autoHide: isWin ? !!winApi : isMac,
    capture: captureSupported(),
    login: login.caps.login,
    portable: login.caps.portable,
    loginNote: login.caps.loginNote
  };
  log('caps', JSON.stringify(caps));
  loginState = login.init(store.data.openAtLogin);
  if (caps.login && loginState !== store.data.openAtLogin) store.update((d) => { d.openAtLogin = loginState; });

  actions = createActions({
    store, shell, dialog, clipboard, log,
    getWin: () => win,
    getIcon: async (p) => {
      const img = await app.getFileIcon(p, { size: 'normal' });
      return img && !img.isEmpty() ? img.toDataURL() : null;
    },
    onToggle: () => { userShown = false; applyShown(); }
  });
  shortcuts = createShortcuts({ globalShortcut, handlers: { toggle: toggleCharms, panel: togglePanel }, log });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openPanel);

  app.whenReady().then(() => {
    if (isMac && app.dock) app.dock.hide();
    init();
    registerIpc();
    createOverlay();
    createTray();
    applyShortcuts();
    buildTrayMenu();
    screen.on('display-metrics-changed', fitToDisplay);
    screen.on('display-added', fitToDisplay);
    screen.on('display-removed', fitToDisplay);
    const powerOff = () => { powerHidden = true; applyShown(); };
    const powerOn = () => { powerHidden = false; applyShown(); };
    powerMonitor.on('lock-screen', powerOff);
    powerMonitor.on('suspend', powerOff);
    powerMonitor.on('unlock-screen', powerOn);
    powerMonitor.on('resume', powerOn);
  });

  app.on('will-quit', () => {
    if (shortcuts) shortcuts.unregisterAll();
    for (const t of [pollTimer, deskTimer, fsTimer]) if (t) clearInterval(t);
  });
  app.on('window-all-closed', () => app.quit());
}

