/**
 * Token Bucket Rate Limiter — Lua-backed atomic implementation
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
 *   Tokens refill at a fixed rate (e.g. 2 tokens per second).
 *   Each request costs 1 token.
 *   If the bucket is empty → reject the request.
 *
 *   This allows BURSTS — if a client hasn't made requests for a while,
 *   their bucket fills up and they can fire several requests quickly.
 *   But sustained abuse drains the bucket and they get throttled.
 *
 * WHY LUA — the double-spend race condition:
 *
 *   Without atomicity, two gateways both see tokens=1:
 *
 *     Gateway A: HGETALL → tokens=1 → allowed, writes tokens=0
 *     Gateway B: HGETALL → tokens=1 → allowed, writes tokens=0
 *     Both pass. The single token was spent twice.
 *
 *   The Lua script is atomic — Redis processes it as one indivisible command.
 *   Gateway B's script sees tokens=0 (Gateway A already updated it).
 *
 * REDIS DATA STRUCTURE — Hash:
 *
 *   Key:    rl:tb:ip:route:api_data:127.0.0.1
 *   Fields: tokens (current count), lastRefill (timestamp ms)
 */

import { redis } from "../redis/client.js";

/**
 * @param {object} opts
 * @param {string} opts.key              - Redis key for this client+route
 * @param {number} opts.capacity         - Max tokens the bucket can hold
 * @param {number} opts.refillRate       - Tokens added per refillIntervalMs
 * @param {number} opts.refillIntervalMs - How often tokens are added (ms)
 * @param {number} [opts.ttlMs]          - Key TTL for idle cleanup (default: 60s)
 */
export async function consumeTokenBucket({
  key,
  capacity,
  refillRate,
  refillIntervalMs,
  ttlMs = 60 * 1000,
}) {
  const now = Date.now();

  // Single atomic Lua call — replaces the HGETALL → compute → HSET sequence.
  // Returns: [allowed, tokens, msUntilNextToken, capacity]
  const [allowed, tokens, msUntilNextToken] =
    await redis.tokenBucketConsume(
      key,              // KEYS[1]
      now,              // ARGV[1]
      capacity,         // ARGV[2]
      refillRate,       // ARGV[3]
      refillIntervalMs, // ARGV[4]
      ttlMs,            // ARGV[5]
    );

  return {
    allowed:      allowed === 1,
    limit:        capacity,
    current:      tokens,
    remaining:    tokens,
    retryAfterMs: msUntilNextToken > 0 ? msUntilNextToken : refillIntervalMs,
  };
}

