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

// ── Sentinel connection ───────────────────────────────────────────────────────
// ioredis Sentinel works transparently: on every connect it asks a sentinel
// "who is the current primary?" and opens a connection to that node.
// If the primary fails and a replica is promoted, ioredis detects the
// +switch-master event and automatically reconnects — zero gateway restarts.
//
// REDIS_SENTINEL_HOSTS is a comma-separated list of host:port pairs, e.g.
//   sentinel-1:26379,sentinel-2:26379,sentinel-3:26379
// Falls back to a single localhost sentinel for plain local dev without Docker.
const sentinelHosts = (
  process.env.REDIS_SENTINEL_HOSTS || "localhost:26379"
)
  .split(",")
  .map((entry) => {
    const [host, port] = entry.trim().split(":");
    return { host, port: Number(port) || 26379 };
  });

export const redis = new Redis({
  sentinels: sentinelHosts,
  name: process.env.REDIS_MASTER_NAME || "mymaster",
  // Retry the sentinel lookup up to 20 times before giving up.
  sentinelRetryStrategy: (times) => Math.min(times * 200, 5000),
  // Reconnect to Redis itself up to 20 times on disconnect.
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

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