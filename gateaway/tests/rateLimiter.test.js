/**
 * Gateway rate limiter tests.
 *
 * Strategy: mock Redis and the proxy so tests are:
 *   - fast (no network)
 *   - deterministic (controlled counters)
 *   - isolated (no real Redis needed)
 *
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock Redis client ─────────────────────────────────────────────────────────
// We control the counter manually so we can simulate any request count.
let mockCounter = 0;
let mockTtl = 30000;
let mockRedisDown = false;

// Build a fresh pipeline mock that resolves to "allowed with 1 request in window"
function makePipelineMock(count = 1) {
  return {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd:             vi.fn().mockReturnThis(),
    zcard:            vi.fn().mockReturnThis(),
    pexpire:          vi.fn().mockReturnThis(),
    hset:             vi.fn().mockReturnThis(),   // tokenBucket persist step
    // ioredis pipeline.exec() returns [[err, val], [err, val], ...]
    exec: vi.fn(async () => [
      [null, 0],      // zremrangebyscore → 0 removed  (or hset tokens)
      [null, 1],      // zadd → 1 added                (or hset lastRefill)
      [null, count],  // zcard → count entries          (or pexpire)
      [null, 1],      // pexpire → 1 (success)
    ]),
  };
}

vi.mock("../src/redis/client.js", () => ({
  redis: {
    incr: vi.fn(async () => {
      if (mockRedisDown) throw new Error("ECONNREFUSED Redis is down");
      return ++mockCounter;
    }),
    pexpire: vi.fn(async () => {
      if (mockRedisDown) throw new Error("ECONNREFUSED Redis is down");
      return 1;
    }),
    pttl: vi.fn(async () => {
      if (mockRedisDown) throw new Error("ECONNREFUSED Redis is down");
      return mockTtl;
    }),
    ping: vi.fn(async () => {
      if (mockRedisDown) throw new Error("ECONNREFUSED Redis is down");
      return "PONG";
    }),
    set:      vi.fn(async () => "OK"),
    get:      vi.fn(async () => "redis is working"),
    hgetall:  vi.fn(async () => null),   // null → fresh bucket
    hset:     vi.fn(async () => 1),
    pipeline: vi.fn(() => makePipelineMock()),
    zrange:   vi.fn(async () => []),     // empty → no oldest score
    on:       vi.fn(),
  },
}));

// ── Mock proxy forwardRequest ─────────────────────────────────────────────────
vi.mock("../src/proxy/forwardRequest.js", () => ({
  forwardRequest: vi.fn(async (req, res) => {
    res.status(200).json({ message: "proxied", path: req.path });
  }),
}));

// ── Mock admin stats (avoid side effects across tests) ───────────────────────
vi.mock("../src/admin/stats.js", () => ({
  recordRequest: vi.fn(),
  getStats: vi.fn(() => ({ totalRequests: 0, blockedRequests: 0 })),
}));

// ── Build app helper ──────────────────────────────────────────────────────────
async function buildApp(env = {}) {
  // Set env before importing modules that read it at load time
  Object.assign(process.env, {
    PORT: "4000",
    REDIS_URL: "redis://localhost:6379",
    BACKEND_URL: "http://localhost:5001",
    REDIS_FAILURE_MODE: "open",
    ...env,
  });

  // Dynamic import so env is set first
  const { rateLimiter } = await import("../src/middleware/rateLimiter.js");
  const { forwardRequest } = await import("../src/proxy/forwardRequest.js");
  const { errorHandler } = await import("../src/middleware/errorHandler.js");

  const app = express();
  app.use(express.json());
  app.use(rateLimiter);
  app.all("/{*path}", forwardRequest);
  app.use(errorHandler);

  return app;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Fixed window rate limiter", () => {
  let app;

  beforeEach(async () => {
    mockCounter = 0;
    mockTtl = 30000;
    mockRedisDown = false;
    vi.resetModules();
    app = await buildApp();
  });

  // ── 1. Request under limit passes through ─────────────────────────────────
  it("allows a request that is under the global limit", async () => {
    mockCounter = 0; // Will become 1 after incr → well under 300

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("proxied");
  });

  // ── 2. Request over global IP limit returns 429 ───────────────────────────
  it("blocks a request that exceeds the global IP limit", async () => {
    mockCounter = 300; // Next incr → 301, limit is 300

    const res = await request(app).get("/health");

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Too Many Requests");
    expect(res.body.scope).toBe("global_ip");
  });

  // ── 3. Route-specific rule blocks after route limit ───────────────────────
  it("blocks /auth/login after 5 requests (route limit)", async () => {
    // auth_login uses slidingWindow — mock pipeline to return count=6 (> max=5)
    // Use mockReturnValueOnce so this override doesn't bleed into the next test.
    const { redis } = await import("../src/redis/client.js");
    redis.pipeline.mockReturnValueOnce(makePipelineMock(6)); // zcard result = 6

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "a@b.com", password: "123" });

    expect(res.status).toBe(429);
    expect(res.body.scope).toBe("ip_route");
    expect(res.body.route).toBe("auth_login");
  });

  // ── 4. Route-specific rule allows requests within the route limit ─────────
  it("allows /auth/login when under the route limit", async () => {
    // auth_login uses slidingWindow — default pipeline mock returns count=1 (< max=5)
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "a@b.com", password: "123" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("proxied");
  });

  // ── 5. Correct rate-limit headers are present on allowed responses ─────────
  it("sets X-RateLimit-* headers on allowed responses", async () => {
    mockCounter = 0;

    const res = await request(app).get("/users");

    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });

  // ── 6. Retry-After header is present on 429 responses ────────────────────
  it("sets Retry-After header when blocked", async () => {
    const { redis } = await import("../src/redis/client.js");
    // Force the incr to always return a value over the global limit
    redis.incr.mockResolvedValue(301);

    const res = await request(app).get("/health");

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  // ── 7. Per-user rate limiting uses x-user-id header ──────────────────────
  it("applies per-user check when x-user-id header is present", async () => {
    const { redis } = await import("../src/redis/client.js");
    let callCount = 0;
    redis.incr.mockImplementation(async () => {
      callCount++;
      // 1st = global IP → 1 (allowed)
      // 2nd = user check → 501 (blocked, limit=500)
      return callCount === 1 ? 1 : 501;
    });

    const res = await request(app)
      .get("/api/data")
      .set("x-user-id", "u123");

    expect(res.status).toBe(429);
    expect(res.body.scope).toBe("global_user");
  });

  // ── 8. Fail-open: Redis down allows traffic through ───────────────────────
  it("allows traffic when Redis is down and REDIS_FAILURE_MODE=open", async () => {
    vi.resetModules();
    mockRedisDown = true;
    app = await buildApp({ REDIS_FAILURE_MODE: "open" });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("proxied");
  });

  // ── 9. Fail-closed: Redis down blocks traffic ─────────────────────────────
  it("blocks traffic when Redis is down and REDIS_FAILURE_MODE=closed", async () => {
    vi.resetModules();
    mockRedisDown = true;
    app = await buildApp({ REDIS_FAILURE_MODE: "closed" });

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Service Unavailable");
  });

  // ── 10. /api/data prefix matching works for nested paths ─────────────────
  it("applies api_data policy to /api/data/:id (prefix match)", async () => {
    // api_data uses tokenBucket — mock hgetall to return a depleted bucket (0 tokens)
    // Also ensure global IP incr returns 1 (well under 300) so only route check blocks
    const { redis } = await import("../src/redis/client.js");
    redis.incr.mockResolvedValue(1);
    redis.hgetall.mockResolvedValue({ tokens: "0", lastRefill: String(Date.now()) });

    const res = await request(app).get("/api/data/d1");

    expect(res.status).toBe(429);
    expect(res.body.scope).toBe("ip_route");
    expect(res.body.route).toBe("api_data");
  });
});
