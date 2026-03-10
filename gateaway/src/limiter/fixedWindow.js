import { redis } from "../redis/client.js";

export async function consumeFixedWindow({ key, windowMs, max }) {
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.pexpire(key, windowMs);
  }

  const ttl = await redis.pttl(key);

  return {
    allowed: count <= max,
    limit: max,
    current: count,
    remaining: Math.max(0, max - count),
    retryAfterMs: ttl > 0 ? ttl : windowMs,
  };
}