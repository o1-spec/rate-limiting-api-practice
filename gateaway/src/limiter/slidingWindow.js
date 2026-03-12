/**
 * Sliding Window Rate Limiter — Lua-backed atomic implementation
 *
 * WHY THIS EXISTS — the fixed window problem:
 *
 *   Fixed window (60s, max 5):
 *   |─── window 1 ───|─── window 2 ───|
 *                req1 req2 req3 req4 req5 | req1 req2 req3 req4 req5
 *                                  ↑ boundary
 *   10 requests in ~2 seconds across the boundary — both windows allow it.
 *   That's a burst the fixed window can't see.
 *
 * HOW SLIDING WINDOW FIXES IT:
 *
 *   Instead of a fixed bucket, keep a rolling log of timestamps.
 *   "How many requests in the last 60 seconds FROM NOW?"
 *   The window moves with every request — no boundary exploit.
 *
 * WHY LUA — the distributed race condition:
 *
 *   Without atomicity, two gateway nodes can race:
 *
 *     Gateway A: ZCARD key → 4  (under limit, hasn't written yet)
 *     Gateway B: ZCARD key → 4  (under limit, hasn't written yet)
 *     Gateway A: ZADD key  → count becomes 5  ✅ allowed
 *     Gateway B: ZADD key  → count becomes 6  ✅ allowed ← WRONG, should be blocked
 *
 *   The Lua script runs as a single atomic Redis command — no other client
 *   can execute between ZCARD and ZADD. This is how production systems
 *   handle distributed rate limiting correctly.
 *
 * REDIS DATA STRUCTURE — Sorted Set:
 *
 *   Key:   rl:sw:ip:route:auth_login:127.0.0.1
 *   Score: timestamp in ms (e.g. 1741600123456)
 *   Value: unique request ID (timestamp:random to handle same-ms requests)
 */

import { redis } from "../redis/client.js";

export async function consumeSlidingWindow({ key, windowMs, max }) {
  const now         = Date.now();
  const windowStart = now - windowMs;

  // Unique member — timestamp + random suffix handles burst requests at same ms
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

  // Single atomic Lua call — replaces the two-pipeline approach.
  // Returns: [allowed, count, remaining, oldestScore, countBefore]
  const [allowed, count, remaining, oldestScore] =
    await redis.slidingWindowConsume(
      key,          // KEYS[1]
      now,          // ARGV[1]
      windowStart,  // ARGV[2]
      windowMs,     // ARGV[3]
      max,          // ARGV[4]
      member,       // ARGV[5]
    );

  const retryAfterMs = windowMs - (now - oldestScore);

  return {
    allowed:      allowed === 1,
    limit:        max,
    current:      count,
    remaining:    remaining,
    retryAfterMs: retryAfterMs > 0 ? retryAfterMs : windowMs,
  };
}

