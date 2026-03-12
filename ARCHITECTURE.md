# System Architecture — Rate-Limited API Gateway

> Branch: `feat/atomic-implementation`
> Last updated: March 2026

---

## What Kind of System This Is

This is a **horizontally-scalable, stateless API gateway cluster with atomic distributed rate limiting backed by a shared Redis store**.

In plain terms:
- Multiple independent gateway processes handle requests
- None of them store any state themselves
- All of them read and write to the same Redis
- Redis Lua scripts make every rate limit decision atomic — no race conditions even when all three gateways fire simultaneously

This is the same architecture used by Kong, AWS API Gateway, and Cloudflare Workers.

---

## High-Level Architecture

```
                         CLIENT
                (curl / browser / frontend)
                            │
                            ▼
              ┌─────────────────────────┐
              │   nginx  :8080          │  ← load balancer
              │   round-robin           │    adds X-Upstream-Addr header
              └──────┬────────┬─────────┘
                     │        │
           ┌─────────┘        └──────────┐
           ▼                             ▼
  ┌─────────────────┐         ┌─────────────────┐
  │  gateway_a:4000 │         │  gateway_b:4001 │  ...gateway_c:4002
  │  (Node.js)      │         │  (Node.js)      │
  └────────┬────────┘         └────────┬────────┘
           │                           │
           └─────────┬─────────────────┘
                     │  Lua scripts (atomic)
                     ▼
              ┌─────────────────┐
              │   Redis  :6380  │  ← single source of truth
              │                 │    all rate limit state lives here
              │  rl:fw:*  int   │
              │  rl:sw:*  zset  │
              │  rl:tb:*  hash  │
              └─────────────────┘
                     │
                     ▼  (only if all rate checks pass)
              ┌─────────────────┐
              │  backend :5001  │  ← internal only, never public-facing
              └─────────────────┘
```

---

## Services (docker-compose.yml)

Six containers, one Docker network. They discover each other by service name — `redis`,
`backend`, `gateway_a` etc. are valid hostnames inside the network.

| Container | Host port | Internal port | Role |
|-----------|-----------|---------------|------|
| `nginx` | 8080 | 80 | Load balancer — round-robins to all 3 gateways |
| `gateway_a` | 4000 | 4000 | Gateway node 1 |
| `gateway_b` | 4001 | 4000 | Gateway node 2 |
| `gateway_c` | 4002 | 4000 | Gateway node 3 |
| `redis` | 6380 | 6379 | Rate limit state store |
| `backend` | 5001 | 5001 | Business logic API |

All three gateways run **identical code**. The only difference is the `GATEWAY_ID`
environment variable (`gateway_a` / `gateway_b` / `gateway_c`) which is purely for
logging — so you can see in the logs which node handled each request.

### Why three identical nodes?

Because the nodes are stateless (no in-process state between requests), you can:
- Add more nodes without changing anything else
- Lose a node and the other two keep working
- Deploy a new version by replacing nodes one at a time

This is called **horizontal scaling**.

---

## Request Lifecycle — Step by Step

### Step 1 — nginx receives the request

```
Client → nginx:8080
```

`nginx.conf` defines an upstream group:

```nginx
upstream gateways {
  server gateway_a:4000;
  server gateway_b:4000;
  server gateway_c:4000;
}
```

Nginx picks the next node in round-robin order and adds `X-Upstream-Addr` to the response
so you can see which node handled it.

---

### Step 2 — Express receives in server.js

`server.js` is the entry point of each gateway node. It:
- Reads `PORT`, `REDIS_URL`, `BACKEND_URL`, `GATEWAY_ID` from environment
- Mounts CORS (allows `localhost:3000`, exposes rate limit headers)
- Registers admin/health routes that **bypass** rate limiting
- Registers `rateLimiter` middleware for all other routes
- Registers `forwardRequest` catch-all proxy after the middleware

```javascript
app.use(rateLimiter);           // rate check on every proxied request
app.all("/{*path}", forwardRequest);  // proxy allowed requests to backend
```

