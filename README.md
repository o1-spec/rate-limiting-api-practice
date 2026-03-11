# Rate-Limited API Gateway

A production-style **API Gateway** built with Node.js, Express, and Redis that demonstrates real-world rate limiting patterns, reverse proxying, and observability.

---

## What This Project Is

A two-service system where all client traffic flows through a **gateway** before reaching a **backend API**. The gateway enforces rate limiting using Redis — blocked requests never reach the backend.

```
Client → Gateway :4000 → (rate limit check via Redis) → Backend :5001
```

---

## Features

### Gateway (`gateaway/`)
- ✅ **Three rate limiting algorithms** — fixed window, sliding window, token bucket — each selectable per route
- ✅ **Three-tier limiting** — Global IP → Per-user → Per-route, evaluated in sequence
- ✅ **Fixed window** — Redis `INCR` + `PEXPIRE`, lowest overhead, used for global checks
- ✅ **Sliding window** — Redis sorted set (`ZADD`/`ZREMRANGEBYSCORE`/`ZCARD`), no boundary burst exploit, used for auth routes
- ✅ **Token bucket** — Redis hash (`HGETALL`/`HSET`), burst-tolerant with steady refill, used for API routes
- ✅ **Algorithm dispatcher** — `runPolicy()` selects the right algorithm per route; change one field in `limits.js` to swap
- ✅ **Per-user limiting** — pass `x-user-id` header for user-scoped counters
- ✅ **Prefix-based route matching** — `/api/data/123` and `/users/42` resolve to the right policy automatically
- ✅ **Standard rate-limit headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`
- ✅ **Structured logging** — every decision logged with IP, user, scope, algorithm, remaining, limit
- ✅ **Redis fail-open / fail-closed** — configurable behaviour when Redis is down (`REDIS_FAILURE_MODE` env var)
- ✅ **Centralized error handling** — bad JSON, Redis failures, proxy errors, unexpected exceptions
- ✅ **Reverse proxy** — forwards allowed requests to backend, strips hop-by-hop headers, injects tracing headers
- ✅ **Admin endpoints** — live stats and configured rules
- ✅ **Health endpoint** — Redis ping, uptime, failure mode, backend target
- ✅ **10 automated tests** with Vitest (Redis and proxy fully mocked — no real services needed)

### Backend (`backend/`)
- ✅ Auth routes — login, register, logout (in-memory)
- ✅ User routes — list, get, patch
- ✅ Data routes — CRUD on in-memory records
- ✅ Health route

---

## Rate Limit Policies

| Scope | Applies To | Limit | Window | Algorithm |
|-------|-----------|-------|--------|-----------|
| Global IP | All traffic | 300 req | 60s | Fixed Window |
| Global User | Authenticated (`x-user-id` header) | 500 req | 60s | Fixed Window |
| Route | `POST /auth/login` | 5 req | 60s | Sliding Window |
| Route | `POST /auth/register` | 10 req | 60s | Sliding Window |
| Route | `GET/POST /api/data` | 100 req | 60s | Token Bucket (burst: 100, refill: 2/sec) |
| Route | `GET/PATCH /users` | 60 req | 60s | Fixed Window |

**Why different algorithms per route?**
- Global checks use **fixed window** — simplest, lowest Redis memory, global bursts are acceptable
- Auth routes use **sliding window** — eliminates the boundary exploit so brute-force attacks can't squeeze extra login attempts across a window edge
- API routes use **token bucket** — legitimate clients (SDKs, batch jobs) can spend saved-up capacity in a burst, then get smoothly throttled

---

## Project Structure

```
rate-limiting-api/
├── docker-compose.yml        # Redis container
├── README.md
├── ARCHITECTURE.md           # Deep-dive system design doc
├── .gitignore
│
├── gateaway/                 # Public-facing gateway (port 4000)
│   ├── package.json
│   ├── .env
│   ├── tests/
│   │   └── rateLimiter.test.js   # 10 Vitest tests
│   └── src/
│       ├── server.js             # Express app + admin/health routes
│       ├── admin/
│       │   └── stats.js          # In-memory counters: total/blocked/byRoute
│       ├── config/
│       │   └── limits.js         # All rate limit policies + algorithm per route
│       ├── limiter/
│       │   ├── fixedWindow.js    # INCR + PEXPIRE algorithm
│       │   ├── slidingWindow.js  # ZADD/ZREMRANGEBYSCORE/ZCARD algorithm
│       │   ├── tokenBucket.js    # HGETALL/HSET refill algorithm
│       │   ├── redisKeys.js      # Key builders: rl:fw / rl:sw / rl:tb
│       │   └── header.js         # X-RateLimit-* header setter
│       ├── middleware/
│       │   ├── rateLimiter.js    # Three-tier orchestrator + runPolicy() dispatcher
│       │   └── errorHandler.js   # Centralized error → HTTP status mapping
│       ├── proxy/
│       │   └── forwardRequest.js # Reverse proxy to backend (native fetch)
│       ├── redis/
│       │   └── client.js         # Single shared ioredis connection
│       └── utils/
│           ├── getClientIp.js    # X-Forwarded-For extraction
│           └── logger.js         # Structured per-decision log line
│
└── backend/                  # Internal API service (port 5001)
    ├── package.json
    ├── .env
    └── src/
        ├── server.js
        ├── data/
        │   └── mockData.js       # In-memory users + records
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

## Quick Start

### 1. Start Redis

```bash
docker-compose up -d
```

### 2. Start the backend

```bash
cd backend
npm install
npm run dev
# Running on http://localhost:5001
```

### 3. Start the gateway

```bash
cd gateaway
npm install
npm run dev
# Running on http://localhost:4000
```

