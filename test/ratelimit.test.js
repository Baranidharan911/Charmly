'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../src/ratelimit');

test('1 per 800 ms and 5 per 30 s', () => {
  let t = 0;
  const rl = createRateLimiter({ now: () => t });
  assert.equal(rl.take(), true);
  t = 500; assert.equal(rl.take(), false, 'inside 800 ms');
  t = 800; assert.equal(rl.take(), true);
  t = 1600; assert.equal(rl.take(), true);
  t = 2400; assert.equal(rl.take(), true);
  t = 3200; assert.equal(rl.take(), true); // 5th
  t = 4000; assert.equal(rl.take(), false, '6th inside 30 s');
  t = 29999; assert.equal(rl.take(), false);
  t = 30000; assert.equal(rl.take(), true, 'first hit aged out');
  t = 30100; assert.equal(rl.take(), false);
});

test('rejected hits do not extend the window', () => {
  let t = 0;
  const rl = createRateLimiter({ now: () => t });
  rl.take();
  for (t = 100; t < 800; t += 100) assert.equal(rl.take(), false);
  t = 800; assert.equal(rl.take(), true);
});
