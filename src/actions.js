'use strict';
// Pull actions: bind a charm slot to an action, and run it. Electron bits are injected.
// Targets (paths / URLs / text) never leave this module except as `label`.
const crypto = require('crypto');
const nodeFs = require('fs');
const V = require('./validate');
const { cleanCopyText, defaultLabel } = require('./settings');
const { createRateLimiter } = require('./ratelimit');

const CONFIRM_KINDS = new Set(['url', 'app', 'file', 'folder']);
const fail = (error, extra) => ({ ok: false, error, ...extra });

function createActions({
  store, platform = process.platform, shell, dialog, clipboard, getWin = () => null,
  stat = nodeFs.statSync, getIcon = async () => null, onToggle = () => {},
  limiter = createRateLimiter(), randomId = () => crypto.randomUUID(), log = () => {}
}) {
  const iconCache = new Map(); // actionId -> data URL | null

  const actionFor = (cid, slot) => {
    const b = store.data.bindings[cid];
    const id = b && b[slot];
    return id ? { id, a: store.data.actions[id] } : null;
  };

  async function iconFor(id, a) {
    if (!['app', 'file', 'folder'].includes(a.kind)) return undefined;
    if (!iconCache.has(id)) {
      let url = null;
      try { url = await getIcon(a.target); } catch { url = null; }
      iconCache.set(id, typeof url === 'string' && url.startsWith('data:image/') ? url : null);
    }
    return iconCache.get(id) || undefined;
  }

  async function info(id, a) {
    const out = { kind: a.kind, label: a.label };
    const icon = await iconFor(id, a);
    if (icon) out.icon = icon;
    return out;
  }

  const badArgs = (cid, slot) => (!V.isCid(cid) ? 'Unknown charm.' : !V.isSlot(slot) ? 'Unknown slot.' : null);

  /** Replace the action in (cid, slot) with a new record. */
  async function bind(cid, slot, record) {
    const current = actionFor(cid, slot);
    const total = Object.keys(store.data.actions).length - (current ? 1 : 0);
    if (total >= V.LIMITS.actions) return fail(`You can save up to ${V.LIMITS.actions} charm actions.`);
    const id = randomId();
    const r = store.update((d) => {
      if (current) delete d.actions[current.id];
      d.actions[id] = record;
      d.bindings[cid] = { ...(d.bindings[cid] || {}), [slot]: id };
    });
    if (!r.ok) return r;
    if (current) iconCache.delete(current.id);
    const saved = store.data.actions[id];
    if (!saved) return fail("Couldn't save that action.");
    return { ok: true, info: await info(id, saved) };
  }

  async function list() {
    const out = {};
    for (const [cid, b] of Object.entries(store.data.bindings)) {
      const e = {};
      for (const slot of ['pull', 'long']) if (b[slot] && store.data.actions[b[slot]]) e[slot] = await info(b[slot], store.data.actions[b[slot]]);
      if (e.pull || e.long) out[cid] = e;
    }
    return out;
  }

  async function setUrl(cid, slot, url, label) {
    const bad = badArgs(cid, slot); if (bad) return fail(bad);
    const r = V.validateUrl(url); if (!r.ok) return r;
    return bind(cid, slot, { kind: 'url', target: r.url, label: V.cleanLabel(label) || V.urlLabel(r.url) });
  }

  async function setCopy(cid, slot, text, label) {
    const bad = badArgs(cid, slot); if (bad) return fail(bad);
    if (typeof text === 'string' && Array.from(text).length > V.LIMITS.copyText) return fail(`Keep it under ${V.LIMITS.copyText} characters.`);
    const t = cleanCopyText(text); if (t === null) return fail('Enter some text to copy.');
    return bind(cid, slot, { kind: 'copy', target: t, label: V.cleanLabel(label) || defaultLabel('copy', t, platform) });
  }

  async function setToggle(cid, slot) {
    const bad = badArgs(cid, slot); if (bad) return fail(bad);
    return bind(cid, slot, { kind: 'toggle', target: '', label: 'Hide charms' });
  }

  function pickOptions(kind) {
    if (kind === 'folder') return { title: 'Choose a folder', properties: ['openDirectory'] };
    if (kind === 'app') {
      if (platform === 'win32') return { title: 'Choose an app', properties: ['openFile'], filters: [{ name: 'Apps', extensions: ['exe', 'lnk'] }] };
      if (platform === 'darwin') return { title: 'Choose an app', defaultPath: '/Applications', properties: ['openFile'], filters: [{ name: 'Apps', extensions: ['app'] }] };
      return { title: 'Choose an app', properties: ['openFile'] };
    }
    return { title: 'Choose a file', properties: ['openFile'] };
  }

  async function pick(cid, slot, kind) {
    const bad = badArgs(cid, slot); if (bad) return fail(bad);
    if (!V.isPickKind(kind)) return fail('Unknown kind.');
    const win = getWin();
    let res;
    try { res = win ? await dialog.showOpenDialog(win, pickOptions(kind)) : await dialog.showOpenDialog(pickOptions(kind)); } catch (e) {
      log('picker failed', e); return fail("Couldn't open the file picker.");
    }
    if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) return fail('Canceled', { canceled: true });
    const p = res.filePaths[0];
    const v = V.validatePickedPath(p, kind, { platform, stat });
    if (!v.ok) return v;
    return bind(cid, slot, { kind, target: v.path, label: V.pathLabel(v.path, kind, platform) });
  }

  async function clear(cid, slot) {
    const bad = badArgs(cid, slot); if (bad) return fail(bad);
    const current = actionFor(cid, slot);
    if (!current) return { ok: true };
    const r = store.update((d) => {
      delete d.actions[current.id];
      const b = { ...d.bindings[cid] }; delete b[slot];
      if (b.pull || b.long) d.bindings[cid] = b; else delete d.bindings[cid];
    });
    iconCache.delete(current.id);
    return r.ok ? { ok: true } : r;
  }

  async function forget(cid) {
    if (!V.isCid(cid)) return fail('Unknown charm.');
    const b = store.data.bindings[cid];
    if (!b) return { ok: true };
    const r = store.update((d) => {
      for (const slot of ['pull', 'long']) if (b[slot]) { delete d.actions[b[slot]]; iconCache.delete(b[slot]); }
      delete d.bindings[cid];
    });
    return r.ok ? { ok: true } : r;
  }

  let confirming = false; // one confirmation dialog at a time: repeat pulls while it's open do nothing

  async function confirm(id, a) {
    const hash = V.hashTarget(a.kind, a.target);
    if (a.confirmedHash === hash) return true;
    if (confirming) return null;
    const verb = a.kind === 'url' ? (a.target.startsWith('mailto:') ? 'Write an email to' : 'Open') : 'Open';
    const opts = {
      type: 'question', buttons: ['Open', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
      title: 'Charm Line', message: `${verb} ${a.label}?`,
      detail: `This charm will open:\n${a.target}\n\nYou'll only be asked once.`
    };
    const win = getWin();
    let res;
    confirming = true;
    try { res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts); } catch (e) { log('confirm failed', e); return false; } finally { confirming = false; }
    if (!res || res.response !== 0) return false;
    store.update((d) => { if (d.actions[id]) d.actions[id].confirmedHash = hash; });
    return true;
  }

  async function execute(a) {
    switch (a.kind) {
      case 'url': {
        const r = V.validateUrl(a.target); if (!r.ok) return r;
        await shell.openExternal(r.url);
        return { ok: true };
      }
      case 'app': case 'file': case 'folder': {
        const v = V.validatePickedPath(a.target, a.kind, { platform, stat });
        if (!v.ok) return v;
        const err = await shell.openPath(v.path);
        return err ? fail(err) : { ok: true };
      }
      case 'copy': clipboard.writeText(a.target); return { ok: true };
      case 'toggle': onToggle(); return { ok: true };
    }
    return fail('Unknown action.');
  }

  async function run(cid, slot) {
    const bad = badArgs(cid, slot); if (bad) return fail(bad);
    const cur = actionFor(cid, slot);
    if (!cur || !cur.a) return fail('Nothing to do for this charm.');
    if (!limiter.take()) return fail('Slow down');
    if (CONFIRM_KINDS.has(cur.a.kind)) {
      const ok = await confirm(cur.id, cur.a);
      if (ok === null) return fail('Canceled', { canceled: true });
      if (!ok) return fail('Canceled', { declined: true });
    }
    try {
      const r = await execute(store.data.actions[cur.id] || cur.a);
      return r.ok ? { ok: true, info: await info(cur.id, cur.a) } : r;
    } catch (e) {
      log('action failed', e);
      return fail("Couldn't open that.");
    }
  }

  return { list, setUrl, setCopy, setToggle, pick, clear, forget, trigger: run, test: run };
}

module.exports = { createActions };
