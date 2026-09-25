'use strict';
// Pure validators shared by the main process. No Electron imports, so they run under `node --test`.
const path = require('path');
const crypto = require('crypto');

const LIMITS = Object.freeze({ fileBytes: 64 * 1024, actions: 50, label: 40, copyText: 500, url: 2048, path: 4096 });

const CID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const SLOTS = ['pull', 'long'];
const KINDS = ['url', 'app', 'file', 'folder', 'copy', 'toggle'];
const PICK_KINDS = ['app', 'file', 'folder'];
const URL_SCHEMES = ['http:', 'https:', 'mailto:'];
const SCRIPT_EXTS = new Set(['.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msi',
  '.scr', '.hta', '.reg', '.sh', '.command', '.com', '.pif', '.cpl']);
// C0/C1 control characters, including NUL. Never allowed in targets or labels.
const CTRL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const CTRL_RE_G = /[\u0000-\u001f\u007f-\u009f]/g;

const isCid = (v) => typeof v === 'string' && CID_RE.test(v);
const isSlot = (v) => SLOTS.includes(v);
const isKind = (v) => KINDS.includes(v);
const isPickKind = (v) => PICK_KINDS.includes(v);

const fail = (error) => ({ ok: false, error });

/** Trim and cut to `max` code points; strips control chars. Returns '' for non-strings. */
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return Array.from(v.replace(CTRL_RE_G, ' ').trim()).slice(0, max).join('').trim();
}
const cleanLabel = (v) => cleanText(v, LIMITS.label);

/** Validate a website/mailto URL. Returns {ok, url} with the normalized href. */
function validateUrl(input) {
  if (typeof input !== 'string') return fail('Enter a web address.');
  const s = input.trim();
  if (!s) return fail('Enter a web address.');
  if (s.length > LIMITS.url) return fail('That address is too long.');
  if (CTRL_RE.test(s)) return fail("That address isn't valid.");
  let u;
  try { u = new URL(s); } catch {
    // Friendly: allow "example.com" without a scheme.
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(s)) {
      try { u = new URL('https://' + s); } catch { return fail("That address isn't valid."); }
    } else return fail("That address isn't valid.");
  }
  if (!URL_SCHEMES.includes(u.protocol)) return fail('Only http, https and mailto links can be opened.');
  if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname) return fail("That address isn't valid.");
  if (u.protocol === 'mailto:' && !u.pathname) return fail("That address isn't valid.");
  if (u.username || u.password) return fail("Addresses with a user name or password aren't allowed.");
  const href = u.href;
  if (href.length > LIMITS.url || CTRL_RE.test(href)) return fail("That address isn't valid.");
  return { ok: true, url: href };
}

/** Human label for a validated URL. */
function urlLabel(href) {
  try {
    const u = new URL(href);
    if (u.protocol === 'mailto:') return cleanLabel(decodeURIComponent(u.pathname)) || 'Email';
    return cleanLabel(u.hostname.replace(/^www\./i, '')) || 'Website';
  } catch { return 'Website'; }
}

/** Extension check that survives Windows' trailing dot/space stripping ("x.bat. ", "x.BAT"). */
function isScriptPath(p) {
  if (typeof p !== 'string') return false;
  const stripped = p.replace(/[. ]+$/, '');
  return SCRIPT_EXTS.has(path.extname(stripped).toLowerCase());
}

/**
 * Validate a picked path's shape (not existence). platform decides absolute-path rules.
 * Refuses UNC/device paths (\\server\share, \\?\, //x), NUL/control chars, relative paths, scripts.
 */
function validatePathShape(p, platform = process.platform) {
  if (typeof p !== 'string' || !p) return fail('No file chosen.');
  if (p.length > LIMITS.path) return fail('That path is too long.');
  if (CTRL_RE.test(p)) return fail("That path isn't valid.");
  if (platform === 'win32') {
    if (/^[\\/]{2}/.test(p)) return fail("Network and device paths can't be used.");
    if (!/^[a-zA-Z]:[\\/]/.test(p)) return fail('Choose a file on this computer.');
    // Alternate data streams ("C:\x.txt:evil.exe") and other stray colons.
    if (p.indexOf(':', 2) !== -1) return fail("That path isn't valid.");
  } else {
    if (!path.posix.isAbsolute(p)) return fail('Choose a file on this computer.');
    if (p.startsWith('//')) return fail("Network and device paths can't be used.");
  }
  if (isScriptPath(p)) return fail("Charm Line can't open script or installer files.");
  return { ok: true, path: p };
}

/**
 * Full path check including existence and type. `stat` is injected (fs.statSync-like).
 * app: a file (or a .app bundle dir on macOS); file: a file; folder: a directory.
 */
function validatePickedPath(p, kind, { platform = process.platform, stat } = {}) {
  const shape = validatePathShape(p, platform);
  if (!shape.ok) return shape;
  let st;
  try { st = stat(p); } catch { return fail("That file doesn't exist any more."); }
  const isDir = st.isDirectory(), isFile = st.isFile();
  if (kind === 'folder') { if (!isDir) return fail('Choose a folder.'); }
  else if (kind === 'app' && platform === 'darwin' && /\.app\/?$/i.test(p)) { if (!isDir) return fail('Choose an app.'); }
  else if (!isFile) return fail(kind === 'app' ? 'Choose an app.' : 'Choose a file.');
  return shape;
}