---

## Environment Variables

### `gateway/.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Gateway port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `BACKEND_URL` | `http://localhost:5001` | Backend service URL |
| `REDIS_FAILURE_MODE` | `open` | `open` = allow traffic if Redis is down; `closed` = block all traffic |

### `backend/.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5001` | Backend port |

---

## Gateway Endpoints

| Method | Path | Rate Limited | Description |
|--------|------|-------------|-------------|
| `GET` | `/` | ❌ | Gateway info and policies |
| `GET` | `/gateway/health` | ❌ | Gateway health — Redis ping, uptime |
| `GET` | `/gateway/redis-test` | ❌ | Write/read a Redis test key |
| `GET` | `/admin/rate-limit-rules` | ❌ | All configured policies |
| `GET` | `/admin/gateway-stats` | ❌ | Live counters — total, blocked, by scope and route |
| `*` | `/*` | ✅ | All other routes are rate limited then proxied to backend |

## Backend Endpoints (proxied through gateway)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Backend health check |
| `POST` | `/auth/login` | Login — returns fake JWT token |
| `POST` | `/auth/register` | Register new user |
| `POST` | `/auth/logout` | Logout |
| `GET` | `/users` | List all users |
| `GET` | `/users/:id` | Get user by ID |
| `PATCH` | `/users/:id` | Update user fields |
| `GET` | `/api/data` | List all data records |
| `GET` | `/api/data/:id` | Get record by ID |
| `POST` | `/api/data` | Create new record |
| `DELETE` | `/api/data/:id` | Delete a record |

---

## Test the Rate Limiter

```bash
# Hit /auth/login 7 times — sliding window blocks after 5
for i in {1..7}; do
  curl -s -X POST http://localhost:4000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"alice@example.com","password":"password123"}'
  echo ""
done
```

```bash
# Test per-user limiting (pass x-user-id header)
curl http://localhost:4000/api/data \
  -H "x-user-id: u1"
```

```bash
# Hit /api/data rapidly — token bucket allows initial burst then throttles
for i in {1..15}; do
  curl -s http://localhost:4000/api/data
  echo ""
done
```

```bash
# Check live stats after sending requests
curl http://localhost:4000/admin/gateway-stats

# Check configured policies (includes algorithm per route)
curl http://localhost:4000/admin/rate-limit-rules
```

---

## Run Tests

```bash
cd gateaway
npm test
```

```
✓ allows a request under the global limit
✓ blocks a request that exceeds the global IP limit
✓ blocks /auth/login after 5 requests (route limit)       ← slidingWindow
✓ allows /auth/login when under the route limit           ← slidingWindow
✓ sets X-RateLimit-* headers on allowed responses
✓ sets Retry-After header when blocked
✓ applies per-user check when x-user-id header is present
✓ allows traffic when Redis is down and REDIS_FAILURE_MODE=open
✓ blocks traffic when Redis is down and REDIS_FAILURE_MODE=closed
✓ applies api_data policy to /api/data/:id (prefix match) ← tokenBucket

Tests  10 passed (10)
```

---

## How It Works

Every proxied request runs three sequential checks. A request is stopped as soon as it fails any tier.

```
Request
  │
  ├─► 1. GLOBAL IP CHECK          (fixedWindow)
  │       identifier: client IP
  │       limit: 300 req / 60s — applies to every route
  │       fail  → 429  { scope: "global_ip" }
  │
  ├─► 2. PER-USER CHECK           (fixedWindow, only if x-user-id header present)
  │       identifier: x-user-id value
  │       limit: 500 req / 60s
  │       fail  → 429  { scope: "global_user" }
  │
  └─► 3. ROUTE-LEVEL CHECK        (algorithm chosen per route in limits.js)
          /auth/login    →  5 req / 60s   slidingWindow  (no boundary exploit)
          /auth/register → 10 req / 60s   slidingWindow
          /api/data/*    → 100 req / 60s  tokenBucket    (burst-tolerant)
          /users/*       → 60 req / 60s   fixedWindow
          other paths    → skip tier 3, pass through
          fail → 429  { scope: "ip_route", route: "...", algorithm: "..." }

  ✅ All checks passed → set X-RateLimit-* headers → proxy to backend → return response
```

### Redis Key Patterns

```
# Fixed window — integer, self-deletes when TTL expires
rl:fw:ip:global:{ip}:{window}
rl:fw:user:global:{userId}:{window}
rl:fw:ip:route:{routeKey}:{ip}:{window}

# Sliding window — sorted set, timestamps pruned on every request
rl:sw:ip:route:{routeKey}:{ip}

# Token bucket — hash with { tokens, lastRefill }, refilled on every request
rl:tb:ip:route:{routeKey}:{ip}
```

### Inspect live Redis keys

```bash
docker exec -it rate-limit-redis redis-cli
> KEYS rl:*
> TTL  rl:fw:ip:route:auth_login:127.0.0.1:28693
> ZRANGE rl:sw:ip:route:auth_login:127.0.0.1 0 -1 WITHSCORES
> HGETALL rl:tb:ip:route:api_data:127.0.0.1
```

---

## Tech Stack

| Tool | Role |
|------|------|
| Node.js 20 | Runtime |
| Express 5 | HTTP framework (`/{*path}` wildcard syntax) |
| Redis 7 | Rate limit state store (integer, sorted set, hash) |
| ioredis | Redis client — pipeline support for atomic multi-command ops |
| Docker | Redis container |
| Vitest | Test framework (ESM-native) |
| Supertest | HTTP test client |
| dotenv | Config management |
| ES Modules | Module system |

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full deep-dive.
