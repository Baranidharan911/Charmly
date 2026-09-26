const {
  app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage,
  shell, dialog, clipboard, powerMonitor, nativeTheme
} = require('electron');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { createStore } = require('./src/settings');
const { createActions } = require('./src/actions');
const { createShortcuts } = require('./src/shortcuts');
const { createLogin, isHiddenLaunch, APP_ID } = require('./src/login');
const { validateLineCmd } = require('./src/linecmd');
const { createRelay, NOT_RESPONDING } = require('./src/linerelay');
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
const STUDIO_FILE = path.join(__dirname, 'renderer', 'studio.html');
const STUDIO_URL = pathToFileURL(STUDIO_FILE).href;
const WEBSITE = 'https://luckonaline.netlify.app';

let win = null, tray = null, hwnd = 0n;
let studio = null, studioHwnd = 0n, studioLoaded = false, studioWantShow = false, pendingNav = null, quitting = false;
let lastLineState = null;
let store, actions, shortcuts, login, winApi = null, caps;
let shortcutErrors = {}, loginState = false;
let pollTimer = null, deskTimer = null, fsTimer = null;
// Visibility: user choice is session-only (always shown on launch); auto/power hides are layered on top.
let userShown = true, autoHidden = false, fsOverride = false, powerHidden = false, lastShown = null;
let lastZ = null;

const isVisible = () => userShown && !autoHidden && !powerHidden;
const send = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };
const studioAlive = () => !!studio && !studio.isDestroyed();
const sendStudio = (ch, v) => { if (studioAlive() && studioLoaded) studio.webContents.send(ch, v); };
const sendAll = (ch, v) => { send(ch, v); sendStudio(ch, v); };
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

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

function broadcastSettings() { sendAll('settings', publicSettings()); buildTrayMenu(); }

function applyShortcuts(extraErrors = {}) {
  shortcutErrors = { ...shortcuts.apply(store.data.shortcuts), ...extraErrors };
}

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
      if (r.value && r.value === sc[other]) { errs[k] = `Already used to ${other === 'toggle' ? 'show/hide charms' : 'open Charm Line'}.`; continue; }
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
  if (!initial) sendAll('shown', vis);
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

