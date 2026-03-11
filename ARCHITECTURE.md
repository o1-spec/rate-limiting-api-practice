# System Architecture — Rate-Limited API Gateway

## Overview

This project is a **two-service system** that demonstrates how a production-style API gateway
works. All traffic from clients flows through the gateway first. The gateway enforces
**three-tier rate limiting** across three different algorithms, logs every decision, tracks
live stats, and proxies allowed requests to the backend. The backend never sees throttled
traffic — it only receives requests that have already passed all of the gateway's checks.

---

## High-Level Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENT                                 │
│              (curl, browser, frontend app, etc.)                │
└───────────────────────────┬─────────────────────────────────────┘
                            │  HTTP Request
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API GATEWAY  :4000                          │
│                                                                 │
│   ┌── Admin / Health routes (bypass rate limiting) ──────────┐ │
│   │  GET /gateway/health        Redis ping + uptime           │ │
│   │  GET /admin/rate-limit-rules  All active policies         │ │
│   │  GET /admin/gateway-stats     Live counters + block rate  │ │
│   └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│   ┌── Three-tier rate limiter (all proxied routes) ──────────┐ │
│   │  Tier 1: Global IP    300 req/min  fixedWindow           │ │
│   │  Tier 2: Per-user     500 req/min  fixedWindow           │ │
│   │          (only when x-user-id header is present)         │ │
│   │  Tier 3: Per-route    algorithm chosen per route         │ │
│   │          /auth/login    5 req/min  slidingWindow         │ │
│   │          /auth/register 10 req/min slidingWindow         │ │
│   │          /api/data/*   100 req/min tokenBucket           │ │
│   │          /users/*       60 req/min fixedWindow           │ │
│   └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│   ┌── Proxy (passes only if all tiers allowed) ──────────────┐ │
│   │  Forwards request to BACKEND:5001                        │ │
│   └───────────────────────────────────────────────────────────┘ │
└───────────┬────────────────────────────┬────────────────────────┘
            │  Redis commands             │  HTTP Proxy (fetch)
            ▼                            ▼
┌───────────────────┐       ┌────────────────────────────────────┐
│   Redis  :6379    │       │         BACKEND  :5001             │
│  (Docker)         │       │                                    │
│                   │       │  GET  /health                      │
│  rl:fw:*  integer │       │  POST /auth/login                  │
│  rl:sw:*  sorted  │       │  POST /auth/register               │
│           set     │       │  POST /auth/logout                 │
│  rl:tb:*  hash    │       │  GET  /users  /users/:id           │
│                   │       │  GET  /api/data  /api/data/:id     │
└───────────────────┘       └────────────────────────────────────┘
```

---

## Services

### 1. API Gateway (`gateaway/`) — Port 4000

The gateway is the **only public-facing service**. Clients never talk directly to the backend.

**Responsibilities:**
- Receive all incoming HTTP requests
- Extract the real client IP (`x-forwarded-for` or `req.ip`)
- Run three sequential rate limit tiers on every proxied request
- Choose the correct algorithm per route (fixed window / sliding window / token bucket)
- Log every rate limit decision with structured output
- Track live stats: total requests, blocked count, block rate, per-scope and per-route breakdowns
- Forward allowed requests to the backend via native `fetch`
- Return `429 Too Many Requests` with `Retry-After` and `X-RateLimit-*` headers when limits are exceeded
- Expose admin and health endpoints that bypass rate limiting
- Handle Redis failures gracefully via fail-open or fail-closed mode

**Does NOT:**
- Authenticate users
- Store any business data
- Know anything about the backend's domain logic

---

### 2. Backend API (`backend/`) — Port 5001

A standard REST API that handles business logic. It is **not publicly exposed** — only the
gateway talks to it.

**Responsibilities:**
- Handle auth routes (login, register, logout)
- Serve user data and data records
- Validate request inputs
- Return proper HTTP status codes and JSON responses

**Does NOT:**
- Perform any rate limiting
- Know about Redis
- Know about the gateway

---

### 3. Redis (`Docker`) — Port 6379

Used exclusively by the gateway as a **fast, shared state store** for rate limiting.
Each algorithm uses a different Redis data structure suited to its needs.

**Key patterns by algorithm:**

```
# Fixed Window — single integer key, auto-deletes at window end via TTL
rl:fw:{scope}:global:{identifier}:{window}
rl:fw:{scope}:route:{routeKey}:{identifier}:{window}

# Sliding Window — sorted set, member = request timestamp, score = ms timestamp
# Old entries pruned on every request with ZREMRANGEBYSCORE
rl:sw:{scope}:route:{routeKey}:{identifier}

# Token Bucket — hash with two fields: tokens + lastRefill timestamp
# State updated in place on every request
rl:tb:{scope}:route:{routeKey}:{identifier}
```

No cron jobs or cleanup workers are needed. Fixed window keys expire via TTL.
Sliding window keys use `PEXPIRE` reset on each request. Token bucket keys
use `PEXPIRE` to clean up idle clients.

---

## Rate Limiting Architecture

### Three-Tier Check

Every proxied request passes through three sequential checks in `rateLimiter.js`.
A request is blocked as soon as it fails any tier — it does not continue to the next.

```
Incoming request
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  TIER 1 — Global IP                                           │
│  identifier: client IP                                        │
│  algorithm:  fixedWindow                                      │
│  limit:      300 req / 60s  (applies to ALL routes)          │
│  Redis key:  rl:fw:ip:global:{ip}:{window}                   │
│                                                               │
│  Blocked → 429  { scope: "global_ip" }                       │
└───────────────────────────────────────────────────────────────┘
        │ allowed
        ▼
┌───────────────────────────────────────────────────────────────┐
│  TIER 2 — Per-user  (only when x-user-id header is present)   │
│  identifier: value of x-user-id header                        │
│  algorithm:  fixedWindow                                      │
│  limit:      500 req / 60s                                    │
│  Redis key:  rl:fw:user:global:{userId}:{window}             │
│                                                               │
│  Skipped entirely when request has no x-user-id header.      │
│  Blocked → 429  { scope: "global_user" }                     │
└───────────────────────────────────────────────────────────────┘
        │ allowed (or skipped)
        ▼
┌───────────────────────────────────────────────────────────────┐
│  TIER 3 — Route-level                                         │
│  identifier: IP (scope:"ip") or userId (scope:"user")         │
│  algorithm:  chosen per route in limits.js                    │
│                                                               │
│  /auth/login    → slidingWindow  max=5    key: rl:sw:ip:...  │
│  /auth/register → slidingWindow  max=10   key: rl:sw:ip:...  │
│  /api/data/*    → tokenBucket    cap=100  key: rl:tb:ip:...  │
│  /users/*       → fixedWindow    max=60   key: rl:fw:ip:...  │
│  other paths    → no policy, skip tier 3                     │
│                                                               │
│  Blocked → 429  { scope: "ip_route", route: routeKey }       │
└───────────────────────────────────────────────────────────────┘
        │ allowed
        ▼
  setRateLimitHeaders()   X-RateLimit-Limit/Remaining/Reset
        │
        ▼
  forwardRequest()  →  backend:5001
```

---

### Route Matching — Prefix-Based

`getRouteKey()` in `rateLimiter.js` maps paths to policy keys using prefix matching.
This means `/users/1`, `/users/2`, `/api/data/abc` all resolve to the same policy.

```
/auth/login       → "auth_login"    (exact match)
/auth/register    → "auth_register" (exact match)
/api/data         → "api_data"      (startsWith)
/api/data/123     → "api_data"      (startsWith — same policy)
/users            → "users"         (startsWith)
/users/1          → "users"         (startsWith — same policy)
/anything/else    → null            (global tiers only, no route policy)
```

---

### The Three Algorithms

All three algorithms return the same shape so `rateLimiter.js` is algorithm-agnostic:

```js
{ allowed: bool, limit: N, current: N, remaining: N, retryAfterMs: N }
```

#### Fixed Window (`limiter/fixedWindow.js`)

Best for: global checks, high-traffic routes where simplicity matters.

```
INCR  key              ← atomically increment counter
  └── if count === 1 → PEXPIRE key windowMs   (set TTL on first request)
PTTL  key              ← time remaining in window
```

- Redis data: single integer key
- Key rotates automatically via TTL — no cleanup needed
- Trade-off: clients can double their effective rate across a window boundary

#### Sliding Window (`limiter/slidingWindow.js`)

Best for: brute-force protection (login, register) where boundary exploits are unacceptable.

```
pipeline:
  ZREMRANGEBYSCORE key 0 (now - windowMs)   ← evict expired timestamps
  ZADD key score=now member="now:random"    ← record this request
  ZCARD key                                 ← count = requests in last windowMs
  PEXPIRE key windowMs                      ← TTL for idle key cleanup

ZRANGE key 0 0 WITHSCORES   ← oldest entry → used to calculate retryAfterMs
```

- Redis data: sorted set — score is timestamp ms, member is unique per request
- Window is always "last N seconds from right now" — no wall-clock boundary to exploit
- Trade-off: stores one entry per request (more memory than fixed window)

#### Token Bucket (`limiter/tokenBucket.js`)

Best for: API endpoints where legitimate clients burst (SDK retries, batch jobs).

```
HGETALL key                  ← load bucket: { tokens, lastRefill }
  └── if null → full bucket (tokens = capacity, lastRefill = now)

elapsed = now - lastRefill
tokensToAdd = floor(elapsed / refillIntervalMs) × refillRate
tokens = min(capacity, tokens + tokensToAdd)

allowed = tokens >= 1
if allowed → tokens -= 1

pipeline:
  HSET key tokens <new>
  HSET key lastRefill <new>
  PEXPIRE key ttlMs
```

- Redis data: hash with two fields (`tokens`, `lastRefill`)
- Clients who haven't requested recently accumulate saved capacity for bursts
- `api_data` config: capacity=100, refillRate=2/sec → 120 tokens/min sustained, with up to 100 burst

---

### Algorithm Dispatcher — `runPolicy()`

`rateLimiter.js` never calls an algorithm directly. It calls `runPolicy()`, which reads
`policy.algorithm` from `limits.js` and routes to the right implementation:

```js
runPolicy({ policy, identifier, routeKey, now })
  │
  ├── policy.algorithm === "slidingWindow" → consumeSlidingWindow()
  ├── policy.algorithm === "tokenBucket"   → consumeTokenBucket()
  └── default                              → consumeFixedWindow()
```

To change an algorithm for a route, edit one field in `limits.js`. Nothing else changes.

---

### Rate Limit Policies (`gateaway/src/config/limits.js`)

| Tier | Scope | Route | Limit | Window | Algorithm |
|------|-------|-------|-------|--------|-----------|
| Global | IP | All routes | 300 req | 60s | fixedWindow |
| Global | User | All routes | 500 req | 60s | fixedWindow |
| Route | IP | `/auth/login` | 5 req | 60s | slidingWindow |
| Route | IP | `/auth/register` | 10 req | 60s | slidingWindow |
| Route | IP | `/api/data/*` | 100 req | 60s | tokenBucket |
| Route | IP | `/users/*` | 60 req | 60s | fixedWindow |

---

### Response Headers

Set on every response that reaches tier 3 (allowed or blocked):

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Max requests allowed in the window |
| `X-RateLimit-Remaining` | Requests left before hitting the limit |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |
| `Retry-After` | Seconds to wait — only on `429` responses |

---

### Fail-Open / Fail-Closed (`REDIS_FAILURE_MODE`)

If Redis becomes unreachable, the gateway checks the `REDIS_FAILURE_MODE` env var:

```
REDIS_FAILURE_MODE=open    → log warning, call next()   (availability wins)
REDIS_FAILURE_MODE=closed  → return 503 immediately     (protection wins)
```

The default is `open`. Set to `closed` in environments where protecting the backend
matters more than uptime during a Redis outage.

---

### Observability

#### Structured Logging (`utils/logger.js`)

One log line per rate limit decision:

```
[2026-03-10T22:20:01Z] [RateLimit] POST /auth/login ip=1.2.3.4 user=anon scope=ip_route allowed=false ← BLOCKED remaining=0 limit=5
[2026-03-10T22:20:01Z] [RateLimit] GET  /api/data   ip=1.2.3.4 user=u42  scope=ip_route allowed=true  remaining=87 limit=100
```

#### In-Memory Stats (`admin/stats.js`)

Counters increment on every rate limit decision. Exposed at `GET /admin/gateway-stats`:

```json
{
  "totalRequests": 1042,
  "allowedRequests": 998,
  "blockedRequests": 44,
  "blockRate": "4.2%",
  "uptimeSeconds": 3600,
  "byScope": {
    "global_ip":   { "allowed": 998, "blocked": 12 },
    "global_user": { "allowed": 240, "blocked": 8  },
    "ip_route":    { "allowed": 890, "blocked": 24 }
  },
  "byRoute": {
    "auth_login":    { "allowed": 45,  "blocked": 18 },
    "auth_register": { "allowed": 12,  "blocked": 3  },
    "api_data":      { "allowed": 510, "blocked": 20 },
    "users":         { "allowed": 323, "blocked": 3  },
    "other":         { "allowed": 108, "blocked": 0  }
  }
}
```

---

## Proxy Forwarding (`gateway/src/proxy/forwardRequest.js`)

When a request passes all rate limit checks, the gateway:

1. Builds the target URL: `BACKEND_URL + req.originalUrl`
2. Strips **hop-by-hop headers** (connection, transfer-encoding, etc.)
3. Injects tracing headers:
   - `x-forwarded-for` — real client IP
   - `x-forwarded-host` — original host
   - `x-gateway` — identifies the gateway
4. Forwards the method, headers, and body via native Node.js `fetch`
5. Streams the backend's status code, headers, and JSON body back to the client
6. Returns `502 Bad Gateway` if the backend is unreachable

---

## Project File Structure

```
rate-limiting-api/
│
├── docker-compose.yml          # Redis service (port 6379)
├── ARCHITECTURE.md             # This file
├── README.md                   # Quick start + endpoint reference
├── .gitignore
│
├── gateaway/                   # Public-facing gateway service (port 4000)
│   ├── package.json
│   ├── .env                    # PORT, REDIS_URL, BACKEND_URL, REDIS_FAILURE_MODE
│   ├── tests/
│   │   └── rateLimiter.test.js # 10 Vitest tests (all algorithms + tiers)
│   └── src/
│       ├── server.js           # Express app + route wiring + admin endpoints
│       ├── config/
│       │   └── limits.js       # All rate limit policies + algorithm selection
│       ├── limiter/
│       │   ├── fixedWindow.js  # INCR + PEXPIRE algorithm
│       │   ├── slidingWindow.js # ZADD/ZREMRANGEBYSCORE/ZCARD algorithm
│       │   ├── tokenBucket.js  # HGETALL/HSET refill algorithm
│       │   ├── redisKeys.js    # Namespaced key builders (rl:fw / rl:sw / rl:tb)
│       │   └── header.js       # X-RateLimit-* header setter
│       ├── middleware/
│       │   ├── rateLimiter.js  # Three-tier orchestrator + runPolicy() dispatcher
│       │   └── errorHandler.js # Centralized error → status code mapping
│       ├── proxy/
│       │   └── forwardRequest.js  # HTTP proxy to backend (native fetch)
│       ├── redis/
│       │   └── client.js       # Single shared ioredis connection
│       ├── admin/
│       │   └── stats.js        # In-memory counters: total/blocked/blockRate/byRoute
│       └── utils/
│           ├── getClientIp.js  # X-Forwarded-For extraction
│           └── logger.js       # Structured per-decision log line
│
└── backend/                    # Internal API service (port 5001)
    ├── package.json
    ├── .env                    # PORT
    └── src/
        ├── server.js           # Express app, route mounting
        ├── data/
        │   └── mockData.js     # In-memory users + data records
        ├── routes/
        │   ├── authRoutes.js
        │   ├── dataRoutes.js
        │   ├── usersRoutes.js
        │   └── healthRoutes.js
        └── controllers/
            ├── authController.js
            ├── dataController.js
            ├── usersController.js
            └── healthController.js
```

---

## Data Flow Examples

### Example A — `POST /auth/login` (sliding window, blocked on 6th attempt)

```
1. Client sends:
   POST http://localhost:4000/auth/login
   Body: { "email": "alice@example.com", "password": "wrong" }

2. Gateway receives request
   └─ IP: 127.0.0.1  |  userId: null (no x-user-id header)
   └─ routeKey: "auth_login"

3. Tier 1 — Global IP check (fixedWindow)
   └─ Key: rl:fw:ip:global:127.0.0.1:28693
   └─ INCR → 1  (limit: 300)  ✅ allowed

4. Tier 2 — Per-user check
   └─ Skipped — no x-user-id header

5. Tier 3 — Route check for auth_login (slidingWindow)
   └─ Key: rl:sw:ip:route:auth_login:127.0.0.1
   └─ pipeline: ZREMRANGEBYSCORE / ZADD / ZCARD → count: 6  (limit: 5)  ❌ blocked

6. Gateway returns:
   HTTP 429
   Retry-After: 54
   X-RateLimit-Limit: 5
   X-RateLimit-Remaining: 0
   X-RateLimit-Reset: 1741600060
   Body: { "error": "Too Many Requests", "scope": "ip_route",
           "route": "auth_login", "algorithm": "slidingWindow",
           "retryAfterSeconds": 54 }

7. Log line emitted:
   [RateLimit] POST /auth/login ip=127.0.0.1 user=anon scope=ip_route allowed=false ← BLOCKED remaining=0 limit=5

   ← Backend never sees this request
```

---

### Example B — `GET /api/data/42` (token bucket, allowed with burst)

```
1. Client sends:
   GET http://localhost:4000/api/data/42
   Headers: x-user-id: u99

2. Gateway receives request
   └─ IP: 127.0.0.1  |  userId: "u99"
   └─ routeKey: "api_data"  (prefix match on /api/data/*)

3. Tier 1 — Global IP check (fixedWindow)
   └─ Key: rl:fw:ip:global:127.0.0.1:28693
   └─ INCR → 4  (limit: 300)  ✅ allowed

4. Tier 2 — Per-user check (fixedWindow)
   └─ Key: rl:fw:user:global:u99:28693
   └─ INCR → 12  (limit: 500)  ✅ allowed

5. Tier 3 — Route check for api_data (tokenBucket)
   └─ Key: rl:tb:ip:route:api_data:127.0.0.1
   └─ HGETALL → { tokens: "87", lastRefill: "1741600000000" }
   └─ elapsed=5000ms → +10 tokens refilled → tokens=97
   └─ consume 1 → tokens=96  ✅ allowed

6. Sets response headers:
   X-RateLimit-Limit: 100
   X-RateLimit-Remaining: 96
   X-RateLimit-Reset: 1741600001

7. Proxy forwards to:
   GET http://localhost:5001/api/data/42

8. Backend returns data record, gateway pipes response back to client
   Status: 200
```

---

## Technology Choices

| Technology | Role | Why |
|------------|------|-----|
| **Node.js 20 + Express 5** | Gateway + Backend runtime | Native `fetch`, async I/O, Express 5 wildcard fix (`/{*path}`) |
| **ioredis** | Redis client in gateway | Promise-based, supports `pipeline()` for atomic multi-command batches |
| **Redis 7** | Rate limit state store | Atomic INCR, sorted sets, hashes, built-in TTL, sub-ms ops |
| **Docker** | Redis container | Isolated, reproducible, no local Redis install needed |
| **Native `fetch`** | Proxy HTTP calls | Built-in to Node 18+, no extra dependency |
| **ES Modules** | Module system | Modern JS standard, clean `import`/`export` throughout |
| **dotenv v17** | Config management | Env vars isolated from code; auto-logs injected values on startup |
| **Vitest + supertest** | Testing | Fast, ESM-native test runner; supertest for real HTTP assertions |

---

## What This System Demonstrates

**Algorithms**
- **Fixed window** — simple INCR + PEXPIRE, lowest Redis overhead
- **Sliding window** — rolling sorted set, eliminates boundary burst exploits
- **Token bucket** — hash-based refill, tolerates bursty legitimate traffic
- **Algorithm dispatch** — `runPolicy()` selects the right algorithm per route; zero changes needed in `rateLimiter.js` to swap an algorithm

**Gateway patterns**
- **Three-tier rate limiting** — global IP → per-user → per-route, short-circuit on first failure
- **Prefix-based route matching** — `/users/1` and `/users/99` share one policy
- **Per-user limiting** — fair usage enforcement for authenticated traffic via `x-user-id`
- **Reverse proxy** — transparent forwarding with hop-by-hop header stripping and `x-forwarded-for` injection

**Reliability**
- **Fail-open / fail-closed** — configurable Redis failure behaviour via `REDIS_FAILURE_MODE` env var
- **Centralized error handling** — `errorHandler.js` maps all error types to correct HTTP status codes
- **Admin health endpoint** — `GET /gateway/health` reports Redis reachability and uptime

**Observability**
- **Structured logging** — one consistent log line per decision with IP, user, scope, result
- **Live stats** — in-memory counters for total/blocked/blockRate per scope and per route
- **Admin stats endpoint** — `GET /admin/gateway-stats` exposes the full counter snapshot

**Engineering practices**
- **Single source of truth** — all policies in `limits.js`; change algorithm or limit in one place
- **Namespace isolation** — `rl:fw:` / `rl:sw:` / `rl:tb:` prefixes prevent Redis key collisions
- **10 automated tests** — Vitest + mocked Redis; covers all tiers, both failure modes, prefix matching, all headers
- **Separation of concerns** — gateway knows nothing about business logic; backend knows nothing about rate limiting
