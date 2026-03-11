import { limits } from "../config/limits.js";
import { buildFixedWindowKey, buildSlidingWindowKey, buildTokenBucketKey } from "../limiter/redisKeys.js";
import { consumeFixedWindow } from "../limiter/fixedWindow.js";
import { consumeSlidingWindow } from "../limiter/slidingWindow.js";
import { consumeTokenBucket } from "../limiter/tokenBucket.js";
import { setRateLimitHeaders } from "../limiter/header.js";
import { getClientIp } from "../utils/getClientIp.js";
import { logRateLimit } from "../utils/logger.js";
import { recordRequest } from "../admin/stats.js";

const REDIS_FAILURE_MODE = process.env.REDIS_FAILURE_MODE || "open";

/**
 * Maps an incoming request path to a route policy key.
 * Uses prefix matching so /api/data/:id, /users/:id etc. resolve correctly.
 * Order matters — more specific paths must come before broader prefixes.
 */
function getRouteKey(req) {
  const path = req.path;

  if (path === "/auth/login")       return "auth_login";
  if (path === "/auth/register")    return "auth_register";
  if (path.startsWith("/api/data")) return "api_data";
  if (path.startsWith("/users"))    return "users";

  return null;
}

/**
 * Runs the correct rate limiting algorithm based on the policy config.
 * All three algorithms return the same shape:
 *   { allowed, limit, current, remaining, retryAfterMs }
 *
 * This means rateLimiter.js doesn't need to know which algorithm runs —
 * it just calls runPolicy() and reads the result.
 */
async function runPolicy({ policy, identifier, routeKey, now }) {
  const algorithm = policy.algorithm || "fixedWindow";

  if (algorithm === "slidingWindow") {
    const key = buildSlidingWindowKey({
      scope: policy.scope || "ip",
      identifier,
      routeKey,
    });
    return consumeSlidingWindow({
      key,
      windowMs: policy.windowMs,
      max: policy.max,
    });
  }

  if (algorithm === "tokenBucket") {
    const key = buildTokenBucketKey({
      scope: policy.scope || "ip",
      identifier,
      routeKey,
    });
    return consumeTokenBucket({
      key,
      capacity:          policy.capacity          ?? policy.max,
      refillRate:        policy.refillRate         ?? 1,
      refillIntervalMs:  policy.refillIntervalMs   ?? 1000,
      ttlMs:             policy.windowMs,
    });
  }

  // Default: fixedWindow
  const window = Math.floor(now / policy.windowMs);
  const key = buildFixedWindowKey({
    scope: policy.scope || "ip",
    identifier,
    routeKey,
    window,
  });
  return consumeFixedWindow({
    key,
    windowMs: policy.windowMs,
    max: policy.max,
  });
}

export async function rateLimiter(req, res, next) {
  const now = Date.now();
  const ip = getClientIp(req);
  const userId = req.headers["x-user-id"] || null;
  const routeKey = getRouteKey(req);

  try {
    // ── 1. Global IP check ──────────────────────────────────────────────────
    const globalResult = await runPolicy({
      policy: limits.globalIp,
      identifier: ip,
      routeKey: null,
      now,
    });

    logRateLimit({ method: req.method, path: req.path, ip, userId, scope: "global_ip", allowed: globalResult.allowed, remaining: globalResult.remaining, limit: globalResult.limit });
    recordRequest({ allowed: globalResult.allowed, scope: "global_ip", routeKey });

    if (!globalResult.allowed) {
      setRateLimitHeaders(res, globalResult);
      res.setHeader("Retry-After", Math.ceil(globalResult.retryAfterMs / 1000));
      return res.status(429).json({
        error: "Too Many Requests",
        scope: "global_ip",
        message: "Global IP rate limit exceeded",
        retryAfterSeconds: Math.ceil(globalResult.retryAfterMs / 1000),
      });
    }

    // ── 2. Per-user check (only if x-user-id present) ───────────────────────
    if (userId) {
      const userResult = await runPolicy({
        policy: limits.globalUser,
        identifier: userId,
        routeKey: null,
        now,
      });

      logRateLimit({ method: req.method, path: req.path, ip, userId, scope: "global_user", allowed: userResult.allowed, remaining: userResult.remaining, limit: userResult.limit });
      recordRequest({ allowed: userResult.allowed, scope: "global_user", routeKey });

      if (!userResult.allowed) {
        setRateLimitHeaders(res, userResult);
        res.setHeader("Retry-After", Math.ceil(userResult.retryAfterMs / 1000));
        return res.status(429).json({
          error: "Too Many Requests",
          scope: "global_user",
          message: "Per-user rate limit exceeded",
          retryAfterSeconds: Math.ceil(userResult.retryAfterMs / 1000),
        });
      }
    }

    // ── 3. Route-level check ────────────────────────────────────────────────
    if (!routeKey || !limits.routes[routeKey]) {
      setRateLimitHeaders(res, globalResult);
      return next();
    }

    const routePolicy = limits.routes[routeKey];
    const routeIdentifier = routePolicy.scope === "ip" ? ip : userId || ip;

    const routeResult = await runPolicy({
      policy: routePolicy,
      identifier: routeIdentifier,
      routeKey,
      now,
    });

    logRateLimit({ method: req.method, path: req.path, ip, userId, scope: "ip_route", allowed: routeResult.allowed, remaining: routeResult.remaining, limit: routeResult.limit });
    recordRequest({ allowed: routeResult.allowed, scope: "ip_route", routeKey });

    setRateLimitHeaders(res, routeResult);

    if (!routeResult.allowed) {
      res.setHeader("Retry-After", Math.ceil(routeResult.retryAfterMs / 1000));
      return res.status(429).json({
        error: "Too Many Requests",
        scope: "ip_route",
        route: routeKey,
        algorithm: routePolicy.algorithm || "fixedWindow",
        message: `Rate limit exceeded for ${req.path}`,
        retryAfterSeconds: Math.ceil(routeResult.retryAfterMs / 1000),
      });
    }

    next();

  } catch (error) {
    const isRedisError =
      error.name === "ReplyError" ||
      error.message?.toLowerCase().includes("redis") ||
      error.message?.toLowerCase().includes("econnrefused");

    if (isRedisError) {
      console.error(`[${new Date().toISOString()}] [RateLimit] Redis failure: ${error.message} | mode=${REDIS_FAILURE_MODE}`);
      if (REDIS_FAILURE_MODE === "open") {
        console.warn(`[${new Date().toISOString()}] [RateLimit] FAIL OPEN — bypassing rate limit for ${req.method} ${req.path}`);
        return next();
      } else {
        return res.status(503).json({
          error: "Service Unavailable",
          message: "Rate limiting is temporarily unavailable. Please try again shortly.",
        });
      }
    }

    next(error);
  }
}
