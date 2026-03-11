/**
 * Sliding Window Rate Limiter
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
 * REDIS DATA STRUCTURE — Sorted Set:
 *
 *   Key:   rl:sw:ip:route:auth_login:127.0.0.1
 *   Score: timestamp in ms (e.g. 1741600123456)
 *   Value: unique request ID (timestamp:random to handle same-ms requests)
 *
 *   ZADD  key score member   → add this request's timestamp
 *   ZREMRANGEBYSCORE key 0 (now - windowMs)  → remove expired timestamps
 *   ZCARD key               → count remaining = requests in last windowMs
 *   EXPIRE key windowMs     → auto-cleanup if key goes idle
 *
 * TRADEOFF vs Fixed Window:
 *   ✅ No boundary burst exploit
 *   ✅ Smooth, accurate rolling count
 *   ❌ Stores one entry per request (more Redis memory)
 *   ❌ 3 Redis commands vs 2 for fixed window (slightly slower)
 */

import { redis } from "../redis/client.js";

export async function consumeSlidingWindow({ key, windowMs, max }) {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Unique member — timestamp + random suffix handles burst requests at same ms
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

  // Phase 1: clean up expired entries and get current count BEFORE adding
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zcard(key);
  const phase1 = await pipeline.exec();

  const countBefore = phase1[1][1]; // requests already in the window

  // If already at or over limit, deny without consuming a slot
  if (countBefore >= max) {
    const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
    const oldestScore = oldest.length >= 2 ? parseInt(oldest[1]) : now;
    const retryAfterMs = windowMs - (now - oldestScore);
    return {
      allowed: false,
      limit: max,
      current: countBefore,
      remaining: 0,
      retryAfterMs: retryAfterMs > 0 ? retryAfterMs : windowMs,
    };
  }

  // Phase 2: allowed — add the request and update TTL
  const pipeline2 = redis.pipeline();
  pipeline2.zadd(key, now, member);
  pipeline2.pexpire(key, windowMs);
  await pipeline2.exec();

  const count = countBefore + 1;

  // Oldest entry score = when the oldest request in the window was made
  // retryAfter = when that oldest entry will fall out of the window
  const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
  const oldestScore = oldest.length >= 2 ? parseInt(oldest[1]) : now;
  const retryAfterMs = windowMs - (now - oldestScore);

  return {
    allowed: true,
    limit: max,
    current: count,
    remaining: max - count,          // always >= 0 because we checked before adding
    retryAfterMs: retryAfterMs > 0 ? retryAfterMs : windowMs,
  };
}
