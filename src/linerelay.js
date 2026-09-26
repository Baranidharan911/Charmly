'use strict';
// Request/response correlation for Studio -> overlay line commands. Pure (send + timers injected).
// request() always resolves: with the overlay's reply, or NOT_RESPONDING after `timeoutMs`
// (or at once when the overlay can't be reached). Until the overlay says it is ready (its first
// LineState push), requests wait here, still under the same timeout.
const NOT_RESPONDING = 'Charms are not responding';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

function createRelay({ send, timeoutMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout, maxPending = 64, ready = false }) {
  const pending = new Map(); // id -> { resolve, timer, msg, sent }
  let nextId = 1, isReady = !!ready;
  const down = () => ({ ok: false, error: NOT_RESPONDING });

  function finish(id, result) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimer(p.timer);
    p.resolve(result);
    return true;
  }

  function transmit(id) {
    const p = pending.get(id);
    if (!p || p.sent) return;
    p.sent = true;
    let ok = false;
    try { ok = send(p.msg) !== false; } catch { ok = false; }
    if (!ok) finish(id, down());
  }

  /** send(msg) must return true when the message was handed to the overlay. */
  function request(op, args) {
    if (pending.size >= maxPending) return Promise.resolve({ ok: false, error: 'Too many requests. Try again.' });
    const id = nextId++;
    if (nextId > Number.MAX_SAFE_INTEGER) nextId = 1;
    return new Promise((resolve) => {
      const timer = setTimer(() => finish(id, down()), timeoutMs);
      pending.set(id, { resolve, timer, msg: { id, op, args }, sent: false });
      if (isReady) transmit(id);
    });
  }

  /** The overlay answered request `id`. Unknown / late ids are ignored. Returns true if matched. */
  function reply(id, result) {
    return finish(id, isObj(result) && typeof result.ok === 'boolean' ? result : { ok: false, error: 'Something went wrong.' });
  }

  /** Overlay is (or is no longer) able to take commands. Going ready sends everything waiting. */
  function setReady(v) {
    isReady = !!v;
    if (isReady) for (const id of [...pending.keys()]) transmit(id);
  }

  /** Overlay went away (reload / crash): answer what it had been sent; the rest waits for it to be ready again. */
  function failAll() {
    isReady = false;
    for (const [id, p] of [...pending]) if (p.sent) finish(id, down());
  }

  return { request, reply, setReady, failAll, get size() { return pending.size; }, get ready() { return isReady; } };
}

module.exports = { createRelay, NOT_RESPONDING };
