'use strict';
// Validates Studio -> overlay line commands (studio.line.cmd(op, args)) before main relays them.
// Pure: no Electron imports, runs under `node --test`. The overlay validates again against the
// charm library (known types, teams, cap designs...), so here we check shape, types and limits.
const V = require('./validate');

const LIMITS = Object.freeze({
  jerseyName: 12, numberMin: 0, numberMax: 99, lenMin: 40, lenMax: 2000,
  sizeMin: 0.6, sizeMax: 1.6, importName: 60, dataUrlBytes: 15 * 1024 * 1024
});
const OPS = Object.freeze(['add', 'addImage', 'remove', 'update', 'highlight', 'style', 'nudge', 'clear', 'import', 'forgetImage']);
const ROPES = ['thread', 'chain', 'neon'];
const ID_RE = /^[a-z0-9]{1,32}$/;          // charm types, teams, styles, cap designs / finishes
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;    // imported image keys ("img1712345678901")
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DATA_URL_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
const CTRL_G = /[\u0000-\u001f\u007f-\u009f]/g;

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const fail = (error) => ({ ok: false, error });
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const cut = (s, max) => Array.from(s.replace(CTRL_G, ' ').trim()).slice(0, max).join('').trim();

/** Charm opts subset. `img` allows `cap`. Returns {ok, opts} or an error. '' / null for capDesign/capStyle = "Same as Style". */
function cleanOpts(o, { img = false } = {}) {
  if (o === undefined) return { ok: true, opts: {} };
  if (!isObj(o)) return fail('Bad charm options.');
  const out = {};
  if (has(o, 'name')) { if (typeof o.name !== 'string') return fail('Name must be text.'); out.name = cut(o.name, LIMITS.jerseyName); }
  if (has(o, 'number')) {
    if (!Number.isInteger(o.number) || o.number < LIMITS.numberMin || o.number > LIMITS.numberMax) return fail('Number must be 0 to 99.');
    out.number = o.number;
  }
  if (has(o, 'team')) { if (o.team !== '' && !(typeof o.team === 'string' && ID_RE.test(o.team))) return fail('Unknown kit.'); out.team = o.team; }
  if (has(o, 'style')) { if (!(typeof o.style === 'string' && ID_RE.test(o.style))) return fail('Unknown pattern.'); out.style = o.style; }
  for (const k of ['c1', 'c2', 'c3']) {
    if (has(o, k)) { if (!(typeof o[k] === 'string' && COLOR_RE.test(o[k]))) return fail('Colours must look like #rrggbb.'); out[k] = o[k].toLowerCase(); }
  }
  for (const k of ['capDesign', 'capStyle']) {
    if (!has(o, k)) continue;
    if (o[k] === '' || o[k] === null) out[k] = '';
    else if (typeof o[k] === 'string' && ID_RE.test(o[k])) out[k] = o[k];
    else return fail('Unknown cap.');
  }
  if (has(o, 'cap')) {
    if (!img) return fail('Only images have a bead cap switch.');
    if (typeof o.cap !== 'boolean') return fail('Bead cap must be on or off.');
    out.cap = o.cap;
  }
  return { ok: true, opts: out };
}

const needCid = (a) => (V.isCid(a.cid) ? null : 'Unknown charm.');
const needKey = (a) => (typeof a.key === 'string' && KEY_RE.test(a.key) ? null : 'Unknown image.');

/**
 * Validate one command. Returns { ok: true, op, args } with a clean copy of args (unknown keys
 * dropped), or { ok: false, error }.
 */
function validateLineCmd(op, args) {
  if (typeof op !== 'string' || !OPS.includes(op)) return fail('Unknown command.');
  if (args === undefined || args === null) args = {};
  if (!isObj(args)) return fail('Bad command arguments.');
  const ok = (a) => ({ ok: true, op, args: a });
  let e;
  switch (op) {
    case 'add': {
      if (!(typeof args.type === 'string' && ID_RE.test(args.type)) || args.type === 'img') return fail('Unknown charm.');
      const o = cleanOpts(args.opts); if (!o.ok) return o;
      return ok({ type: args.type, opts: o.opts });
    }
    case 'addImage': case 'forgetImage':
      if ((e = needKey(args))) return fail(e);
      return ok({ key: args.key });
    case 'remove': case 'highlight':
      if ((e = needCid(args))) return fail(e);
      return ok({ cid: args.cid });
    case 'update': {
      if ((e = needCid(args))) return fail(e);
      const out = { cid: args.cid };
      if (has(args, 'len')) {
        if (!num(args.len) || args.len < LIMITS.lenMin || args.len > LIMITS.lenMax) return fail('Rope length is out of range.');
        out.len = args.len;
      }
      if (has(args, 'opts')) { const o = cleanOpts(args.opts, { img: true }); if (!o.ok) return o; out.opts = o.opts; }
      return ok(out);
    }
    case 'style': {
      const out = {};
      if (has(args, 'rope')) { if (!ROPES.includes(args.rope)) return fail('Unknown rope.'); out.rope = args.rope; }
      if (has(args, 'size')) {
        if (!num(args.size) || args.size < LIMITS.sizeMin || args.size > LIMITS.sizeMax) return fail('Size must be 0.6 to 1.6.');
        out.size = args.size;
      }
      for (const k of ['sound', 'wind']) if (has(args, k)) { if (typeof args[k] !== 'boolean') return fail(`${k} must be on or off.`); out[k] = args[k]; }
      for (const k of ['cap', 'capDesign']) if (has(args, k)) { if (!(typeof args[k] === 'string' && ID_RE.test(args[k]))) return fail('Unknown cap.'); out[k] = args[k]; }
      return ok(out);
    }
    case 'nudge': case 'clear':
      return ok({});
    case 'import': {
      if (typeof args.name !== 'string') return fail('Image name must be text.');
      if (typeof args.dataUrl !== 'string') return fail('No image data.');
      if (args.dataUrl.length > LIMITS.dataUrlBytes) return fail('That image is over 15 MB. Use a smaller one.');
      if (!DATA_URL_RE.test(args.dataUrl)) return fail('Use a PNG, JPEG, WebP or SVG image.');
      return ok({ name: cut(args.name, LIMITS.importName) || 'Your image', dataUrl: args.dataUrl });
    }
  }
  return fail('Unknown command.');
}

module.exports = { validateLineCmd, cleanOpts, OPS, LIMITS };
