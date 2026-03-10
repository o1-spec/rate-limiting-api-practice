export const limits = {
  // Catches every IP regardless of route — broad safety net
  globalIp: {
    windowMs: 60 * 1000, // 1 minute
    max: 300,
    algorithm: "fixedWindow", // fast, low memory — good for global checks
  },

  // Per-authenticated-user limit — applies when x-user-id header is present.
  globalUser: {
    windowMs: 60 * 1000,
    max: 500,
    algorithm: "fixedWindow",
  },

  // Per-route policies — each route can independently choose its algorithm.
  //
  // algorithm options:
  //   "fixedWindow"   — fast, simple, slight boundary burst risk
  //   "slidingWindow" — accurate rolling count, no boundary exploit, more memory
  //   "tokenBucket"   — burst-tolerant, smooth throttling, stores state as hash
  routes: {
    auth_login: {
      windowMs: 60 * 1000,
      max: 5,
      scope: "ip",
      algorithm: "slidingWindow", // no boundary exploit on brute force protection
    },
    auth_register: {
      windowMs: 60 * 1000,
      max: 10,
      scope: "ip",
      algorithm: "slidingWindow",
    },
    api_data: {
      windowMs: 60 * 1000,
      max: 100,
      scope: "ip",
      algorithm: "tokenBucket",  // allow short bursts, throttle sustained abuse
      // token bucket specific settings
      capacity: 100,             // max tokens (burst ceiling)
      refillRate: 2,             // tokens added per refillIntervalMs
      refillIntervalMs: 1000,    // refill every 1 second → 2 tokens/sec = 120/min
    },
    users: {
      windowMs: 60 * 1000,
      max: 60,
      scope: "ip",
      algorithm: "fixedWindow",  // simple lookups, fixed window is fine here
    },
  },
};