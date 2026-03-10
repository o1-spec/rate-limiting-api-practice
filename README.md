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

### Gateway (`gateway/`)
- ✅ **Fixed window rate limiting** — Redis `INCR` + `PEXPIRE` per time window
- ✅ **Three-tier limiting** — Global IP → Per-user → Per-route, in sequence
- ✅ **Route-level policies** — different limits per endpoint
- ✅ **Per-user limiting** — pass `x-user-id` header for user-scoped counters
- ✅ **Prefix-based route matching** — `/api/data/:id` maps to `api_data` policy automatically
- ✅ **Standard rate-limit headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`
- ✅ **Structured logging** — every decision logged with IP, user, scope, remaining, limit
- ✅ **Redis fail-open / fail-closed** — configurable behaviour when Redis is down
- ✅ **Centralized error handling** — bad JSON, Redis failures, proxy errors, unexpected exceptions
- ✅ **Reverse proxy** — forwards allowed requests to backend, strips hop-by-hop headers, injects tracing headers
- ✅ **Admin endpoints** — live stats and configured rules
- ✅ **Health endpoint** — Redis ping, uptime, backend target
- ✅ **10 automated tests** with Vitest (no real Redis or backend needed)

### Backend (`backend/`)
- ✅ Auth routes — login, register, logout (in-memory)
- ✅ User routes — list, get, patch
- ✅ Data routes — CRUD on in-memory records
- ✅ Health route

---

## Rate Limit Policies

| Scope | Applies To | Limit | Window |
|-------|-----------|-------|--------|
| Global IP | All traffic | 300 req | 60s |
| Global User | Authenticated (`x-user-id` header) | 500 req | 60s |
| Route | `POST /auth/login` | 5 req | 60s |
| Route | `POST /auth/register` | 10 req | 60s |
| Route | `GET/POST /api/data` | 100 req | 60s |
| Route | `GET/PATCH /users` | 60 req | 60s |

---

## Project Structure

```
rate-limiting-api/
├── docker-compose.yml        # Redis container
├── README.md
├── ARCHITECTURE.md           # Deep-dive system design doc
│
├── gateway/
│   ├── package.json
│   ├── .env
│   └── src/
│       ├── server.js
│       ├── admin/
│       │   └── stats.js          # In-memory request counters
│       ├── config/
│       │   └── limits.js         # All rate limit policies
│       ├── limiter/
│       │   ├── fixedWindow.js    # Core algorithm
│       │   ├── redisKeys.js      # Namespaced key builder
│       │   └── header.js         # X-RateLimit-* headers
│       ├── middleware/
│       │   ├── rateLimiter.js    # Three-tier check middleware
│       │   └── errorHandler.js   # Centralized error handling
│       ├── proxy/
│       │   └── forwardRequest.js # HTTP proxy to backend
│       ├── redis/
│       │   └── client.js         # ioredis connection
│       └── utils/
│           ├── getClientIp.js    # X-Forwarded-For extraction
│           └── logger.js         # Structured log lines
│
└── backend/
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
cd gateway
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
# Hit /auth/login 7 times — first 5 pass, last 2 are blocked
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
# Check live stats after sending requests
curl http://localhost:4000/admin/gateway-stats
```

```bash
# Inspect Redis keys live while hitting the gateway
docker exec -it rate-limit-redis redis-cli
> KEYS rl:*
> TTL rl:fw:ip:route:auth_login:127.0.0.1:28693
```

---

## Run Tests

```bash
cd gateway
npm test
```

```
✓ allows a request under the global limit
✓ blocks a request that exceeds the global IP limit
✓ blocks /auth/login after 5 requests (route limit)
✓ allows /auth/login when under the route limit
✓ sets X-RateLimit-* headers on allowed responses
✓ sets Retry-After header when blocked
✓ applies per-user check when x-user-id header is present
✓ allows traffic when Redis is down and REDIS_FAILURE_MODE=open
✓ blocks traffic when Redis is down and REDIS_FAILURE_MODE=closed
✓ applies api_data policy to /api/data/:id (prefix match)

Tests  10 passed (10)
```

---

## How It Works

Every request through the gateway runs three sequential checks:

```
Request
  │
  ├─► 1. GLOBAL IP CHECK
  │       limit: 300 req / 60s
  │       fail  → 429  { scope: "global_ip" }
  │
  ├─► 2. PER-USER CHECK  (only if x-user-id header present)
  │       limit: 500 req / 60s
  │       fail  → 429  { scope: "global_user" }
  │
  └─► 3. ROUTE-LEVEL CHECK  (only routes with a policy)
          /auth/login    → 5 req / 60s
          /auth/register → 10 req / 60s
          /api/data      → 100 req / 60s
          /users         → 60 req / 60s
          fail  → 429  { scope: "ip_route", route: "..." }

  ✅ All checks passed → proxy to backend → return response
```

Redis keys are namespaced and time-windowed:
```
rl:fw:ip:global:{ip}:{window}
rl:fw:ip:route:{routeKey}:{ip}:{window}
rl:fw:user:global:{userId}:{window}
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full deep-dive.

---

## Tech Stack

| Tool | Role |
|------|------|
| Node.js 20 | Runtime |
| Express 5 | HTTP framework |
| Redis 7 | Rate limit counter store |
| ioredis | Redis client |
| Docker | Redis container |
| Vitest | Test framework |
| Supertest | HTTP test client |
| dotenv | Config management |
| ES Modules | Module system |
