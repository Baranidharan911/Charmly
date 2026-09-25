'use strict';
/**
 * Two-rule rate limiter: at most one hit per `minGapMs`, and at most `max` hits per `windowMs`.
 * take() returns true when the hit is allowed (and records it).
 */
function createRateLimiter({ minGapMs = 800, windowMs = 30000, max = 5, now = Date.now } = {}) {
  let hits = [];
  return {
    take() {
      const t = now();
      hits = hits.filter((h) => t - h < windowMs);
      const last = hits[hits.length - 1];
      if (last !== undefined && t - last < minGapMs) return false;
      if (hits.length >= max) return false;
      hits.push(t);
      return true;
    },
    reset() { hits = []; }
  };
}

module.exports = { createRateLimiter };
