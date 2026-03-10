export const limits = {
  // Catches every IP regardless of route — broad safety net
  globalIp: {
    windowMs: 60 * 1000, // 1 minute
    max: 300,
  },

  // Per-authenticated-user limit — applies when x-user-id header is present.
  // Sits between the global IP check and the route-level check.
  // Authenticated users get a higher personal budget than anonymous IPs.
  globalUser: {
    windowMs: 60 * 1000,
    max: 500,           // More generous — we know who they are
  },

  // Per-route policies — keyed by the routeKey returned from getRouteKey()
  // Each entry applies on top of the global checks
  routes: {
    auth_login: {
      windowMs: 60 * 1000,
      max: 5,           // Very tight — brute force protection
      scope: "ip",      // Always IP-scoped even if user is known
    },
    auth_register: {
      windowMs: 60 * 1000,
      max: 10,          // Slightly looser — still abuse-resistant
      scope: "ip",
    },
    api_data: {
      windowMs: 60 * 1000,
      max: 100,         // High throughput data endpoint
      scope: "ip",
    },
    users: {
      windowMs: 60 * 1000,
      max: 60,          // Moderate — user lookups
      scope: "ip",
    },
  },
};