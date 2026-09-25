'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/validate');

test('validateUrl accepts http/https/mailto and normalizes', () => {
  assert.equal(V.validateUrl('https://example.com').url, 'https://example.com/');
  assert.equal(V.validateUrl('  http://example.com/a?b=1#c ').url, 'http://example.com/a?b=1#c');
  assert.equal(V.validateUrl('HTTPS://Example.COM').url, 'https://example.com/');
  assert.equal(V.validateUrl('HtTpS://x.io').url, 'https://x.io/');
  assert.equal(V.validateUrl('mailto:me@example.com').url, 'mailto:me@example.com');
  assert.equal(V.validateUrl('MAILTO:me@example.com').url, 'mailto:me@example.com');
  assert.equal(V.validateUrl('open.spotify.com').url, 'https://open.spotify.com/');
});

test('validateUrl rejects dangerous or malformed input', () => {
  const bad = [
    'javascript:alert(1)', 'JavaScript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)',
    'java\tscript:alert(1)', 'java\nscript:alert(1)', 'jav&#x09;ascript:alert(1)',
    'vbscript:msgbox', 'data:text/html,<script>alert(1)</script>',
    'file:///C:/Windows/System32/calc.exe', 'FILE:///etc/passwd', 'file://server/share/x.exe',
    '\\\\server\\share\\x.exe', '//server/share', 'ms-settings:privacy', 'shell:startup',
    'search-ms:query=x', 'ftp://example.com', 'chrome://settings', 'about:blank',
    'https://exa\u0000mple.com', 'https://example.com/\u0000', 'http://', 'https://',
    'https://user:pass@example.com', '', '   ', null, undefined, 42, {},
    'https://example.com/' + 'a'.repeat(2048)
  ];
  for (const b of bad) assert.equal(V.validateUrl(b).ok, false, `should reject ${JSON.stringify(b)}`);
});

test('isScriptPath catches script/installer types incl. case and trailing-dot tricks', () => {
  for (const p of ['C:\\x\\run.bat', 'C:\\x\\RUN.BAT', 'C:\\x\\a.Cmd', 'C:\\a.ps1', 'C:\\a.vbs', 'C:\\a.vbe', 'C:\\a.js',
    'C:\\a.jse', 'C:\\a.wsf', 'C:\\a.wsh', 'C:\\a.msi', 'C:\\a.scr', 'C:\\a.hta', 'C:\\a.reg', '/home/u/a.sh',
    '/Users/u/a.command', 'C:\\a.com', 'C:\\a.pif', 'C:\\a.cpl', 'C:\\x\\run.bat.', 'C:\\x\\run.bat. . ', 'C:\\x\\run.BaT  ']) {
    assert.equal(V.isScriptPath(p), true, p);
  }
  for (const p of ['C:\\x\\Spotify.exe', 'C:\\x\\notes.txt', '/Applications/Spotify.app', 'C:\\x\\batman.png', 'C:\\x\\js']) {
    assert.equal(V.isScriptPath(p), false, p);
  }
});

test('validatePathShape (win32): absolute local only, no UNC/device/NUL/ADS', () => {
  assert.equal(V.validatePathShape('C:\\Program Files\\App\\app.exe', 'win32').ok, true);
  assert.equal(V.validatePathShape('d:/Music', 'win32').ok, true);
  const bad = ['\\\\server\\share\\app.exe', '//server/share/app.exe', '\\\\?\\C:\\app.exe', '\\\\.\\pipe\\x',
    'app.exe', '.\\app.exe', '\\app.exe', 'C:app.exe', 'C:\\a\u0000.exe', 'C:\\a\n.exe', 'C:\\x.txt:evil.exe',
    'C:\\x\\run.bat', 'C:\\x\\setup.MSI', '', null, 'C:\\' + 'a'.repeat(5000)];
  for (const b of bad) assert.equal(V.validatePathShape(b, 'win32').ok, false, JSON.stringify(b));
});

test('validatePathShape (posix)', () => {
  assert.equal(V.validatePathShape('/Applications/Spotify.app', 'darwin').ok, true);
  assert.equal(V.validatePathShape('/home/u/Music', 'linux').ok, true);
  for (const b of ['relative/x', '//server/x', '/x/\u0000y', '/home/u/run.sh', '~/x']) assert.equal(V.validatePathShape(b, 'linux').ok, false, b);
});