The `GATEWAY_ID` env var appears in logs and the `/gateway/health` response so you
know which node you're talking to.

---

### Step 3 — rateLimiter.js runs three sequential checks

Every proxied request goes through `gateaway/src/middleware/rateLimiter.js`.
A request is **stopped at the first tier it fails** — it does not continue.

```
Request
  │
  ▼
TIER 1 — Global IP check (fixedWindow)
  identifier: client IP
  limit: 300 req / 60s — applies to every route
  key: rl:fw:ip:global:{ip}:{window}
  fail → 429 { scope: "global_ip" }
  │
  ▼ (only if allowed)
TIER 2 — Per-user check (fixedWindow)
  identifier: x-user-id header value
  limit: 500 req / 60s
  key: rl:fw:user:global:{userId}:{window}
  SKIPPED entirely when no x-user-id header is present
  fail → 429 { scope: "global_user" }
  │
  ▼ (only if allowed or skipped)
TIER 3 — Route-level check (algorithm per route)
  /auth/login    → slidingWindow  max=5    key: rl:sw:ip:route:auth_login:{ip}
  /auth/register → slidingWindow  max=10   key: rl:sw:ip:route:auth_register:{ip}
  /api/data/*    → tokenBucket    cap=100  key: rl:tb:ip:route:api_data:{ip}
  /users/*       → fixedWindow    max=60   key: rl:fw:ip:route:users:{ip}:{window}
  other paths    → no policy, skip tier 3
  fail → 429 { scope: "ip_route", route: routeKey, algorithm: "..." }
  │
  ▼ (all passed)
setRateLimitHeaders() → X-RateLimit-Limit / Remaining / Reset
  │
  ▼
forwardRequest() → backend:5001
```

The key function inside `rateLimiter.js` is `runPolicy()`. It reads `policy.algorithm`
and calls the right implementation. This means `rateLimiter.js` never needs to change
when you swap an algorithm — edit one field in `limits.js`:

```javascript
// rateLimiter.js never changes. Only limits.js changes.
runPolicy({ policy, identifier, routeKey, now })
  ├── "slidingWindow" → consumeSlidingWindow()
  ├── "tokenBucket"   → consumeTokenBucket()
  └── default         → consumeFixedWindow()
```

---

### Step 4 — Lua script executes atomically in Redis

This is the core of the `feat/atomic-implementation` branch.

**The problem Lua solves:**

Without atomic scripts, two gateway nodes racing on the same key can both allow a
request that should have been blocked:

```
Gateway A: ZCARD key → 4    (reads: under limit)
Gateway B: ZCARD key → 4    (reads: under limit — A hasn't written yet)
Gateway A: ZADD key  → 5    ✅ allowed
Gateway B: ZADD key  → 6    ✅ allowed  ← WRONG. Should have been blocked.
```

**With Lua:**

Redis executes Lua scripts as a single atomic operation. No other command from any
client can run between any two lines of the script.

```
Gateway A: runs slidingWindow.lua atomically → count=5 ✅
Gateway B: runs slidingWindow.lua atomically → sees A's ZADD, count=6 ❌ blocked
```

---

## Core Files — What Each One Does

### Infrastructure

#### `docker-compose.yml`
Defines all 6 containers and wires them together on a private Docker network.
The three gateways share `REDIS_URL: redis://redis:6379` — the hostname `redis`
resolves to the Redis container via Docker's internal DNS.

#### `nginx.conf`
Defines the `upstream gateways` block listing all three nodes.
Adds `X-Upstream-Addr` to every response so you can see which gateway handled the request.
Passes `X-Real-IP` and `X-Forwarded-For` so gateways see the real client IP, not nginx's IP.

#### `gateaway/Dockerfile` + `backend/Dockerfile`
`node:20-alpine` images. `npm install` then `node src/server.js`.
Used by `docker-compose.yml` `build:` directives.

---

### Gateway — Entry Point