/** Label for a path target: basename without extension for apps/files' executables. */
function pathLabel(p, kind, platform = process.platform) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  let base = P.basename(p.replace(/[\\/]+$/, '')) || p;
  if (kind === 'app') base = base.replace(/\.(exe|lnk|app|appimage|desktop)$/i, '');
  return cleanLabel(base) || (kind === 'folder' ? 'Folder' : kind === 'app' ? 'App' : 'File');
}

const hashTarget = (kind, target) => crypto.createHash('sha256').update(String(kind) + '\u0000' + String(target)).digest('hex');

// ---------- Accelerators ----------
const MODIFIERS = {
  commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl',
  command: 'Command', cmd: 'Command', control: 'Control', ctrl: 'Control',
  alt: 'Alt', option: 'Alt', altgr: 'AltGr', shift: 'Shift', super: 'Super', meta: 'Super'
};
const MOD_ORDER = ['CommandOrControl', 'Command', 'Control', 'Alt', 'AltGr', 'Shift', 'Super'];
const NAMED_KEYS = ['Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left',
  'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc', 'Del', 'PrintScreen',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv'];
const NAMED_MAP = Object.fromEntries(NAMED_KEYS.map((k) => [k.toLowerCase(), k]));
const ALIASES = { Esc: 'Escape', Enter: 'Return', Del: 'Delete' };
const PUNCT = ')!@#$%^&*(:;<=>?-_[]{}\\|\'",./`~';

function normKey(k) {
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
  const f = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(k);
  if (f) return 'F' + f[1];
  if (k.length === 1 && PUNCT.includes(k)) return k;
  const n = NAMED_MAP[k.toLowerCase()];
  return n ? (ALIASES[n] || n) : null;
}

// Canonical-form combos we never take (OS-level or near-universal app shortcuts).
const RESERVED = new Set([
  'Control+Alt+Delete', 'CommandOrControl+Alt+Delete', 'Control+Shift+Escape', 'CommandOrControl+Shift+Escape',
  'Control+Alt+Escape', 'Command+Alt+Escape', 'CommandOrControl+Alt+Escape',
  'Shift+Super+S', 'Command+Shift+3', 'Command+Shift+4', 'Command+Shift+5',
  'CommandOrControl+Shift+3', 'CommandOrControl+Shift+4', 'CommandOrControl+Shift+5',
  'Control+Alt+Tab', 'CommandOrControl+Alt+Tab', 'Control+Shift+Tab', 'CommandOrControl+Shift+Tab',
  'Control+Command+Q', 'Command+Control+Q', 'CommandOrControl+Shift+Q', 'Control+Alt+T'
]);

/**
 * Validate an Electron accelerator for a global shortcut.
 * '' means "no shortcut". Needs >= 2 modifiers, or 1 modifier + F-key. Returns {ok, value} (canonical) or {ok:false,error}.
 */
function validateAccelerator(input) {
  if (input === '' || input === null || input === undefined) return { ok: true, value: '' };
  if (typeof input !== 'string' || input.length > 100 || CTRL_RE.test(input)) return fail("That isn't a valid shortcut.");
  // "Plus" is the key name for '+', so a bare '+' token splits into empties.
  const parts = input.trim().split('+').map((s) => s.trim());
  if (parts.some((s) => !s)) return fail("That isn't a valid shortcut.");
  const mods = [];
  let key = null;
  for (let i = 0; i < parts.length; i++) {
    const m = MODIFIERS[parts[i].toLowerCase()];
    if (m) {
      if (key) return fail('Put the key last, after Ctrl/Alt/Shift.');
      if (mods.includes(m)) return fail("That isn't a valid shortcut.");
      mods.push(m);
      continue;
    }
    if (key) return fail('Use only one key plus modifiers.');
    key = normKey(parts[i]);
    if (!key) return fail("That key can't be used for a shortcut.");
  }
  if (!key) return fail('Add a key after the modifiers.');
  // CommandOrControl already covers Control/Command on the relevant platform.
  if (mods.includes('CommandOrControl') && (mods.includes('Control') || mods.includes('Command'))) return fail("That isn't a valid shortcut.");
  const isF = /^F\d+$/.test(key);
  if (!(mods.length >= 2 || (mods.length === 1 && isF))) return fail('Use at least two of Ctrl, Alt, Shift (or one with an F-key).');
  mods.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  const value = [...mods, key].join('+');
  if (RESERVED.has(value)) return fail('That shortcut is reserved by the system.');
  return { ok: true, value };
}

module.exports = {
  LIMITS, SCRIPT_EXTS, URL_SCHEMES,
  isCid, isSlot, isKind, isPickKind, cleanText, cleanLabel,
  validateUrl, urlLabel, isScriptPath, validatePathShape, validatePickedPath, pathLabel,
  hashTarget, validateAccelerator
};
