/**
 * In-memory gateway stats.
 * These counters reset when the process restarts — this is intentional for
 * a learning project. In production you'd persist these to Redis or a TSDB.
 *
 * Imported by rateLimiter.js to record decisions,
 * and by server.js to expose via /admin/gateway-stats.
 */

import { limits } from "../config/limits.js";

const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  allowedRequests: 0,
  blockedRequests: 0,

  // Per-scope breakdown
  byScope: {
    global_ip:   { allowed: 0, blocked: 0 },
    global_user: { allowed: 0, blocked: 0 },
    ip_route:    { allowed: 0, blocked: 0 },
  },

  // Per-route breakdown (only routes with a policy)
  byRoute: {
    auth_login:    { allowed: 0, blocked: 0 },
    auth_register: { allowed: 0, blocked: 0 },
    api_data:      { allowed: 0, blocked: 0 },
    users:         { allowed: 0, blocked: 0 },
    other:         { allowed: 0, blocked: 0 },
  },
};

/**
 * Called by rateLimiter middleware on every rate limit decision.
 * @param {object} opts
 * @param {boolean} opts.allowed
 * @param {string}  opts.scope      - "global_ip" | "global_user" | "ip_route"
 * @param {string|null} opts.routeKey
 */
export function recordRequest({ allowed, scope, routeKey }) {
  stats.totalRequests++;

  if (allowed) {
    stats.allowedRequests++;
  } else {
    stats.blockedRequests++;
  }

  // Scope breakdown
  if (stats.byScope[scope]) {
    allowed ? stats.byScope[scope].allowed++ : stats.byScope[scope].blocked++;
  }

  // Route breakdown
  const route = routeKey && stats.byRoute[routeKey] ? routeKey : "other";
  allowed ? stats.byRoute[route].allowed++ : stats.byRoute[route].blocked++;
}

/**
 * Returns a snapshot of the current stats.
 */
export function getStats() {
  const uptimeSeconds = Math.floor(
    (Date.now() - new Date(stats.startedAt).getTime()) / 1000
  );

  const blockRate =
    stats.totalRequests > 0
      ? ((stats.blockedRequests / stats.totalRequests) * 100).toFixed(1) + "%"
      : "0%";

  return {
    ...stats,
    uptimeSeconds,
    blockRate,
    // Live route config so the Dashboard can show the correct algorithm per route
    rules: Object.fromEntries(
      Object.entries(limits.routes).map(([route, policy]) => [
        route,
        { algorithm: policy.algorithm ?? "fixedWindow" },
      ])
    ),
  };
}
