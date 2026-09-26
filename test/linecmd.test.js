'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLineCmd, OPS, LIMITS } = require('../src/linecmd');

const CID = '3f2a9b1c-1111-4222-8333-444455556666';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ok = (op, args) => { const r = validateLineCmd(op, args); assert.equal(r.ok, true, JSON.stringify(r)); return r.args; };
const no = (op, args) => { const r = validateLineCmd(op, args); assert.equal(r.ok, false, `${op} ${JSON.stringify(args)} should fail`); assert.equal(typeof r.error, 'string'); return r.error; };

test('op whitelist', () => {
  assert.deepEqual([...OPS].sort(), ['add', 'addImage', 'clear', 'forgetImage', 'highlight', 'import', 'nudge', 'remove', 'style', 'update'].sort());
  for (const op of ['getState', 'eval', '__proto__', 'constructor', '', 'ADD', null, 1, undefined]) no(op, {});
  no('nudge', 'x'); no('nudge', [1]); no('nudge', 5);
  assert.deepEqual(ok('nudge'), {});
  assert.deepEqual(ok('clear', null), {});
});

test('unknown keys are dropped', () => {
  assert.deepEqual(ok('nudge', { evil: 1 }), {});
  assert.deepEqual(ok('remove', { cid: CID, x: 1 }), { cid: CID });
  assert.deepEqual(ok('add', { type: 'nazar', opts: { foo: 1 } }), { type: 'nazar', opts: {} });
});

test('add', () => {
  assert.deepEqual(ok('add', { type: 'kitpendant', opts: { name: '  Messi  ', number: 10, team: 'argentina' } }),
    { type: 'kitpendant', opts: { name: 'Messi', number: 10, team: 'argentina' } });
  assert.equal(ok('add', { type: 'jersey', opts: { name: 'ABCDEFGHIJKLMNOP' } }).opts.name, 'ABCDEFGHIJKL');
  assert.deepEqual(ok('add', { type: 'nazar', opts: { capDesign: '', capStyle: null } }).opts, { capDesign: '', capStyle: '' });
  no('add', {}); no('add', { type: 'img' }); no('add', { type: '../x' }); no('add', { type: 'Nazar' }); no('add', { type: 1 });
  no('add', { type: 'nazar', opts: 'x' });
  no('add', { type: 'nazar', opts: { cap: false } }); // cap switch is for images (update only)
});

test('update: len, opts ranges', () => {
  assert.deepEqual(ok('update', { cid: CID, len: 200 }), { cid: CID, len: 200 });
  assert.deepEqual(ok('update', { cid: CID, opts: { cap: false, c1: '#ABCDEF' } }), { cid: CID, opts: { cap: false, c1: '#abcdef' } });
  no('update', { cid: 'short', len: 100 });
  no('update', { cid: CID, len: LIMITS.lenMin - 1 });
  no('update', { cid: CID, len: LIMITS.lenMax + 1 });
  for (const len of [NaN, Infinity, '100', null]) no('update', { cid: CID, len });
  for (const number of [-1, 100, 1.5, '7']) no('update', { cid: CID, opts: { number } });
  for (const c1 of ['red', '#fff', '#12345g', 'url(x)']) no('update', { cid: CID, opts: { c1 } });
  no('update', { cid: CID, opts: { team: 'Bad Team' } });
  no('update', { cid: CID, opts: { style: 1 } });
  no('update', { cid: CID, opts: { cap: 'yes' } });
  no('update', { cid: CID, opts: { name: 5 } });
  no('update', { cid: CID, opts: { capDesign: '<b>' } });
  assert.equal(ok('update', { cid: CID, opts: { name: 'a\u0000b' } }).opts.name, 'a b');
});

test('remove / highlight need a cid; addImage / forgetImage need a key', () => {
  ok('remove', { cid: CID }); ok('highlight', { cid: CID });
  no('remove', {}); no('highlight', { cid: 'a b c d e f g h' });
  assert.deepEqual(ok('addImage', { key: 'img1712345678901' }), { key: 'img1712345678901' });
  ok('forgetImage', { key: 'img1712345678901-2' });
  no('addImage', { key: '' }); no('forgetImage', { key: '../../x' }); no('addImage', { key: 'x'.repeat(65) });
});

test('style', () => {
  assert.deepEqual(ok('style', { rope: 'neon', size: 1.2, sound: false, wind: true, cap: 'rose', capDesign: 'beads' }),
    { rope: 'neon', size: 1.2, sound: false, wind: true, cap: 'rose', capDesign: 'beads' });
  assert.deepEqual(ok('style', {}), {});
  no('style', { rope: 'rope' }); no('style', { size: 0.5 }); no('style', { size: 1.7 }); no('style', { size: '1' });
  no('style', { sound: 1 }); no('style', { wind: 'true' }); no('style', { cap: '' }); no('style', { capDesign: 'A B' });
});

test('import: mime, size, name', () => {
  assert.deepEqual(ok('import', { name: 'Photo.png', dataUrl: PNG }), { name: 'Photo.png', dataUrl: PNG });
  for (const m of ['jpeg', 'webp', 'svg+xml']) ok('import', { name: 'x', dataUrl: `data:image/${m};base64,AAAA` });
  assert.equal(ok('import', { name: '   ', dataUrl: PNG }).name, 'Your image');
  assert.equal(Array.from(ok('import', { name: 'n'.repeat(200), dataUrl: PNG }).name).length, LIMITS.importName);
  for (const dataUrl of ['data:image/gif;base64,AAAA', 'data:text/html;base64,AAAA', 'data:image/png,<svg>', 'https://x/y.png',
    'data:image/svg+xml;utf8,<svg onload=alert(1)>', 'data:image/png;base64,AA"AA', 5]) no('import', { name: 'x', dataUrl });
  no('import', { name: 1, dataUrl: PNG });
  const big = 'data:image/png;base64,' + 'A'.repeat(LIMITS.dataUrlBytes);
  assert.match(no('import', { name: 'x', dataUrl: big }), /15 MB/);
});
