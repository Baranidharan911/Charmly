'use strict';
// "Start at login" per platform. Electron `app`, fs, env are injected.
//
// Windows: Electron writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run\<AppUserModelId>.
// main.js sets the AUMID to the appId (APP_ID below), so the value name is "in.elbrit.charmline".
// v1.0 did not set an AUMID, so its value was named "electron.app.Charm Line"; we migrate it.
// build/installer.nsh deletes both names on uninstall.
//
// v1.2: the login entry passes --hidden so a sign-in launch doesn't open the Studio window.
// v1.1 wrote the same value without arguments; init() rewrites it (keeping a Task Manager "disabled").
const nodeFs = require('fs');
const nodePath = require('path');
const os = require('os');

const APP_ID = 'in.elbrit.charmline';
const LEGACY_RUN_NAME = 'electron.app.Charm Line';
const PORTABLE_NOTE = "Starts from this folder. Don't move it.";
const HIDDEN_ARG = '--hidden';
const LOGIN_ARGS = Object.freeze([HIDDEN_ARG]);

/** Was this process started by the OS at sign-in (so: no Studio window)? */
function isHiddenLaunch(argv = process.argv, { platform = process.platform, app = null } = {}) {
  if (Array.isArray(argv) && argv.includes(HIDDEN_ARG)) return true;
  if (platform === 'darwin' && app) {
    try { return !!app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
  }
  return false;
}

function createLogin({ app, platform = process.platform, env = process.env, fs = nodeFs, execPath = process.execPath, homedir = os.homedir(), log = () => {} }) {
  const caps = { login: false, portable: false, loginNote: undefined };

  let autostartFile = null;
  if (!app.isPackaged) {
    caps.loginNote = 'Only available in the installed app.';
  } else if (platform === 'win32') {
    caps.login = true;
    caps.portable = !fs.existsSync(nodePath.join(nodePath.dirname(execPath), 'Uninstall Charm Line.exe'));
    if (caps.portable) caps.loginNote = PORTABLE_NOTE;
  } else if (platform === 'darwin') {
    let inApps = false;
    try { inApps = app.isInApplicationsFolder(); } catch { inApps = false; }
    caps.login = inApps;
    if (!inApps) caps.loginNote = 'Move Charm Line to your Applications folder to use this.';
  } else if (platform === 'linux') {
    const img = env.APPIMAGE;
    // Refuse paths that would need desktop-entry escaping; keeps Exec= trivially safe.
    if (img && nodePath.isAbsolute(img) && !/["`$\\\n\r%]/.test(img)) {
      caps.login = true;
      const cfg = env.XDG_CONFIG_HOME && nodePath.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : nodePath.join(homedir, '.config');
      autostartFile = nodePath.join(cfg, 'autostart', 'charm-line.desktop');
    }
  }

  function winState() {
    const s = app.getLoginItemSettings({ path: execPath, args: [...LOGIN_ARGS] });
    // false when the Run value exists but was disabled in Task Manager > Startup apps.
    return !!s.executableWillLaunchAtLogin;
  }

  /** Current OS state. */
  function get() {
    if (!caps.login) return false;
    try {
      if (platform === 'win32') return winState();
      if (platform === 'darwin') return !!app.getLoginItemSettings().openAtLogin;
      if (platform === 'linux') return fs.existsSync(autostartFile);
    } catch (e) { log('login get failed', e); }
    return false;
  }

  /** Enable/disable; returns resulting OS state. keepDisabled: rewrite the Windows value but leave it off in Task Manager. */
  function set(on, { keepDisabled = false } = {}) {
    if (!caps.login) return false;
    try {
      if (platform === 'win32') {
        const o = { openAtLogin: !!on, path: execPath, args: [...LOGIN_ARGS] };
        if (on && keepDisabled) o.enabled = false;
        app.setLoginItemSettings(o);
      }
      else if (platform === 'darwin') app.setLoginItemSettings({ openAtLogin: !!on });
      else if (platform === 'linux') {
        if (on) {
          fs.mkdirSync(nodePath.dirname(autostartFile), { recursive: true });
          fs.writeFileSync(autostartFile, [
            '[Desktop Entry]', 'Type=Application', 'Name=Charm Line', `Exec="${env.APPIMAGE}" ${HIDDEN_ARG}`,
            'X-GNOME-Autostart-enabled=true', 'NoDisplay=false', 'Terminal=false', ''
          ].join('\n'));
        } else if (fs.existsSync(autostartFile)) fs.unlinkSync(autostartFile);
      }
    } catch (e) { log('login set failed', e); }
    return get();
  }

  /**
   * Called once at startup with the user's saved intent. Migrates the v1.0 Run value, re-saves the
   * path for portable Windows builds (the folder may have moved). Returns the effective state.
   */
  function init(intent) {
    if (!caps.login) return false;
    if (platform === 'win32') {
      try {
        const s = app.getLoginItemSettings({ path: execPath });
        const items = s.launchItems || [];
        const legacy = items.find((i) => i.name === LEGACY_RUN_NAME);
        if (legacy) {
          app.setLoginItemSettings({ openAtLogin: false, path: execPath, name: LEGACY_RUN_NAME });
          if (legacy.enabled !== false) return set(true);
        }
        // v1.1 value (same name, this exe, no --hidden): rewrite it with the argument, same enabled state.
        // Another copy's value (different path) is left alone; portable builds re-save below.
        const mine = (i) => typeof i.path === 'string' && i.path.toLowerCase() === String(execPath).toLowerCase();
        const old = items.find((i) => i.name === APP_ID && mine(i) && !(Array.isArray(i.args) && i.args.includes(HIDDEN_ARG)));
        if (old) return set(true, { keepDisabled: old.enabled === false });
      } catch (e) { log('login migrate failed', e); }
      if (caps.portable && intent) return set(true);
    }
    return get();
  }

  return { caps, get, set, init };
}

module.exports = { createLogin, isHiddenLaunch, APP_ID, LEGACY_RUN_NAME, PORTABLE_NOTE, HIDDEN_ARG, LOGIN_ARGS };