// Desktop-only mode (Windows + koffi): sit at the bottom, come up when the desktop is foreground.
const KEEP_Z_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', '#32768']);
function deskTick() {
  if (!win || !winApi || mode() !== 'desktop' || !isVisible()) return;
  const fg = winApi.foreground();
  if (!fg || fg === hwnd) return;
  const cls = winApi.className(fg);
  if (KEEP_Z_CLASSES.has(cls)) return; // tray / taskbar / menus: don't flicker
  const want = winApi.isDesktopClass(cls) ? 'top' : 'bottom';
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
  if (fg && (fg === hwnd || fg === studioHwnd)) return;
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

// ---------- overlay window ----------
function createOverlay() {
  const { b, wa } = displayGeom();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    focusable: isLinux, // win32/darwin: never activates; every control lives in the Studio window
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
  win.webContents.on('did-start-loading', () => relay.failAll());
  win.webContents.on('render-process-gone', () => relay.failAll());
  applyCapture();
  win.loadFile(RENDERER_FILE, { query: { top: String(Math.max(0, wa.y - b.y)) } });
  // A transparent page with nothing painted yet can take seconds to reach ready-to-show, and a hidden
  // window gets no requestAnimationFrame: show as soon as the page has loaded (nothing to flash).
  let shown = false;
  const firstShow = () => {
    if (shown || !win) return;
    shown = true;
    applyShown(true);
    applyVisibilityMode();
    applyAutoHide();
  };
  win.once('ready-to-show', firstShow);
  win.webContents.once('did-finish-load', firstShow);
  win.on('closed', () => { win = null; relay.failAll(); });

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

// ---------- Studio window ----------
const THEME = { light: { bg: '#f3ecdf', ink: '#231a13' }, dark: { bg: '#141210', ink: '#f1e8d4' } };
const theme = () => THEME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
// Transparent overlay: the page's own title-bar background shows behind the caption buttons.
const captionColors = () => ({ color: '#00000000', symbolColor: theme().ink, height: 44 });

function createStudio() {
  studioLoaded = false;
  studio = new BrowserWindow({
    width: 1120, height: 740, minWidth: 900, minHeight: 600, show: false,
    title: 'Charm Line', icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: theme().bg,
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : { titleBarStyle: 'hidden', titleBarOverlay: captionColors() }),
    webPreferences: {
      preload: path.join(__dirname, 'preload-studio.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: ['--charmline-version=' + app.getVersion()]
    }
  });
  try { studioHwnd = isWin ? winPlatform.hwndFromBuffer(studio.getNativeWindowHandle()) : 0n; } catch { studioHwnd = 0n; }
  const wc = studio.webContents;
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-redirect', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('did-start-loading', () => { studioLoaded = false; });
  wc.on('did-finish-load', () => {
    studioLoaded = true;
    if (pendingNav) { sendStudio('navigate', pendingNav); pendingNav = null; }
    if (studioWantShow) showStudioWindow();
  });
  // Close = hide; the app keeps running in the tray. Real quit: tray "Quit" / app quit.
  studio.on('close', (e) => { if (!quitting) { e.preventDefault(); studio.hide(); } });
  studio.on('closed', () => { studio = null; studioHwnd = 0n; studioLoaded = false; });
  studio.loadFile(STUDIO_FILE);
}

function showStudioWindow() {
  if (!studioAlive()) return;
  studioWantShow = false;
  if (studio.isMinimized()) studio.restore();
  studio.show();
  studio.focus();
  if (isMac) app.focus({ steal: true });
}

/** Show the Studio (creating it if needed). nav = { page: 'line', cid? } reaches studio.onNavigate. */
let studioAfterCharms = false; // startup: open the Studio once the overlay reports its first frame
function openStudio(nav) {
  if (!studioAlive()) createStudio();
  // Not loaded yet: sent from did-finish-load (preload-studio.js buffers it until onNavigate is registered).
  if (nav) { if (studioLoaded) sendStudio('navigate', nav); else pendingNav = nav; }
  if (studioLoaded) showStudioWindow(); else studioWantShow = true;
}

function applyStudioTheme() {
  if (!studioAlive()) return;
  studio.setBackgroundColor(theme().bg);
  if (!isMac) { try { studio.setTitleBarOverlay(captionColors()); } catch (e) { log('titleBarOverlay failed', e.message); } }
}

// ---------- tray ----------
const accel = (s) => (s ? { accelerator: s, registerAccelerator: false } : {});

function buildTrayMenu() {
  if (!tray) return;
  const d = store.data, vis = isVisible();
  const showLabel = vis ? 'Hide charms' : userShown ? 'Show charms now' : 'Show charms';
  const setMode = (m) => { patchSettings({ visibility: m }); broadcastSettings(); };
  const template = [
    { label: 'Open Charm Line', ...accel(d.shortcuts.panel), click: () => openStudio() },
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
  template.push({ label: 'Quit', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(template));
  const why = vis ? '' : autoHidden ? ' (hidden for a fullscreen app)' : powerHidden ? '' : ' (hidden)';
  tray.setToolTip('Charm Line' + (mode() === 'desktop' ? ' - desktop only' : '') + why);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', () => openStudio());
  buildTrayMenu();
}

// ---------- IPC ----------
function sameUrlPrefix(u, base) {
  if (typeof u !== 'string') return false;
  let a = u, b = base;
  try { a = decodeURI(a); b = decodeURI(b); } catch { return false; }
  if (isWin || isMac) { a = a.toLowerCase(); b = b.toLowerCase(); }
  return a === b || a.startsWith(b + '?') || a.startsWith(b + '#');
}

function trustedOverlay(e) {
  return !!win && e.sender === win.webContents && !!e.senderFrame && sameUrlPrefix(e.senderFrame.url, RENDERER_URL);
}
function trustedStudio(e) {
  return studioAlive() && e.sender === studio.webContents && !!e.senderFrame && sameUrlPrefix(e.senderFrame.url, STUDIO_URL);
}
// Which window may use a channel.
const OVERLAY = 1, STUDIO = 2, BOTH = OVERLAY | STUDIO;
const allowed = (e, who) => ((who & OVERLAY) && trustedOverlay(e)) || ((who & STUDIO) && trustedStudio(e));

const MAX_ARG_STRING = 10000;
const argsOk = (args) => args.every((a) => typeof a !== 'string' || a.length <= MAX_ARG_STRING);

function handle(ch, fn, who) {
  ipcMain.handle(ch, async (e, ...args) => {
    if (!allowed(e, who)) throw new Error('Not allowed');
    if (!argsOk(args)) return { ok: false, error: 'Too long.' };
    return fn(...args);
  });
}

// Studio -> overlay line commands: correlated by id, 5 s timeout -> "Charms are not responding".
// Held until the overlay's first LineState push (it is still loading its charms before that).
const relay = createRelay({
  send: (msg) => {
    if (!win || win.isDestroyed() || win.webContents.isCrashed()) return false; // loading: preload.js buffers it
    win.webContents.send('line:cmd', msg);
    return true;
  }
});

function registerIpc() {
  ipcMain.on('set-ignore', (e, ignore) => {
    if (!trustedOverlay(e) || !win) return;
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  // Overlay -> main: replies, state pushes, double-click on a charm.
  ipcMain.on('line:reply', (e, id, result) => { if (trustedOverlay(e) && Number.isSafeInteger(id)) relay.reply(id, result); });
  ipcMain.on('line:state', (e, state) => {
    if (!trustedOverlay(e) || !isObj(state) || !isObj(state.S) || !Array.isArray(state.charms)) return;
    lastLineState = state;
    relay.setReady(true); // the first push means the overlay is taking commands
    if (state.drawn && studioAfterCharms) { studioAfterCharms = false; openStudio(); }
    sendStudio('line', state); // no Studio page loaded: dropped
  });
  ipcMain.on('overlay:openStudio', (e, cid) => {
    if (!trustedOverlay(e)) return;
    openStudio(V.isCid(cid) ? { page: 'line', cid } : { page: 'line' });
  });

  // Any action / binding change -> both windows refresh (studio.onActionsChanged, the overlay's cache).
  const changing = (fn) => async (...a) => {
    const r = await fn(...a);
    if (r && r.ok) sendAll('actions:changed');
    return r;
  };

  handle('settings:get', () => publicSettings(), BOTH);
  handle('settings:patch', (partial) => patchSettings(partial), STUDIO);
  handle('actions:list', () => actions.list(), BOTH);
  handle('actions:setUrl', changing((cid, slot, url, label) => actions.setUrl(cid, slot, url, label)), STUDIO);
  handle('actions:pick', changing((cid, slot, kind) => actions.pick(cid, slot, kind)), STUDIO);
  handle('actions:setCopy', changing((cid, slot, text, label) => actions.setCopy(cid, slot, text, label)), STUDIO);
  handle('actions:setToggle', changing((cid, slot) => actions.setToggle(cid, slot)), STUDIO);
  handle('actions:clear', changing((cid, slot) => actions.clear(cid, slot)), STUDIO);
  handle('actions:test', (cid, slot) => actions.test(cid, slot), STUDIO);
  handle('actions:forget', changing((cid) => actions.forget(cid)), OVERLAY);
  handle('actions:trigger', (cid, slot) => actions.trigger(cid, slot), OVERLAY);

  handle('line:cmd', (op, args) => {
    const v = validateLineCmd(op, args);
    if (!v.ok) return v;
    if (v.op === 'highlight' && !isVisible()) showNow(); // "Show me" needs the charms on screen
    return relay.request(v.op, v.args);
  }, STUDIO);
  handle('line:getState', async () => {
    const r = await relay.request('getState', {});
    if (r.ok && isObj(r.state)) { lastLineState = r.state; return r.state; }
    if (lastLineState) return lastLineState;
    throw new Error(r.error || NOT_RESPONDING);
  }, STUDIO);
  handle('charms:toggle', () => { toggleCharms(); return isVisible(); }, STUDIO);
  handle('charms:shown', () => isVisible(), STUDIO);
  handle('app:openWebsite', async () => { await shell.openExternal(WEBSITE); return true; }, STUDIO);
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
    // Pickers and confirmations belong to the Studio while it is the focused window.
    getWin: () => (studioAlive() && studio.isVisible() && studio.isFocused() ? studio : win),
    getIcon: async (p) => {
      const img = await app.getFileIcon(p, { size: 'normal' });
      return img && !img.isEmpty() ? img.toDataURL() : null;
    },
    onToggle: () => { userShown = false; applyShown(); }
  });
  shortcuts = createShortcuts({ globalShortcut, handlers: { toggle: toggleCharms, panel: () => openStudio() }, log });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!app.isReady() || isHiddenLaunch(argv)) return; // a sign-in launch while already running: stay quiet
    showNow();
    openStudio();
  });
  app.on('activate', () => { if (app.isReady() && store) openStudio(); }); // macOS: Dock / Finder relaunch
  app.on('before-quit', () => { quitting = true; });

  app.whenReady().then(() => {
    if (isMac && app.dock) app.dock.hide();
    init();
    registerIpc();
    createOverlay();
    createTray();
    applyShortcuts();
    buildTrayMenu();
    // Started at sign-in (--hidden): charms only. Otherwise the Studio opens (its onboarding on first run).
    // Wait for the charms' first frame so the two windows don't load at once; open anyway after 10 s.
    if (!isHiddenLaunch(process.argv, { app })) {
      studioAfterCharms = true;
      setTimeout(() => { if (studioAfterCharms) { studioAfterCharms = false; openStudio(); } }, 10000);
    }
    nativeTheme.on('updated', applyStudioTheme);
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
