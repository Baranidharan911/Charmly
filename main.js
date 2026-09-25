const { app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null, tray = null, charmsShown = true, pollTimer = null;
const isMac = process.platform === 'darwin', isLinux = process.platform === 'linux';

function displayGeom() {
  const d = screen.getPrimaryDisplay();
  return { b: d.bounds, wa: d.workArea };
}

function createOverlay() {
  const { b, wa } = displayGeom();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000', title: 'Charm Line',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { top: String(Math.max(0, wa.y - b.y)) } });
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => { win = null; });

  if (isLinux) {
    let last = '';
    pollTimer = setInterval(() => {
      if (!win || !charmsShown) return;
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

function togglePanel() {
  if (!win) return;
  if (!charmsShown) setCharmsShown(true);
  win.webContents.send('toggle-panel');
}

function setCharmsShown(v) {
  charmsShown = v;
  if (!win) return;
  if (v) win.showInactive(); else win.hide();
  buildTrayMenu();
}

function buildTrayMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: 'Open charm panel', accelerator: 'CommandOrControl+Shift+H', click: togglePanel },
    { label: charmsShown ? 'Hide charms' : 'Show charms', click: () => setCharmsShown(!charmsShown) },
    { type: 'separator' },
    { label: 'Start at login', type: 'checkbox', checked: login, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Quit Charm Line', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Charm Line');
  tray.on('click', togglePanel);
  buildTrayMenu();
}

ipcMain.on('set-ignore', (_e, ignore) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('focus-overlay', () => { if (win) win.focus(); });

app.on('second-instance', togglePanel);

app.whenReady().then(() => {
  if (isMac && app.dock) app.dock.hide();
  createOverlay();
  createTray();
  globalShortcut.register('CommandOrControl+Shift+H', togglePanel);
  screen.on('display-metrics-changed', fitToDisplay);
  screen.on('display-added', fitToDisplay);
  screen.on('display-removed', fitToDisplay);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); if (pollTimer) clearInterval(pollTimer); });
app.on('window-all-closed', () => app.quit());
