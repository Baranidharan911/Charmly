'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRelay, NOT_RESPONDING } = require('../src/linerelay');

test('requests wait for the overlay to be ready, then go out in order', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [];
  const r = createRelay({ send: (m) => { sent.push(m); return true; } });
  assert.equal(r.ready, false);
  const a = r.request('add', { type: 'nazar' });
  const b = r.request('nudge', {});
  assert.equal(sent.length, 0);
  t.mock.timers.tick(3000);
  r.setReady(true);
  assert.deepEqual(sent.map((m) => m.op), ['add', 'nudge']);
  r.reply(sent[0].id, { ok: true, cid: 'c' });
  assert.deepEqual(await a, { ok: true, cid: 'c' });
  t.mock.timers.tick(2000); // 5 s since the request, not since it was sent
  assert.equal((await b).error, NOT_RESPONDING);
  // never ready -> timeout
  const r2 = createRelay({ send: () => true });
  const c = r2.request('x', {});
  t.mock.timers.tick(5000);
  assert.equal((await c).error, NOT_RESPONDING);
});

test('replies are matched by id', async () => {
  const sent = [];
  const r = createRelay({ send: (m) => { sent.push(m); return true; }, ready: true });
  const a = r.request('add', { type: 'nazar' });
  const b = r.request('nudge', {});
  assert.deepEqual(sent.map((m) => m.op), ['add', 'nudge']);
  assert.notEqual(sent[0].id, sent[1].id);
  assert.equal(r.reply(sent[1].id, { ok: true }), true);
  assert.equal(r.reply(sent[0].id, { ok: true, cid: 'x' }), true);
  assert.deepEqual(await a, { ok: true, cid: 'x' });
  assert.deepEqual(await b, { ok: true });
  assert.equal(r.reply(sent[0].id, { ok: true }), false); // late duplicate ignored
  assert.equal(r.size, 0);
});

test('times out after 5 s with "Charms are not responding"', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = createRelay({ send: () => true, ready: true });
  const p = r.request('nudge', {});
  t.mock.timers.tick(4999);
  assert.equal(r.size, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(await p, { ok: false, error: NOT_RESPONDING });
  assert.equal(NOT_RESPONDING, 'Charms are not responding');
});

test('unreachable overlay fails at once; failAll answers everything', async () => {
  const down = createRelay({ send: () => false, ready: true });
  assert.deepEqual(await down.request('nudge', {}), { ok: false, error: NOT_RESPONDING });
  const thrower = createRelay({ send: () => { throw new Error('gone'); }, ready: true });
  assert.equal((await thrower.request('nudge', {})).ok, false);
  const r = createRelay({ send: () => true, ready: true });
  const ps = [r.request('a', {}), r.request('b', {})];
  r.failAll();
  for (const p of ps) assert.equal((await p).error, NOT_RESPONDING);
  // after a reload (failAll) new requests wait for the next ready instead of going to a dead page
  const sent = [];
  const q = createRelay({ send: (m) => { sent.push(m); return true; }, ready: true });
  q.failAll();
  const w = q.request('nudge', {});
  assert.equal(sent.length, 0);
  q.setReady(true);
  q.reply(sent[0].id, { ok: true });
  assert.deepEqual(await w, { ok: true });
});

test('malformed replies become errors; pending is capped', async () => {
  const sent = [];
  const r = createRelay({ send: (m) => { sent.push(m); return true; }, maxPending: 2, ready: true });
  const a = r.request('x', {});
  r.reply(sent[0].id, 'nope');
  assert.equal((await a).ok, false);
  r.request('y', {}); r.request('z', {});
  assert.match((await r.request('w', {})).error, /Too many/);
  r.failAll();
});