#### `gateaway/src/server.js`
The Express application. Responsibilities:
- Reads all environment variables (`PORT`, `REDIS_URL`, `BACKEND_URL`, `GATEWAY_ID`, `REDIS_FAILURE_MODE`)
- Registers CORS — exposes `X-RateLimit-*` headers to the browser
- Mounts `rateLimiter` middleware before the proxy
- Admin endpoints that **do not** go through rate limiting:
  - `GET /gateway/health` — Redis ping, uptime, which node this is (`gatewayId`)
  - `GET /admin/rate-limit-rules` — live policy config read from `limits.js`
  - `GET /admin/gateway-stats` — live counters from `stats.js`
- Startup log prints `[gateway_a] running on :4000` so Docker logs identify each node

---

### Gateway — Configuration

#### `gateaway/src/config/limits.js`
**Single source of truth for all rate limit policies.**
This is the only file you edit to change a limit, add a route, or swap an algorithm.

```javascript
export const limits = {
  globalIp:   { windowMs, max, algorithm: "fixedWindow" },
  globalUser: { windowMs, max, algorithm: "fixedWindow" },
  routes: {
    auth_login:    { max: 5,   algorithm: "slidingWindow", ... },
    auth_register: { max: 10,  algorithm: "slidingWindow", ... },
    api_data:      { capacity: 100, algorithm: "tokenBucket", refillRate: 2, ... },
    users:         { max: 60,  algorithm: "fixedWindow",   ... },
  }
}
```

---

### Gateway — Middleware

#### `gateaway/src/middleware/rateLimiter.js`
The three-tier orchestrator. Runs on every proxied request.
- Extracts client IP via `getClientIp()`
- Extracts `x-user-id` header for per-user checks
- Calls `getRouteKey()` to map paths to policy keys using prefix matching
- Calls `runPolicy()` for each tier — the function is algorithm-agnostic
- Calls `recordRequest()` to update in-memory stats
- Calls `logRateLimit()` to emit a structured log line
- Sets `X-RateLimit-*` headers via `setRateLimitHeaders()`
- Returns `429` with `Retry-After` if any tier blocks

#### `gateaway/src/middleware/errorHandler.js`
Centralized Express error handler. Maps error types to correct HTTP status codes.
Catches bad JSON, Redis errors, proxy errors, and unexpected exceptions.

---

### Gateway — Redis Client

#### `gateaway/src/redis/client.js`
Creates a single shared `ioredis` connection. **Also registers the Lua scripts.**

```javascript
// Loads .lua files from disk at startup
const slidingWindowLua = readFileSync("limiter/scripts/slidingWindow.lua");
const tokenBucketLua   = readFileSync("limiter/scripts/tokenBucket.lua");

// Registers them as named commands on the redis instance
redis.defineCommand("slidingWindowConsume", { numberOfKeys: 1, lua: slidingWindowLua });
redis.defineCommand("tokenBucketConsume",   { numberOfKeys: 1, lua: tokenBucketLua   });
```

`defineCommand` makes ioredis call `EVALSHA` on every invocation (uses a cached SHA
of the script). If Redis restarts and loses the cache, ioredis automatically retries
with `EVAL` (full source). From this point, calling `redis.slidingWindowConsume(...)`
is identical to calling any native Redis command.

---

### Gateway — Algorithms

All three algorithm functions return the same shape so the middleware is algorithm-agnostic:

```javascript
{ allowed: bool, limit: N, current: N, remaining: N, retryAfterMs: N }
```

#### `gateaway/src/limiter/fixedWindow.js`
The simplest algorithm. Two Redis commands:

```
INCR key          ← atomically increment counter
  if count === 1 → PEXPIRE key windowMs   ← set TTL on first request only
PTTL key          ← remaining time in window → retryAfterMs
```

- Redis structure: single integer key
- Key auto-deletes when TTL expires — no cleanup needed
- **Trade-off:** clients can double their rate by firing across a window boundary
- **Used for:** global IP (300/min), global user (500/min), `/users` (60/min)
- `INCR` is atomic on its own — no Lua needed here

#### `gateaway/src/limiter/slidingWindow.js`
Backed by `limiter/scripts/slidingWindow.lua`. The Lua script runs atomically:

```
ZREMRANGEBYSCORE key 0 windowStart   ← evict timestamps older than window
ZCARD key                            ← count = requests in last windowMs RIGHT NOW
if count >= max → return blocked     ← check BEFORE adding — no slot wasted
ZADD key score=now member="ts:rand"  ← record this request
PEXPIRE key windowMs                 ← reset idle TTL
ZRANGE key 0 0 WITHSCORES           ← oldest entry → calculate retryAfterMs
```

- Redis structure: sorted set — score is ms timestamp, member is unique per request
- Window is always "last 60s from right now" — no wall-clock boundary to exploit
- **Trade-off:** stores one entry per request (more Redis memory than fixed window)
- **Used for:** `/auth/login` (5/min), `/auth/register` (10/min) — brute-force protection

#### `gateaway/src/limiter/tokenBucket.js`
Backed by `limiter/scripts/tokenBucket.lua`. The Lua script runs atomically:

```
HGETALL key                          ← load { tokens, lastRefill }
  if empty → start with full bucket  ← new client gets full capacity
elapsed = now - lastRefill
intervals = floor(elapsed / refillIntervalMs)
tokens = min(capacity, tokens + intervals × refillRate)  ← refill
lastRefill += intervals × refillIntervalMs               ← advance clock (whole intervals only)
if tokens >= 1 → tokens -= 1 → allowed
HSET key tokens <new> lastRefill <new>
PEXPIRE key ttlMs
```

- Redis structure: hash with two fields — `tokens` (float) and `lastRefill` (ms timestamp)
- Clients who haven't requested recently accumulate capacity for a burst
- `lastRefill` advances by **whole intervals only** — partial interval progress is preserved,
  preventing token drift over long periods
- **Trade-off:** more complex logic, requires storing state per client
- **Used for:** `/api/data` (capacity=100, refill=2/sec — allows 100-request burst then 120/min sustained)

#### `gateaway/src/limiter/redisKeys.js`
Builds namespaced Redis keys. Three prefixes prevent collisions:

```
rl:fw:{scope}:global:{identifier}:{window}       ← fixed window, global tier
rl:fw:{scope}:route:{routeKey}:{identifier}:{window} ← fixed window, route tier
rl:sw:{scope}:route:{routeKey}:{identifier}      ← sliding window (no window segment)
rl:tb:{scope}:route:{routeKey}:{identifier}      ← token bucket (no window segment)
```

Fixed window keys include a `{window}` segment (e.g. `28693` = `floor(now / windowMs)`)
so the key naturally rotates at the end of each window without any cleanup.

