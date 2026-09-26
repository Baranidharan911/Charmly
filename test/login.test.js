'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createLogin, isHiddenLaunch, APP_ID, LEGACY_RUN_NAME } = require('../src/login');

const EXE = 'C:\\Program Files\\Charm Line\\Charm Line.exe';

// Fake Electron app with a Windows Run key: { name -> { path, args, enabled } }.
function fakeApp(run = {}) {
  const calls = [];
  return {
    calls, run, isPackaged: true,
    getLoginItemSettings(o = {}) {
      const launchItems = Object.entries(run).map(([name, v]) => ({ name, path: v.path, args: v.args, scope: 'user', enabled: v.enabled !== false }));
      const mine = run[APP_ID];
      const same = mine && JSON.stringify(mine.args || []) === JSON.stringify(o.args || []);
      return { openAtLogin: !!same, executableWillLaunchAtLogin: !!(same && mine.enabled !== false), launchItems };
    },
    setLoginItemSettings(o) {
      calls.push(o);
      const name = o.name || APP_ID;
      if (o.openAtLogin) run[name] = { path: o.path, args: o.args || [], enabled: o.enabled !== false };
      else delete run[name];
    }
  };
}
const fsWith = (files = []) => ({ existsSync: (p) => files.includes(p) });
const installed = fsWith([path.join(path.dirname(EXE), 'Uninstall Charm Line.exe')]);

test('isHiddenLaunch: --hidden, macOS login launch, normal start', () => {
  assert.equal(isHiddenLaunch(['Charm Line.exe', '--hidden'], { platform: 'win32' }), true);
  assert.equal(isHiddenLaunch(['Charm Line.exe'], { platform: 'win32' }), false);
  assert.equal(isHiddenLaunch(['electron', '.', '--user-data-dir=x'], { platform: 'linux' }), false);
  assert.equal(isHiddenLaunch([], { platform: 'darwin', app: { getLoginItemSettings: () => ({ wasOpenedAtLogin: true }) } }), true);
  assert.equal(isHiddenLaunch([], { platform: 'darwin', app: { getLoginItemSettings: () => { throw new Error('x'); } } }), false);
  assert.equal(isHiddenLaunch(null, { platform: 'win32' }), false);
});

test('Windows: enabling writes the Run value with --hidden and reads it back', () => {
  const app = fakeApp();
  const l = createLogin({ app, platform: 'win32', fs: installed, execPath: EXE });
  assert.equal(l.caps.login, true);
  assert.equal(l.caps.portable, false);
  assert.equal(l.set(true), true);
  assert.deepEqual(app.calls.at(-1), { openAtLogin: true, path: EXE, args: ['--hidden'] });
  assert.equal(l.get(), true);
  assert.equal(l.set(false), false);
  assert.equal(app.run[APP_ID], undefined);
});

test('Windows: a v1.1 Run value (no --hidden) is rewritten with it', () => {
  const app = fakeApp({ [APP_ID]: { path: EXE, args: [] } });
  const l = createLogin({ app, platform: 'win32', fs: installed, execPath: EXE });
  assert.equal(l.init(true), true);
  assert.deepEqual(app.run[APP_ID].args, ['--hidden']);
  assert.equal(app.run[APP_ID].enabled, true);
});

test('Windows: a v1.1 value disabled in Task Manager stays disabled', () => {
  const app = fakeApp({ [APP_ID]: { path: EXE, args: [], enabled: false } });
  const l = createLogin({ app, platform: 'win32', fs: installed, execPath: EXE });
  assert.equal(l.init(true), false);
  assert.deepEqual(app.calls.at(-1), { openAtLogin: true, path: EXE, args: ['--hidden'], enabled: false });
  assert.deepEqual(app.run[APP_ID].args, ['--hidden']);
});

test('Windows: the v1.0 value is migrated to the new name with --hidden', () => {
  const app = fakeApp({ [LEGACY_RUN_NAME]: { path: EXE, args: [] } });
  const l = createLogin({ app, platform: 'win32', fs: installed, execPath: EXE });
  assert.equal(l.init(false), true);
  assert.equal(app.run[LEGACY_RUN_NAME], undefined);
  assert.deepEqual(app.run[APP_ID].args, ['--hidden']);
});

test('Windows: an up-to-date value is left alone; portable re-saves the path', () => {
  const app = fakeApp({ [APP_ID]: { path: EXE, args: ['--hidden'] } });
  const l = createLogin({ app, platform: 'win32', fs: installed, execPath: EXE });
  assert.equal(l.init(true), true);
  assert.equal(app.calls.length, 0);
  const papp = fakeApp({ [APP_ID]: { path: 'D:\\old\\Charm Line.exe', args: ['--hidden'] } });
  const p = createLogin({ app: papp, platform: 'win32', fs: fsWith(), execPath: EXE });
  assert.equal(p.caps.portable, true);
  p.init(true);
  assert.deepEqual(papp.calls.at(-1), { openAtLogin: true, path: EXE, args: ['--hidden'] });
});

test('Linux: autostart entry passes --hidden', () => {
  const files = {};
  const fs = {
    existsSync: (p) => p in files, mkdirSync: () => {}, writeFileSync: (p, s) => { files[p] = s; }, unlinkSync: (p) => { delete files[p]; }
  };
  const l = createLogin({ app: { isPackaged: true }, platform: 'linux', env: { APPIMAGE: '/opt/Charm.AppImage' }, fs, homedir: '/home/u' });
  assert.equal(l.set(true), true);
  const entry = Object.values(files)[0];
  assert.match(entry, /^Exec="\/opt\/Charm\.AppImage" --hidden$/m);
});
