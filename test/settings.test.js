'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, validateData, defaults } = require('../src/settings');

const CID = '3f2a9b1c-1111-4222-8333-444455556666';
const AID = 'aaaaaaaa-1111-4222-8333-444455556666';

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'charmline-test-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('missing file -> defaults', (t) => {
  const dir = tmpDir(t);
  const s = createStore({ file: path.join(dir, 'settings.json'), platform: 'win32' });
  assert.equal(s.load().source, 'defaults');
  assert.deepEqual(s.data, defaults());
  assert.equal(s.data.shortcuts.toggle, 'CommandOrControl+Alt+Shift+C');
  assert.equal(s.data.shortcuts.panel, 'CommandOrControl+Alt+Shift+H');
  assert.equal(s.data.autoHideFullscreen, true);
  assert.equal(s.data.hideFromCapture, true);
});

test('save is atomic, keeps .bak, and round-trips', (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'settings.json');
  const s = createStore({ file, platform: 'win32' });
  s.load();
  assert.equal(s.update((d) => { d.firstRunDone = true; }).ok, true);
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.existsSync(file + '.tmp'), false);
  assert.equal(s.update((d) => { d.visibility = 'desktop'; }).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).visibility, 'top');
  const s2 = createStore({ file, platform: 'win32' });
  assert.equal(s2.load().source, 'file');
  assert.equal(s2.data.firstRunDone, true);
  assert.equal(s2.data.visibility, 'desktop');
});

test('corrupt file -> renamed, recovered from .bak', (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'settings.json');
  const s = createStore({ file, platform: 'win32', now: () => 12345 });
  s.load();
  s.update((d) => { d.firstRunDone = true; });
  s.update((d) => { d.hideFromCapture = false; }); // .bak now has firstRunDone:true, hideFromCapture:true
  fs.writeFileSync(file, '{"v":1, oops');
  const s2 = createStore({ file, platform: 'win32', now: () => 12345 });
  const r = s2.load();
  assert.equal(r.source, 'bak');
  assert.equal(r.corruptFile, path.join(dir, 'settings.corrupt-12345.json'));
  assert.equal(fs.readFileSync(r.corruptFile, 'utf8'), '{"v":1, oops');
  assert.equal(s2.data.firstRunDone, true);
  assert.equal(s2.data.hideFromCapture, true);
  // The recovered data was written back as the main file.
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).firstRunDone, true);
});

test('corrupt file and corrupt .bak -> defaults', (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, 'not json');
  fs.writeFileSync(file + '.bak', '[1,2,3]');
  const s = createStore({ file, platform: 'win32', now: () => 1 });
  const r = s.load();
  assert.equal(r.source, 'defaults');
  assert.ok(r.corruptFile);
  assert.deepEqual(s.data, defaults());
});

test('oversized file is treated as corrupt', (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, pad: 'x'.repeat(70 * 1024) }));
  const s = createStore({ file, platform: 'win32', now: () => 2 });
  const r = s.load();
  assert.ok(r.corruptFile);
  assert.equal(r.source, 'defaults');
});

