'use strict';
// Win32 helpers via koffi. load() returns null (and every feature degrades) if koffi is missing or fails.
// HWNDs are handled as BigInt so they compare reliably with Electron's getNativeWindowHandle().

const HWND_TOP = 0, HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
const FLAGS = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
// SHQueryUserNotificationState: 2 BUSY (fullscreen app), 3 RUNNING_D3D_FULL_SCREEN, 4 PRESENTATION_MODE.
const FULLSCREEN_STATES = new Set([2, 3, 4]);
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);

/** Electron's getNativeWindowHandle() Buffer -> BigInt HWND. */
function hwndFromBuffer(buf) {
  if (!buf || !buf.length) return 0n;
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

function load({ requireKoffi = () => require('koffi'), log = () => {} } = {}) {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = requireKoffi();
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
    const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr_t hWnd, _Out_ uint16_t* lpClassName, int nMaxCount)');
    const SetWindowPos = user32.func('int __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)');
    const SHQueryUserNotificationState = shell32.func('int32_t __stdcall SHQueryUserNotificationState(_Out_ int32_t* pquns)');
    const buf = Buffer.alloc(512);

    const api = {
      foreground: () => BigInt(GetForegroundWindow() || 0),
      className(hwnd) {
        if (!hwnd) return '';
        const n = GetClassNameW(hwnd, buf, 256);
        return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
      },
      isDesktopClass: (cls) => DESKTOP_CLASSES.has(cls),
      toBottom: (hwnd) => !!SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, FLAGS),
      toTop: (hwnd) => !!SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, FLAGS),
      /** Returns the QUNS state number, or 0 on failure. */
      notificationState() {
        const out = [0];
        return SHQueryUserNotificationState(out) === 0 ? out[0] : 0;
      },
      isFullscreenState: (s) => FULLSCREEN_STATES.has(s)
    };
    // Smoke-test once so a broken binding disables features instead of throwing later.
    api.className(api.foreground());
    api.notificationState();
    return api;
  } catch (e) {
    log('koffi unavailable:', e && e.message);
    return null;
  }
}

module.exports = { load, hwndFromBuffer, FULLSCREEN_STATES, DESKTOP_CLASSES };