test('validatePickedPath checks existence and type', () => {
  const stats = { 'C:\\a.exe': 'file', 'C:\\dir': 'dir' };
  const stat = (p) => {
    if (!stats[p]) throw new Error('ENOENT');
    return { isFile: () => stats[p] === 'file', isDirectory: () => stats[p] === 'dir' };
  };
  const o = { platform: 'win32', stat };
  assert.equal(V.validatePickedPath('C:\\a.exe', 'app', o).ok, true);
  assert.equal(V.validatePickedPath('C:\\a.exe', 'file', o).ok, true);
  assert.equal(V.validatePickedPath('C:\\a.exe', 'folder', o).ok, false);
  assert.equal(V.validatePickedPath('C:\\dir', 'folder', o).ok, true);
  assert.equal(V.validatePickedPath('C:\\dir', 'file', o).ok, false);
  assert.equal(V.validatePickedPath('C:\\missing.exe', 'app', o).ok, false);
  const mac = { platform: 'darwin', stat: () => ({ isFile: () => false, isDirectory: () => true }) };
  assert.equal(V.validatePickedPath('/Applications/Spotify.app', 'app', mac).ok, true);
});

test('labels', () => {
  assert.equal(V.urlLabel('https://www.youtube.com/watch?v=1'), 'youtube.com');
  assert.equal(V.urlLabel('mailto:me@x.com'), 'me@x.com');
  assert.equal(V.pathLabel('C:\\Program Files\\Spotify\\Spotify.exe', 'app', 'win32'), 'Spotify');
  assert.equal(V.pathLabel('/Applications/Spotify.app', 'app', 'darwin'), 'Spotify');
  assert.equal(V.pathLabel('C:\\Users\\me\\Music\\', 'folder', 'win32'), 'Music');
  assert.equal(V.cleanLabel('a'.repeat(100)).length, 40);
  assert.equal(V.cleanLabel('  hi\u0000there '), 'hi there');
  assert.equal(V.cleanLabel(5), '');
});

test('validateAccelerator', () => {
  const ok = (s, v) => { const r = V.validateAccelerator(s); assert.equal(r.ok, true, `${s}: ${r.error}`); if (v) assert.equal(r.value, v); };
  const no = (s) => assert.equal(V.validateAccelerator(s).ok, false, String(s));
  ok('', '');
  ok('CommandOrControl+Alt+Shift+C', 'CommandOrControl+Alt+Shift+C');
  ok('shift+ctrl+h', 'Control+Shift+H');
  ok('CmdOrCtrl+Alt+K', 'CommandOrControl+Alt+K');
  ok('Alt+F9', 'Alt+F9');
  ok('Ctrl+F12', 'Control+F12');
  ok('Ctrl+Alt+Space', 'Control+Alt+Space');
  ok('Ctrl+Shift+Plus', 'Control+Shift+Plus');
  ok('Ctrl+Alt+/', 'Control+Alt+/');
  ok('Option+Command+P', 'Command+Alt+P');
  no('C'); no('Ctrl+C'); no('Shift+A'); no('Alt+Tab'); no('F5'); no('Ctrl+Alt');
  no('Ctrl+Alt+Delete'); no('Control+Alt+Del'); no('Ctrl+Shift+Escape'); no('Ctrl+Shift+Esc');
  no('Ctrl+Ctrl+A'); no('Ctrl+Alt+A+B'); no('A+Ctrl+Alt'); no('Ctrl+Alt+Foo'); no('Ctrl++Alt');
  no('CmdOrCtrl+Control+A'); no('Ctrl+Alt+F25'); no('Ctrl+Alt+\u0000'); no(42); no('Ctrl+Alt+' + 'x'.repeat(200));
});

test('ids and slots', () => {
  assert.equal(V.isCid('3f2a9b1c-1111-4222-8333-444455556666'), true);
  assert.equal(V.isCid('short'), false);
  assert.equal(V.isCid('a'.repeat(65)), false);
  assert.equal(V.isCid('abc def gh'), false);
  assert.equal(V.isCid('../../etc/passwd'), false);
  assert.equal(V.isSlot('pull'), true);
  assert.equal(V.isSlot('long'), true);
  assert.equal(V.isSlot('__proto__'), false);
});
