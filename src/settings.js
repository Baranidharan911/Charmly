'use strict';
// userData/settings.json: load / validate / atomic save with .bak and corrupt-file recovery.
// No Electron imports: the file path and fs are injected so this runs under `node --test`.
const nodeFs = require('fs');
const path = require('path');
const V = require('./validate');

const DEFAULT_SHORTCUTS = Object.freeze({ toggle: 'CommandOrControl+Alt+Shift+C', panel: 'CommandOrControl+Alt+Shift+H' });
const ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function defaults() {
  return {
    v: 1,
    shortcuts: { ...DEFAULT_SHORTCUTS },
    visibility: 'top',
    autoHideFullscreen: true,
    hideFromCapture: true,
    openAtLogin: false,
    firstRunDone: false,
    actions: {},
    bindings: {}
  };
}

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

/** Copy text keeps newlines/tabs but no other control chars. */
function cleanCopyText(t) {
  if (typeof t !== 'string') return null;
  const s = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
  if (!s.trim() || Array.from(s).length > V.LIMITS.copyText) return null;
  return s;
}

/** Validate one stored action record; returns a clean copy or null. */
function validateAction(a, platform) {
  if (!isObj(a) || !V.isKind(a.kind)) return null;
  let target;
  switch (a.kind) {
    case 'url': { const r = V.validateUrl(a.target); if (!r.ok) return null; target = r.url; break; }
    case 'app': case 'file': case 'folder': {
      const r = V.validatePathShape(a.target, platform); if (!r.ok) return null; target = r.path; break;
    }
    case 'copy': target = cleanCopyText(a.target); if (target === null) return null; break;
    case 'toggle': target = ''; break;
  }
  const out = { kind: a.kind, target, label: V.cleanLabel(a.label) || defaultLabel(a.kind, target, platform) };
  if (typeof a.confirmedHash === 'string' && HASH_RE.test(a.confirmedHash)) out.confirmedHash = a.confirmedHash;
  return out;
}

function defaultLabel(kind, target, platform) {
  switch (kind) {
    case 'url': return V.urlLabel(target);
    case 'app': case 'file': case 'folder': return V.pathLabel(target, kind, platform);
    case 'copy': return V.cleanLabel(target) || 'Text';
    case 'toggle': return 'Hide charms';
  }
  return 'Action';
}

/** Validate a whole settings object. Never throws; bad fields fall back to defaults. */
function validateData(raw, platform = process.platform) {
  const d = defaults();
  if (!isObj(raw)) return d;
  if (isObj(raw.shortcuts)) {
    for (const k of ['toggle', 'panel']) {
      if (k in raw.shortcuts) { const r = V.validateAccelerator(raw.shortcuts[k]); if (r.ok) d.shortcuts[k] = r.value; }
    }
    if (d.shortcuts.toggle && d.shortcuts.toggle === d.shortcuts.panel) d.shortcuts = { ...DEFAULT_SHORTCUTS };
  }
  if (raw.visibility === 'top' || raw.visibility === 'desktop') d.visibility = raw.visibility;
  d.autoHideFullscreen = bool(raw.autoHideFullscreen, d.autoHideFullscreen);
  d.hideFromCapture = bool(raw.hideFromCapture, d.hideFromCapture);
  d.openAtLogin = bool(raw.openAtLogin, d.openAtLogin);
  d.firstRunDone = bool(raw.firstRunDone, d.firstRunDone);

  // Bindings reference actions; each action is used by exactly one slot. Drop dangling / unused / excess.
  const actions = isObj(raw.actions) ? raw.actions : {};
  const bindings = isObj(raw.bindings) ? raw.bindings : {};
  const used = new Set();
  let count = 0;
  for (const cid of Object.keys(bindings)) {
    if (!V.isCid(cid) || !isObj(bindings[cid])) continue;
    const b = {};
    for (const slot of ['pull', 'long']) {
      const id = bindings[cid][slot];
      if (typeof id !== 'string' || !ID_RE.test(id) || used.has(id) || !Object.prototype.hasOwnProperty.call(actions, id)) continue;
      if (count >= V.LIMITS.actions) continue;
      const a = validateAction(actions[id], platform);
      if (!a) continue;
      d.actions[id] = a; b[slot] = id; used.add(id); count++;
    }
    if (b.pull || b.long) d.bindings[cid] = b;
  }
  return d;
}

function createStore({ file, fs = nodeFs, platform = process.platform, now = Date.now, log = () => {} }) {
  const bak = file + '.bak';
  const tmp = file + '.tmp';
  let data = defaults();

  function readJson(p) {
    const st = fs.statSync(p);
    if (st.size > V.LIMITS.fileBytes) throw new Error('settings file too large');
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!isObj(obj)) throw new Error('settings is not an object');
    return obj;
  }

  function writeAtomic(json) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(file)) { try { fs.copyFileSync(file, bak); } catch (e) { log('bak copy failed', e); } }
    fs.renameSync(tmp, file);
  }

  const serialize = (d) => JSON.stringify(d, null, 1);

  /** Load settings. Returns { source: 'file'|'bak'|'defaults', corruptFile?: string }. */
  function load() {
    const res = { source: 'defaults' };
    if (fs.existsSync(file)) {
      try { data = validateData(readJson(file), platform); res.source = 'file'; return res; } catch (e) {
        log('settings corrupt', e.message);
        const bad = path.join(path.dirname(file), `settings.corrupt-${now()}.json`);
        try { fs.renameSync(file, bad); res.corruptFile = bad; } catch (e2) { log('rename corrupt failed', e2); }
      }
    }
    if (fs.existsSync(bak)) {
      try { data = validateData(readJson(bak), platform); res.source = 'bak'; } catch (e) { log('bak corrupt', e.message); data = defaults(); }
    } else data = defaults();
    if (res.source !== 'defaults' || res.corruptFile) { try { writeAtomic(serialize(data)); } catch (e) { log('save after recovery failed', e); } }
    return res;
  }

  /**
   * Apply a mutation to a copy; validate; refuse if it would exceed the size limit.
   * Returns { ok: true } or { ok: false, error }.
   */
  function update(mutator) {
    const draft = JSON.parse(JSON.stringify(data));
    mutator(draft);
    const clean = validateData(draft, platform);
    const json = serialize(clean);
    if (Buffer.byteLength(json) > V.LIMITS.fileBytes) return { ok: false, error: 'Too much saved. Remove some charm actions first.' };
    try { writeAtomic(json); } catch (e) { log('save failed', e); data = clean; return { ok: false, error: "Couldn't save settings." }; }
    data = clean;
    return { ok: true };
  }

  return { load, update, get data() { return data; }, file, bak };
}

module.exports = { createStore, validateData, validateAction, defaults, DEFAULT_SHORTCUTS, cleanCopyText, defaultLabel };
