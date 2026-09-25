'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isFullscreenApp } = require('../src/platform-win');

test('D3D fullscreen and presentation mode always count', () => {
  assert.equal(isFullscreenApp(3, null), true);
  assert.equal(isFullscreenApp(4, null), true);
});

test('BUSY only counts when the foreground window covers its monitor', () => {
  // A topmost transparent overlay (e.g. another Charm Line) makes Windows report BUSY
  // while an ordinary maximized window is in front: must not hide.
  assert.equal(isFullscreenApp(2, { covers: false, cls: 'Chrome_WidgetWin_1' }), false);
  assert.equal(isFullscreenApp(2, null), false);
  assert.equal(isFullscreenApp(2, { covers: true, cls: 'UnityWndClass' }), true);
  // The desktop covers the monitor but is not a fullscreen app.
  assert.equal(isFullscreenApp(2, { covers: true, cls: 'Progman' }), false);
  assert.equal(isFullscreenApp(2, { covers: true, cls: 'WorkerW' }), false);
});

test('other states never count', () => {
  for (const s of [0, 1, 5, 6, 7]) assert.equal(isFullscreenApp(s, { covers: true, cls: 'X' }), false);
});
