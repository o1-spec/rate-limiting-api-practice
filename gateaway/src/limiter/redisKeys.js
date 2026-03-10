/**
 * Key builders for each rate limiting algorithm.
 *
 * Naming convention:
 *   rl:{algorithm}:{scope}:{type}:{routeKey?}:{identifier}
 *
 *   rl:fw  → fixed window   (includes :{window} time segment)
 *   rl:sw  → sliding window (no time segment — sorted set handles it)
 *   rl:tb  → token bucket   (no time segment — hash stores state)
 */

// ── Fixed Window ──────────────────────────────────────────────────────────────
// Includes a time window segment so the key naturally rotates every windowMs.
export function buildFixedWindowKey({ scope, identifier, routeKey, window }) {
  if (routeKey) {
    return `rl:fw:${scope}:route:${routeKey}:${identifier}:${window}`;
  }
  return `rl:fw:${scope}:global:${identifier}:${window}`;
}

// ── Sliding Window ────────────────────────────────────────────────────────────
// No time segment — the sorted set members are the timestamps.
// The same key is reused and old entries are pruned on each request.
export function buildSlidingWindowKey({ scope, identifier, routeKey }) {
  if (routeKey) {
    return `rl:sw:${scope}:route:${routeKey}:${identifier}`;
  }
  return `rl:sw:${scope}:global:${identifier}`;
}

// ── Token Bucket ──────────────────────────────────────────────────────────────
// No time segment — a hash stores { tokens, lastRefill } persistently.
// The bucket state is updated on every request.
export function buildTokenBucketKey({ scope, identifier, routeKey }) {
  if (routeKey) {
    return `rl:tb:${scope}:route:${routeKey}:${identifier}`;
  }
  return `rl:tb:${scope}:global:${identifier}`;
}
