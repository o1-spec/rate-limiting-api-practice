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

  // Run all 4 Redis commands as a pipeline for atomicity and performance
  const pipeline = redis.pipeline();

  // 1. Remove all timestamps older than the window start
  pipeline.zremrangebyscore(key, 0, windowStart);

  // 2. Add this request's timestamp
  pipeline.zadd(key, now, member);

  // 3. Count all entries in the set = requests in the last windowMs
  pipeline.zcard(key);

  // 4. Reset the key TTL so it cleans up if traffic stops
  pipeline.pexpire(key, windowMs);

  const results = await pipeline.exec();

  // zcard result is at index 2 — [err, value] tuple per command
  const count = results[2][1];

  // Oldest entry score = when the oldest request in the window was made
  // retryAfter = when that oldest entry will fall out of the window
  const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
  const oldestScore = oldest.length >= 2 ? parseInt(oldest[1]) : now;
  const retryAfterMs = windowMs - (now - oldestScore);

  return {
    allowed: count <= max,
    limit: max,
    current: count,
    remaining: Math.max(0, max - count),
    retryAfterMs: retryAfterMs > 0 ? retryAfterMs : windowMs,
  };
}
