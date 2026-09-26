'use strict';
// Request/response correlation for Studio -> overlay line commands. Pure (send + timers injected).
// request() always resolves: with the overlay's reply, or NOT_RESPONDING after `timeoutMs`
// (or at once when the overlay can't be reached).
const NOT_RESPONDING = 'Charms are not responding';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

function createRelay({ send, timeoutMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout, maxPending = 64 }) {
  const pending = new Map(); // id -> { resolve, timer }
  let nextId = 1;
  const down = () => ({ ok: false, error: NOT_RESPONDING });

  /** send(msg) must return true when the message was handed to the overlay. */
  function request(op, args) {
    if (pending.size >= maxPending) return Promise.resolve({ ok: false, error: 'Too many requests. Try again.' });
    const id = nextId++;
    if (nextId > Number.MAX_SAFE_INTEGER) nextId = 1;
    return new Promise((resolve) => {
      const timer = setTimer(() => { pending.delete(id); resolve(down()); }, timeoutMs);
      pending.set(id, { resolve, timer });
      let ok = false;
      try { ok = send({ id, op, args }) !== false; } catch { ok = false; }
      if (!ok) { clearTimer(timer); pending.delete(id); resolve(down()); }
    });
  }

  /** The overlay answered request `id`. Unknown / late ids are ignored. Returns true if matched. */
  function reply(id, result) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimer(p.timer);
    p.resolve(isObj(result) && typeof result.ok === 'boolean' ? result : { ok: false, error: 'Something went wrong.' });
    return true;
  }

  /** Overlay went away: answer everything now. */
  function failAll() {
    for (const [id, p] of pending) { clearTimer(p.timer); pending.delete(id); p.resolve(down()); }
  }

  return { request, reply, failAll, get size() { return pending.size; } };
}

module.exports = { createRelay, NOT_RESPONDING };