test('validateData cleans every field', () => {
  const d = validateData({
    v: 99,
    shortcuts: { toggle: 'Ctrl+C', panel: 'shift+ctrl+alt+p' },
    visibility: 'everywhere', autoHideFullscreen: 'yes', hideFromCapture: false, openAtLogin: 1, firstRunDone: true,
    actions: {
      [AID]: { kind: 'url', target: 'https://example.com', label: 'x'.repeat(80), confirmedHash: 'zz' },
      'bbbbbbbb-1111-4222-8333-444455556666': { kind: 'url', target: 'javascript:alert(1)', label: 'bad' },
      'cccccccc-1111-4222-8333-444455556666': { kind: 'app', target: '\\\\evil\\share\\x.exe', label: 'unc' },
      'dddddddd-1111-4222-8333-444455556666': { kind: 'file', target: 'C:\\x\\run.bat', label: 'script' },
      'eeeeeeee-1111-4222-8333-444455556666': { kind: 'copy', target: 'y'.repeat(501) },
      'ffffffff-1111-4222-8333-444455556666': { kind: 'toggle', target: 'whatever' },
      'orphaned-1111-4222-8333-444455556666': { kind: 'toggle' }
    },
    bindings: {
      [CID]: { pull: AID, long: 'bbbbbbbb-1111-4222-8333-444455556666' },
      'charm-two-1234': { pull: 'cccccccc-1111-4222-8333-444455556666', long: 'dddddddd-1111-4222-8333-444455556666' },
      'charm-three-123': { pull: 'eeeeeeee-1111-4222-8333-444455556666', long: 'ffffffff-1111-4222-8333-444455556666' },
      'bad id!': { pull: AID },
      'charm-dup-12345': { pull: AID },
      'charm-missing-1': { pull: 'nonexist-1111-4222-8333-444455556666' },
      __proto__: { pull: AID }
    }
  }, 'win32');
  assert.equal(d.v, 1);
  assert.equal(d.shortcuts.toggle, 'CommandOrControl+Alt+Shift+C'); // invalid -> default
  assert.equal(d.shortcuts.panel, 'Control+Alt+Shift+P');
  assert.equal(d.visibility, 'top');
  assert.equal(d.autoHideFullscreen, true);
  assert.equal(d.hideFromCapture, false);
  assert.equal(d.openAtLogin, false);
  assert.equal(d.firstRunDone, true);
  assert.deepEqual(Object.keys(d.bindings).sort(), [CID, 'charm-three-123'].sort());
  assert.deepEqual(d.bindings[CID], { pull: AID });
  assert.equal(d.actions[AID].label.length, 40);
  assert.equal(d.actions[AID].confirmedHash, undefined);
  assert.deepEqual(d.bindings['charm-three-123'], { long: 'ffffffff-1111-4222-8333-444455556666' });
  assert.equal(d.actions['ffffffff-1111-4222-8333-444455556666'].target, '');
  assert.equal(d.actions['orphaned-1111-4222-8333-444455556666'], undefined);
  assert.equal(Object.keys(d.actions).length, 2);
});

test('validateData caps actions at 50', () => {
  const actions = {}, bindings = {};
  for (let i = 0; i < 60; i++) {
    const id = `act-${String(i).padStart(8, '0')}`, cid = `cid-${String(i).padStart(8, '0')}`;
    actions[id] = { kind: 'toggle' }; bindings[cid] = { pull: id };
  }
  const d = validateData({ actions, bindings }, 'win32');
  assert.equal(Object.keys(d.actions).length, 50);
  assert.equal(Object.keys(d.bindings).length, 50);
});

test('update refuses to write more than 64 KB', (t) => {
  const dir = tmpDir(t);
  const s = createStore({ file: path.join(dir, 'settings.json'), platform: 'win32' });
  s.load();
  const r = s.update((d) => {
    for (let i = 0; i < 50; i++) {
      const id = `act-${String(i).padStart(8, '0')}`;
      d.actions[id] = { kind: 'url', target: 'https://example.com/' + 'a'.repeat(2000), label: 'x' };
      d.bindings[`cid-${String(i).padStart(8, '0')}`] = { pull: id };
    }
  });
  assert.equal(r.ok, false);
  assert.deepEqual(s.data.actions, {});
});

test('duplicate shortcuts fall back to defaults', () => {
  const d = validateData({ shortcuts: { toggle: 'Ctrl+Alt+K', panel: 'Ctrl+Alt+K' } });
  assert.equal(d.shortcuts.toggle, 'CommandOrControl+Alt+Shift+C');
  assert.equal(d.shortcuts.panel, 'CommandOrControl+Alt+Shift+H');
  assert.equal(validateData({ shortcuts: { toggle: '', panel: '' } }).shortcuts.toggle, '');
});