#### `gateaway/src/limiter/header.js`
Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`
on the Express response object. Called after every allowed tier-3 check.

---

### Gateway — Lua Scripts (NEW in feat/atomic-implementation)

#### `gateaway/src/limiter/scripts/slidingWindow.lua`
Atomic sliding window check-and-consume. Receives: key, now, windowStart, windowMs,
max, member. Returns: `[allowed, count, remaining, oldestScore, countBefore]`.

The entire ZREMRANGEBYSCORE → ZCARD → ZADD sequence is one Redis command.
No other client can observe the state between the check (ZCARD) and the write (ZADD).

#### `gateaway/src/limiter/scripts/tokenBucket.lua`
Atomic token bucket check-and-consume. Receives: key, now, capacity, refillRate,
refillIntervalMs, ttlMs. Returns: `[allowed, tokens, msUntilNextToken, capacity]`.

The entire HGETALL → refill calculation → HSET sequence is one Redis command.
Eliminates the double-spend race condition where two gateways both read `tokens=1`
and both allow the request.

---

### Gateway — Proxy

#### `gateaway/src/proxy/forwardRequest.js`
Reverse-proxies allowed requests to the backend using native `fetch`.

1. Builds target URL: `BACKEND_URL + req.originalUrl`
2. Strips **hop-by-hop headers**: `connection`, `keep-alive`, `transfer-encoding`,
   `upgrade`, `host`, `content-length` (content-length is recalculated by fetch
   after re-serializing the body — mismatches caused `request aborted` on the backend)
3. Injects tracing headers: `x-forwarded-for`, `x-forwarded-host`, `x-gateway`
4. Re-serializes body as `JSON.stringify(req.body)` for POST/PATCH/PUT
5. Pipes backend's status code, headers, and body back to the client
6. Returns `502 Bad Gateway` if backend is unreachable

---

### Gateway — Admin & Observability

#### `gateaway/src/admin/stats.js`
In-memory counters. Incremented on every rate limit decision by `recordRequest()`.
Exposed at `GET /admin/gateway-stats`.

Also imports `limits.js` and includes a `rules` field in `getStats()` so the
Dashboard can show the correct algorithm badge per route without a separate API call.

```json
{
  "totalRequests": 1042,
  "allowedRequests": 998,
  "blockedRequests": 44,
  "blockRate": "4.2%",
  "byScope": { "global_ip": {...}, "global_user": {...}, "ip_route": {...} },
  "byRoute": { "auth_login": {...}, "api_data": {...}, ... },
  "rules": { "auth_login": { "algorithm": "slidingWindow" }, ... }
}
```

Note: these counters are **per node** and reset on restart. In production you'd
aggregate stats across nodes into a shared store (Redis or a TSDB).

#### `gateaway/src/utils/logger.js`
Emits one structured log line per rate limit decision:

```
[2026-03-12T08:43:00Z] [RateLimit] POST /auth/login ip=127.0.0.1 user=anon scope=ip_route allowed=false ← BLOCKED remaining=0 limit=5
```

#### `gateaway/src/utils/getClientIp.js`
Extracts the real client IP from `X-Forwarded-For` header (set by nginx) or falls
back to `req.ip`. Important when running behind a load balancer — without this,
every request would appear to come from nginx's internal IP.

---

### Backend

#### `backend/src/server.js`
Plain Express app. Mounts auth, data, user, and health routers.
Knows nothing about rate limiting, Redis, or the gateway.

#### `backend/src/data/mockData.js`
In-memory arrays of users and data records. No database — intentional for a
learning project so setup is instant.

#### `backend/src/routes/` + `backend/src/controllers/`
Standard MVC split. Routes define paths, controllers handle logic.
- `authController` — login (returns fake JWT), register, logout
- `dataController` — CRUD on data records
- `usersController` — list, get, patch users
- `healthController` — returns 200 OK with uptime

---

## Redis Data Structures — Summary

| Algorithm | Structure | Fields | Cleanup |
|-----------|-----------|--------|---------|
| Fixed Window | String (integer) | counter | Auto via TTL |
| Sliding Window | Sorted Set | score=ms timestamp, member=unique ID | ZREMRANGEBYSCORE on each request + PEXPIRE |
| Token Bucket | Hash | `tokens`, `lastRefill` | PEXPIRE on each request |

---

## Failure Modes

### Redis goes down
Controlled by `REDIS_FAILURE_MODE` env var in each gateway container:

```
open   → log warning, call next() — traffic passes through (availability wins)
closed → return 503 immediately   — all traffic blocked (protection wins)
```

Default is `open`. The gateway catches Redis errors in the `catch` block of
`rateLimiter.js` and checks this env var.

### A gateway node goes down
Nginx will attempt to route to it and get a connection refused. By default nginx
marks it as temporarily unavailable and retries the next upstream. Add
`max_fails=1 fail_timeout=10s` to the upstream config for automatic exclusion.

### Backend goes down
`forwardRequest.js` catches fetch errors and returns `502 Bad Gateway`.
The gateway keeps running and rate limiting correctly — it just returns 502
for all proxied requests until the backend recovers.

---

## Project File Map

```
rate-limiting-api/
│
├── docker-compose.yml              6 services: nginx, 3 gateways, redis, backend
├── nginx.conf                      round-robin upstream + X-Upstream-Addr header
├── ARCHITECTURE.md                 this file
├── README.md                       quick start + endpoint reference
│
├── gateaway/
│   ├── Dockerfile                  node:20-alpine — builds the gateway image
│   ├── .env                        PORT, REDIS_URL, BACKEND_URL, REDIS_FAILURE_MODE
│   ├── tests/
│   │   └── rateLimiter.test.js     10 Vitest tests (all algorithms, tiers, failure modes)
│   └── src/
│       ├── server.js               Express app, env vars, admin routes, startup log
│       ├── config/
│       │   └── limits.js           ALL rate limit policies — edit here to change anything
│       ├── limiter/
│       │   ├── scripts/
│       │   │   ├── slidingWindow.lua   ATOMIC: ZREMRANGEBYSCORE→ZCARD→ZADD in one command
│       │   │   └── tokenBucket.lua     ATOMIC: HGETALL→refill→HSET in one command
│       │   ├── fixedWindow.js      INCR + PEXPIRE (atomic by default, no Lua needed)
│       │   ├── slidingWindow.js    calls redis.slidingWindowConsume Lua command
│       │   ├── tokenBucket.js      calls redis.tokenBucketConsume Lua command
│       │   ├── redisKeys.js        key builders: rl:fw / rl:sw / rl:tb namespaces
│       │   └── header.js           sets X-RateLimit-* headers on the response
│       ├── middleware/
│       │   ├── rateLimiter.js      3-tier orchestrator + runPolicy() algorithm dispatcher
│       │   └── errorHandler.js     centralized error → HTTP status mapping
│       ├── proxy/
│       │   └── forwardRequest.js   strips hop-by-hop headers, proxies to backend
│       ├── redis/
│       │   └── client.js           ioredis connection + defineCommand for Lua scripts
│       ├── admin/
│       │   └── stats.js            in-memory counters, live rules snapshot for dashboard
│       └── utils/
│           ├── getClientIp.js      X-Forwarded-For extraction (real IP behind nginx)
│           └── logger.js           structured log line per rate limit decision
│
└── backend/
    ├── Dockerfile                  node:20-alpine — builds the backend image
    ├── .env                        PORT
    └── src/
        ├── server.js               Express app, mounts all routers
        ├── data/
        │   └── mockData.js         in-memory users + data records (no database)
        ├── routes/
        │   ├── authRoutes.js
        │   ├── dataRoutes.js
        │   ├── usersRoutes.js
        │   └── healthRoutes.js
        └── controllers/
            ├── authController.js   login, register, logout
            ├── dataController.js   CRUD on data records
            ├── usersController.js  list, get, patch users
            └── healthController.js returns 200 + uptime
