'use strict';
// Global shortcut registration with per-shortcut error reporting. globalShortcut is injected.
const { validateAccelerator } = require('./validate');

const NAMES = { toggle: 'show/hide charms', panel: 'open the panel' };

function createShortcuts({ globalShortcut, handlers, log = () => {} }) {
  let registered = {}; // name -> accelerator

  /** Register `shortcuts` ({toggle, panel}); returns shortcutErrors ({toggle?, panel?}). */
  function apply(shortcuts) {
    for (const acc of Object.values(registered)) { try { globalShortcut.unregister(acc); } catch { /* ignore */ } }
    registered = {};
    const errors = {};
    for (const name of ['toggle', 'panel']) {
      const acc = shortcuts[name];
      if (!acc) continue;
      const v = validateAccelerator(acc);
      if (!v.ok) { errors[name] = v.error; continue; }
      if (Object.values(registered).includes(v.value)) { errors[name] = `Already used to ${NAMES.toggle}.`; continue; }
      let ok = false;
      try { ok = globalShortcut.register(v.value, handlers[name]); } catch (e) { log('register threw', v.value, e.message); ok = false; }
      if (ok) registered[name] = v.value;
      else errors[name] = 'Another app is already using this shortcut. Pick a different one.';
    }
    return errors;
  }

  function unregisterAll() {
    for (const acc of Object.values(registered)) { try { globalShortcut.unregister(acc); } catch { /* ignore */ } }
    registered = {};
  }

  return { apply, unregisterAll, get registered() { return { ...registered }; } };
}

module.exports = { createShortcuts };
