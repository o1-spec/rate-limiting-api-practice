import Redis from "ioredis";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(__dirname, "../limiter/scripts");

// Load Lua source once at startup — ioredis will EVALSHA these on every call,
// falling back to EVAL on cache miss (e.g. after a Redis restart).
const slidingWindowLua = readFileSync(join(scriptsDir, "slidingWindow.lua"), "utf8");
const tokenBucketLua   = readFileSync(join(scriptsDir, "tokenBucket.lua"),   "utf8");

export const redis = new Redis(process.env.REDIS_URL);

/**
 * Atomic sliding window check-and-consume.
 * Args: now, windowStart, windowMs, max, member
 * Returns: [allowed, count, remaining, oldestScore, countBefore]
 */
redis.defineCommand("slidingWindowConsume", {
  numberOfKeys: 1,
  lua: slidingWindowLua,
});

/**
 * Atomic token bucket check-and-consume.
 * Args: now, capacity, refillRate, refillIntervalMs, ttlMs
 * Returns: [allowed, tokens, msUntilNextToken, capacity]
 */
redis.defineCommand("tokenBucketConsume", {
  numberOfKeys: 1,
  lua: tokenBucketLua,
});

redis.on("connect", () => {
  console.log("Connected to Redis");
});

redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});