```

---

## Key Concepts to Study

| Concept | Where to look in this codebase |
|---------|-------------------------------|
| Atomic Redis operations | `slidingWindow.lua`, `tokenBucket.lua`, `redis/client.js` |
| Race condition (the bug Lua fixes) | Comments at top of both `.lua` files |
| Stateless horizontal scaling | `docker-compose.yml` — 3 identical gateway services |
| Shared state pattern | All 3 gateways use `REDIS_URL: redis://redis:6379` |
| Reverse proxy | `proxy/forwardRequest.js` |
| Hop-by-hop header stripping | `HOP_BY_HOP` set in `forwardRequest.js` |
| Three-tier middleware | `middleware/rateLimiter.js` — `runPolicy()` function |
| Strategy pattern | `runPolicy()` dispatches to any algorithm based on config |
| Fail-open / fail-closed | `rateLimiter.js` catch block + `REDIS_FAILURE_MODE` env var |
| Redis sorted set | `slidingWindow.lua` — ZADD, ZCARD, ZREMRANGEBYSCORE, ZRANGE |
| Redis hash | `tokenBucket.lua` — HGETALL, HSET |
| TTL-based cleanup | Every algorithm calls PEXPIRE — no cron jobs needed |
| Load balancing | `nginx.conf` — upstream block + round-robin |
| Docker networking | `docker-compose.yml` — service names as hostnames |
| Environment-based config | `limits.js` + `.env` — no hardcoded values in logic |
