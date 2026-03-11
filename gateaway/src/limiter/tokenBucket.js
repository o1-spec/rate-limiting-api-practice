/**
 * Token Bucket Rate Limiter
 *
 * WHY THIS EXISTS — what sliding window still can't do:
 *
 *   Both fixed and sliding windows ask: "how many requests in the last N seconds?"
 *   They treat every second of the window as equal.
 *
 *   Token bucket asks a different question:
 *   "Does this client have a token to spend right now?"
 *
 * HOW IT WORKS:
 *
 *   Imagine a bucket that holds tokens (max = capacity).
 *   Tokens refill at a fixed rate (e.g. 10 tokens per second).
 *   Each request costs 1 token.
 *   If the bucket is empty → reject the request.
 *
 *   This allows BURSTS — if a client hasn't made requests for a while,
 *   their bucket fills up and they can fire several requests quickly.
 *   But sustained abuse drains the bucket and they get throttled.
 *
 * EXAMPLE (capacity=5, refillRate=1 token/sec):
 *
 *   t=0s   bucket=5  → req ✅ bucket=4
 *   t=0s   bucket=4  → req ✅ bucket=3
 *   t=0s   bucket=3  → req ✅ bucket=2
 *   t=0s   bucket=2  → req ✅ bucket=1
 *   t=0s   bucket=1  → req ✅ bucket=0
 *   t=0s   bucket=0  → req ❌ BLOCKED
 *   t=1s   bucket=1  → req ✅ bucket=0  (1 token refilled)
 *   t=5s   bucket=5  → req ✅ bucket=4  (5 tokens refilled, capped at capacity)
 *
 * VS SLIDING WINDOW:
 *   ✅ Handles bursts naturally — clients can save up capacity
 *   ✅ Smooth throttling — never hard resets at window boundary
 *   ✅ More intuitive for APIs with bursty traffic patterns
 *   ❌ More complex refill logic
 *   ❌ Requires storing tokens + lastRefill timestamp
 *
 * REDIS DATA STRUCTURE — Hash:
 *
 *   Key:    rl:tb:ip:route:api_data:127.0.0.1
 *   Fields: tokens (current count), lastRefill (timestamp ms)
 */

import { redis } from "../redis/client.js";

/**
 * @param {object} opts
 * @param {string} opts.key          - Redis key for this client+route
 * @param {number} opts.capacity     - Max tokens the bucket can hold
 * @param {number} opts.refillRate   - Tokens added per refillIntervalMs
 * @param {number} opts.refillIntervalMs - How often tokens are added (e.g. 1000 = per second)
 * @param {number} [opts.ttlMs]      - How long to keep the key if idle (default: 60s)
 */
export async function consumeTokenBucket({
  key,
  capacity,
  refillRate,
  refillIntervalMs,
  ttlMs = 60 * 1000,
}) {
  const now = Date.now();

  // Load existing bucket state from Redis
  const data = await redis.hgetall(key);

  let tokens;
  let lastRefill;

  if (!data || !data.tokens) {
    // Brand new client — start with a full bucket
    tokens = capacity;
    lastRefill = now;
  } else {
    tokens = parseFloat(data.tokens);
    lastRefill = parseInt(data.lastRefill);
  }

  // ── Refill calculation ──────────────────────────────────────────────────────
  // How many full refill intervals have passed since last refill?
  const elapsed = now - lastRefill;
  const intervalsElapsed = Math.floor(elapsed / refillIntervalMs);
  const tokensToAdd = intervalsElapsed * refillRate;

  if (tokensToAdd > 0) {
    // Add tokens but don't exceed capacity
    tokens = Math.min(capacity, tokens + tokensToAdd);
    // Advance lastRefill by whole intervals only (don't lose partial interval progress)
    lastRefill = lastRefill + intervalsElapsed * refillIntervalMs;
  }

  // ── Consume one token ───────────────────────────────────────────────────────
  const allowed = tokens >= 1;

  if (allowed) {
    tokens -= 1;
  }

  // ── Persist updated state ───────────────────────────────────────────────────
  const pipeline = redis.pipeline();
  pipeline.hset(key, "tokens", tokens.toString());
  pipeline.hset(key, "lastRefill", lastRefill.toString());
  pipeline.pexpire(key, ttlMs); // auto-cleanup idle keys
  await pipeline.exec();

  // How long until the next token is available?
  const msUntilNextToken = allowed
    ? 0
    : refillIntervalMs - (now - lastRefill);

  return {
    allowed,
    limit: capacity,
    current: Math.floor(tokens),     // tokens remaining after this request
    remaining: Math.floor(tokens),   // same — tokens left to spend
    retryAfterMs: msUntilNextToken > 0 ? msUntilNextToken : refillIntervalMs,
  };
}
