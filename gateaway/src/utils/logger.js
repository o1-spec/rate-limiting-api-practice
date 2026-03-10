/**
 * Structured rate-limit logger.
 * Prints a single consistent log line per request decision.
 *
 * Example output (anonymous):
 *   [2026-03-10T...] [RateLimit] POST /auth/login ip=::1 user=anon scope=ip_route allowed=false ← BLOCKED remaining=0 limit=5
 *
 * Example output (authenticated):
 *   [2026-03-10T...] [RateLimit] GET /api/data ip=::1 user=u2 scope=global_user allowed=true  remaining=499 limit=500
 */
export function logRateLimit({ method, path, ip, userId, scope, allowed, remaining, limit }) {
  const status = allowed ? "allowed=true " : "allowed=false ← BLOCKED";
  const timestamp = new Date().toISOString();
  const user = userId || "anon";

  console.log(
    `[${timestamp}] [RateLimit] ${method} ${path} ip=${ip} user=${user} scope=${scope} ${status} remaining=${remaining} limit=${limit}`
  );
}
