import { limits } from "../config/limits.js";
import { buildFixedWindowKey } from "../limiter/redisKeys.js";
import { consumeFixedWindow } from "../limiter/fixedWindow.js";
import { setRateLimitHeaders } from "../limiter/header.js";
import { getClientIp } from "../utils/getClientIp.js";
import { logRateLimit } from "../utils/logger.js";
import { recordRequest } from "../admin/stats.js";

/**
 * Redis failure mode — read once at startup from env.
 *   "open"   → if Redis is down, allow all traffic through (availability wins)
 *   "closed" → if Redis is down, block all traffic with 503 (protection wins)
 */
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

  return null; // No specific policy — global limit only
}

export async function rateLimiter(req, res, next) {
  const now = Date.now();
  const ip = getClientIp(req);
  const userId = req.headers["x-user-id"] || null; // Present when client is authenticated
  const routeKey = getRouteKey(req);

  try {
    // ── 1. Global IP check ──────────────────────────────────────────────────
    const globalWindow = Math.floor(now / limits.globalIp.windowMs);
    const globalKey = buildFixedWindowKey({
      scope: "ip",
      identifier: ip,
      window: globalWindow,
    });

    const globalResult = await consumeFixedWindow({
      key: globalKey,
      windowMs: limits.globalIp.windowMs,
      max: limits.globalIp.max,
    });

    logRateLimit({
      method: req.method,
      path: req.path,
      ip,
      userId,
      scope: "global_ip",
      allowed: globalResult.allowed,
      remaining: globalResult.remaining,
      limit: globalResult.limit,
    });
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

    // ── 2. Per-user check (only if x-user-id header is present) ────────────
    if (userId) {
      const userWindow = Math.floor(now / limits.globalUser.windowMs);
      const userKey = buildFixedWindowKey({
        scope: "user",
        identifier: userId,
        window: userWindow,
      });

      const userResult = await consumeFixedWindow({
        key: userKey,
        windowMs: limits.globalUser.windowMs,
        max: limits.globalUser.max,
      });

      logRateLimit({
        method: req.method,
        path: req.path,
        ip,
        userId,
        scope: "global_user",
        allowed: userResult.allowed,
        remaining: userResult.remaining,
        limit: userResult.limit,
      });
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
    const routeWindow = Math.floor(now / routePolicy.windowMs);

    // Auth routes always scope to IP even if user is known (brute-force protection)
    const routeIdentifier =
      routePolicy.scope === "ip" ? ip : userId || ip;

    const routeKeyName = buildFixedWindowKey({
      scope: routePolicy.scope || "ip",
      identifier: routeIdentifier,
      routeKey,
      window: routeWindow,
    });

    const routeResult = await consumeFixedWindow({
      key: routeKeyName,
      windowMs: routePolicy.windowMs,
      max: routePolicy.max,
    });

    logRateLimit({
      method: req.method,
      path: req.path,
      ip,
      userId,
      scope: "ip_route",
      allowed: routeResult.allowed,
      remaining: routeResult.remaining,
      limit: routeResult.limit,
    });
    recordRequest({ allowed: routeResult.allowed, scope: "ip_route", routeKey });

    setRateLimitHeaders(res, routeResult);

    if (!routeResult.allowed) {
      res.setHeader("Retry-After", Math.ceil(routeResult.retryAfterMs / 1000));

      return res.status(429).json({
        error: "Too Many Requests",
        scope: "ip_route",
        route: routeKey,
        message: `Rate limit exceeded for ${req.path}`,
        retryAfterSeconds: Math.ceil(routeResult.retryAfterMs / 1000),
      });
    }

    next();

  } catch (error) {
    // ── Redis failure handling ───────────────────────────────────────────────
    const isRedisError =
      error.name === "ReplyError" ||
      error.message?.toLowerCase().includes("redis") ||
      error.message?.toLowerCase().includes("econnrefused");

    if (isRedisError) {
      console.error(
        `[${new Date().toISOString()}] [RateLimit] Redis failure: ${error.message} | mode=${REDIS_FAILURE_MODE}`
      );

      if (REDIS_FAILURE_MODE === "open") {
        // Fail open — let traffic through, log the risk
        console.warn(
          `[${new Date().toISOString()}] [RateLimit] FAIL OPEN — bypassing rate limit for ${req.method} ${req.path}`
        );
        return next();
      } else {
        // Fail closed — protect the backend, reject all traffic
        return res.status(503).json({
          error: "Service Unavailable",
          message: "Rate limiting is temporarily unavailable. Please try again shortly.",
        });
      }
    }

    next(error);
  }
}

