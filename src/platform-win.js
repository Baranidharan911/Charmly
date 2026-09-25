'use strict';
// Win32 helpers via koffi. load() returns null (and every feature degrades) if koffi is missing or fails.
// HWNDs are handled as BigInt so they compare reliably with Electron's getNativeWindowHandle().

const HWND_TOP = 0, HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
const FLAGS = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
// SHQueryUserNotificationState: 2 BUSY (fullscreen app), 3 RUNNING_D3D_FULL_SCREEN, 4 PRESENTATION_MODE.
const FULLSCREEN_STATES = new Set([2, 3, 4]);
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);
const QUNS_BUSY = 2;
const MONITOR_DEFAULTTONEAREST = 2;

/**
 * 3 (D3D fullscreen) and 4 (presentation) are unambiguous. 2 (BUSY) is also reported whenever any
 * topmost window covers a monitor - transparent overlays, another copy of Charm Line - so it only
 * counts when the foreground window itself covers its monitor (and isn't the desktop).
 * fg: { covers: boolean, cls: string } | null
 */
function isFullscreenApp(state, fg) {
  if (!FULLSCREEN_STATES.has(state)) return false;
  if (state !== QUNS_BUSY) return true;
  return !!(fg && fg.covers && !DESKTOP_CLASSES.has(fg.cls));
}

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
    const RECT = koffi.struct('CL_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    const MONITORINFO = koffi.struct('CL_MONITORINFO', { cbSize: 'uint32_t', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32_t' });
    const GetWindowRect = user32.func('int __stdcall GetWindowRect(intptr_t hWnd, _Out_ CL_RECT* lpRect)');
    const IsZoomed = user32.func('int __stdcall IsZoomed(intptr_t hWnd)');
    const MonitorFromWindow = user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hWnd, uint32_t dwFlags)');
    const GetMonitorInfoW = user32.func('int __stdcall GetMonitorInfoW(intptr_t hMonitor, _Inout_ CL_MONITORINFO* lpmi)');
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
      isFullscreenState: (s) => FULLSCREEN_STATES.has(s),
      /** Does this window cover its whole monitor? (Maximized windows don't count: with an auto-hide taskbar they overhang it.) */
      coversMonitor(hwnd) {
        if (!hwnd || IsZoomed(hwnd)) return false;
        const r = {};
        if (!GetWindowRect(hwnd, r)) return false;
        const mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        const mi = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 };
        if (!mon || !GetMonitorInfoW(mon, mi)) return false;
        const m = mi.rcMonitor;
        return r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
      },
      /** A fullscreen app / game / presentation is in front (fg: foreground HWND). */
      fullscreenInFront(fg) {
        const s = api.notificationState();
        if (!FULLSCREEN_STATES.has(s)) return false;
        return isFullscreenApp(s, s === QUNS_BUSY && fg ? { covers: api.coversMonitor(fg), cls: api.className(fg) } : null);
      }
    };
    // Smoke-test once so a broken binding disables features instead of throwing later.
    api.className(api.foreground());
    api.notificationState();
    api.coversMonitor(api.foreground());
    return api;
  } catch (e) {
    log('koffi unavailable:', e && e.message);
    return null;
  }
}

module.exports = { load, hwndFromBuffer, isFullscreenApp, FULLSCREEN_STATES, DESKTOP_CLASSES };
