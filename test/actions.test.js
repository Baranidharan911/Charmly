'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/settings');
const { createActions } = require('../src/actions');
const { createRateLimiter } = require('../src/ratelimit');

const CID = '3f2a9b1c-1111-4222-8333-444455556666';

function setup(t, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charmline-act-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore({ file: path.join(dir, 'settings.json'), platform: 'win32' });
  store.load();
  const calls = { external: [], openPath: [], clip: [], toggle: 0, confirm: 0 };
  let now = 0, n = 0;
  const files = { 'C:\\Apps\\Spotify.exe': 'file', 'C:\\Music': 'dir', 'C:\\x\\run.bat': 'file' };
  const deps = {
    store, platform: 'win32',
    shell: { openExternal: async (u) => { calls.external.push(u); }, openPath: async (p) => { calls.openPath.push(p); return ''; } },
    clipboard: { writeText: (s) => calls.clip.push(s) },
    dialog: {
      showOpenDialog: async () => over.pickResult || { canceled: false, filePaths: ['C:\\Apps\\Spotify.exe'] },
      showMessageBox: async (o) => { calls.confirm++; calls.lastMessage = o.message; return { response: over.decline ? 1 : 0 }; }
    },
    stat: (p) => { if (!files[p]) throw new Error('ENOENT'); return { isFile: () => files[p] === 'file', isDirectory: () => files[p] === 'dir' }; },
    getIcon: async () => 'data:image/png;base64,AAAA',
    onToggle: () => { calls.toggle++; },
    limiter: createRateLimiter({ now: () => now }),
    randomId: () => `id-${String(++n).padStart(8, '0')}`
  };
  const a = createActions(deps);
  return { a, store, calls, tick: (ms) => { now += ms; } };
}

test('setUrl / list / trigger with one-time confirmation', async (t) => {
  const { a, store, calls, tick } = setup(t);
  const r = await a.setUrl(CID, 'pull', 'https://open.spotify.com/track/1');
  assert.deepEqual(r, { ok: true, info: { kind: 'url', label: 'open.spotify.com' } });
  const l = await a.list();
  assert.deepEqual(l, { [CID]: { pull: { kind: 'url', label: 'open.spotify.com' } } });
  assert.equal(JSON.stringify(l).includes('track'), false, 'target never leaves main');
  assert.equal((await a.trigger(CID, 'pull')).ok, true);
  assert.equal(calls.confirm, 1);
  assert.match(calls.lastMessage, /^Open open\.spotify\.com\?$/);
  tick(1000);
  assert.equal((await a.trigger(CID, 'pull')).ok, true);
  assert.equal(calls.confirm, 1, 'confirmed once');
  assert.deepEqual(calls.external, ['https://open.spotify.com/track/1', 'https://open.spotify.com/track/1']);
  // Editing resets the confirmation.
  await a.setUrl(CID, 'pull', 'https://open.spotify.com/track/1', 'Spotify');
  tick(1000);
  await a.trigger(CID, 'pull');
  assert.equal(calls.confirm, 2);
  assert.equal(Object.keys(store.data.actions).length, 1, 'old action dropped');
});

test('declined confirmation does not run', async (t) => {
  const { a, calls } = setup(t, { decline: true });
  await a.setUrl(CID, 'pull', 'https://example.com');
  assert.deepEqual(await a.test(CID, 'pull'), { ok: false, error: 'Canceled', declined: true });
  assert.equal(calls.external.length, 0);
});

test('rate limit: 1 per 800 ms, 5 per 30 s', async (t) => {
  const { a, tick } = setup(t);
  await a.setCopy(CID, 'pull', 'hello');
  assert.equal((await a.trigger(CID, 'pull')).ok, true);
  assert.deepEqual(await a.trigger(CID, 'pull'), { ok: false, error: 'Slow down' });
  for (let i = 0; i < 4; i++) { tick(800); assert.equal((await a.trigger(CID, 'pull')).ok, true); }
  tick(800);
  assert.deepEqual(await a.trigger(CID, 'pull'), { ok: false, error: 'Slow down' });
});

test('setUrl rejects bad schemes and args', async (t) => {
  const { a, store } = setup(t);
  assert.equal((await a.setUrl(CID, 'pull', 'javascript:alert(1)')).ok, false);
  assert.equal((await a.setUrl(CID, 'pull', 'file:///C:/Windows/notepad.exe')).ok, false);
  assert.equal((await a.setUrl('bad', 'pull', 'https://x.com')).ok, false);
  assert.equal((await a.setUrl(CID, 'side', 'https://x.com')).ok, false);
  assert.equal((await a.setUrl(CID, '__proto__', 'https://x.com')).ok, false);
  assert.deepEqual(store.data.actions, {});
});

test('pick app, cancel, script refusal, folder', async (t) => {
  const { a, calls, tick } = setup(t);
  const r = await a.pick(CID, 'pull', 'app');
  assert.deepEqual(r, { ok: true, info: { kind: 'app', label: 'Spotify', icon: 'data:image/png;base64,AAAA' } });
  await a.trigger(CID, 'pull');
  assert.deepEqual(calls.openPath, ['C:\\Apps\\Spotify.exe']);
  assert.equal(calls.lastMessage, 'Open Spotify?');

  const c = setup(t, { pickResult: { canceled: true, filePaths: [] } });
  assert.deepEqual(await c.a.pick(CID, 'long', 'file'), { ok: false, error: 'Canceled', canceled: true });

  const s = setup(t, { pickResult: { canceled: false, filePaths: ['C:\\x\\run.bat'] } });
  const sr = await s.a.pick(CID, 'pull', 'file');
  assert.equal(sr.ok, false);
  assert.match(sr.error, /script/);

  const f = setup(t, { pickResult: { canceled: false, filePaths: ['C:\\Music'] } });
  assert.equal((await f.a.pick(CID, 'pull', 'folder')).info.label, 'Music');
  assert.equal((await f.a.pick(CID, 'pull', 'file')).ok, false, 'dir is not a file');
  assert.equal((await a.pick(CID, 'pull', 'url')).ok, false);
  tick(1);
});

test('copy, toggle, clear, forget', async (t) => {
  const { a, store, calls, tick } = setup(t);
  assert.equal((await a.setCopy(CID, 'pull', 'x'.repeat(501))).ok, false);
  assert.equal((await a.setCopy(CID, 'pull', '   ')).ok, false);
  assert.equal((await a.setCopy(CID, 'pull', 'line1\nline2', 'My text')).info.label, 'My text');
  assert.equal((await a.setToggle(CID, 'long')).info.label, 'Hide charms');
  await a.trigger(CID, 'pull'); tick(1000);
  await a.trigger(CID, 'long');
  assert.deepEqual(calls.clip, ['line1\nline2']);
  assert.equal(calls.toggle, 1);
  assert.equal(calls.confirm, 0, 'copy/toggle need no confirmation');
  await a.clear(CID, 'pull');
  assert.deepEqual(Object.keys((await a.list())[CID]), ['long']);
  await a.forget(CID);
  assert.deepEqual(await a.list(), {});
  assert.deepEqual(store.data.actions, {});
  assert.equal((await a.trigger(CID, 'pull')).ok, false);
});
