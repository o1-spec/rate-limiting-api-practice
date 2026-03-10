# System Architecture — Rate-Limited API Gateway

## Overview

This project is a **two-service system** that demonstrates how a real API gateway works.
All traffic from clients flows through the gateway first. The gateway enforces rate limiting
using Redis, then proxies allowed requests to the backend. The backend never sees throttled
traffic — it only receives requests that have already passed the gateway's checks.

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
│   1. Extract client IP (x-forwarded-for or req.ip)             │
│   2. Check GLOBAL IP limit  → 300 req / min                    │
│   3. Check ROUTE-LEVEL limit (if route has a policy)           │
│   4. If any limit exceeded  → return 429, stop here            │
│   5. If allowed             → forward request to backend        │
└───────────┬────────────────────────────┬────────────────────────┘
            │  Redis INCR + PEXPIRE      │  HTTP Proxy (fetch)
            ▼                            ▼
┌───────────────────┐       ┌────────────────────────────────────┐
│   Redis  :6379    │       │         BACKEND  :5001             │
│  (Docker)         │       │                                    │
│                   │       │  /health                           │
│  Rate limit       │       │  /auth/login                       │
│  counters stored  │       │  /auth/register                    │
│  as namespaced    │       │  /auth/logout                      │
│  keys with TTL    │       │  /users  /users/:id                │
│                   │       │  /api/data  /api/data/:id          │
└───────────────────┘       └────────────────────────────────────┘
```

---

## Services

### 1. API Gateway (`gateway/`) — Port 4000

The gateway is the **only public-facing service**. Clients never talk directly to the backend.

**Responsibilities:**
- Receive all incoming HTTP requests
- Extract the real client IP address
- Apply rate limiting rules via Redis
- Forward allowed requests to the backend
- Return `429 Too Many Requests` when limits are exceeded
- Set standard rate limit response headers on every response

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

Used exclusively by the gateway as a **fast, shared counter store** for rate limiting.

**Key pattern:**
```
rl:fw:{scope}:global:{ip}:{window}        ← global IP counter
rl:fw:{scope}:route:{routeKey}:{ip}:{window}  ← per-route counter
```

Each key has an automatic TTL equal to the window duration. When the TTL expires, the
counter resets naturally — no cron jobs or cleanup needed.

---

## Rate Limiting Architecture

### Algorithm: Fixed Window Counter

For each request the gateway:

1. Calculates the current **time window** index:
   ```js
   const window = Math.floor(Date.now() / windowMs);
   ```
2. Builds a **namespaced Redis key** for that IP + window
3. Calls **Redis INCR** — atomically increments the counter
4. On first increment (count === 1), sets **PEXPIRE** to lock the TTL to the window
5. Compares the counter to the configured `max`
6. Returns `allowed: true/false` with remaining count and TTL

### Two-Tier Check

Every request goes through **two sequential rate limit checks**:

```
Request
  │
  ├─► GLOBAL CHECK  (all IPs, all routes)
  │     limit: 300 req / 60s
  │     key:   rl:fw:ip:global:{ip}:{window}
  │     fail → 429 scope: "global_ip"
  │
  └─► ROUTE CHECK  (only routes with a policy)
        /auth/login  → 5 req / 60s
        /api/data    → 100 req / 60s
        other routes → skip, pass through
        fail → 429 scope: "ip_route"
```

### Rate Limit Policies (`gateway/src/config/limits.js`)

| Scope | Route | Limit | Window |
|-------|-------|-------|--------|
| Global IP | All routes | 300 req | 60s |
| Route | `POST /auth/login` | 5 req | 60s |
| Route | `GET /api/data` | 100 req | 60s |

### Response Headers (set on every proxied response)

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Max requests allowed in the window |
| `X-RateLimit-Remaining` | Requests left before hitting the limit |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds to wait (only on 429 responses) |

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
├── docker-compose.yml          # Redis service
├── ARCHITECTURE.md             # This file
│
├── gateway/                    # Public-facing gateway service
│   ├── package.json
│   ├── .env                    # PORT, REDIS_URL, BACKEND_URL
│   └── src/
│       ├── server.js           # Express app, route wiring
│       ├── config/
│       │   └── limits.js       # All rate limit policies
│       ├── limiter/
│       │   ├── fixedWindow.js  # Core algorithm (INCR + PEXPIRE)
│       │   ├── redisKeys.js    # Namespaced key builder
│       │   └── header.js       # X-RateLimit-* header setter
│       ├── middleware/
│       │   └── rateLimiter.js  # Two-tier check middleware
│       ├── proxy/
│       │   └── forwardRequest.js  # HTTP proxy to backend
│       ├── redis/
│       │   └── client.js       # ioredis connection
│       └── utils/
│           └── getClientIp.js  # X-Forwarded-For extraction
│
└── backend/                    # Internal API service
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

## Data Flow Example — `POST /auth/login`

```
1. Client sends:
   POST http://localhost:4000/auth/login
   Body: { "email": "alice@example.com", "password": "password123" }

2. Gateway receives request
   └─ Extracts IP: 127.0.0.1

3. Global IP check (Redis)
   └─ Key: rl:fw:ip:global:127.0.0.1:28693
   └─ INCR → count: 1  (limit: 300)  ✅ allowed

4. Route check for auth_login (Redis)
   └─ Key: rl:fw:ip:route:auth_login:127.0.0.1:28693
   └─ INCR → count: 1  (limit: 5)    ✅ allowed

5. Sets response headers:
   X-RateLimit-Limit: 5
   X-RateLimit-Remaining: 4
   X-RateLimit-Reset: 1741600060

6. Proxy forwards to:
   POST http://localhost:5001/auth/login

7. Backend processes login
   └─ Finds account in registeredAccounts[]
   └─ Returns: { token, user }

8. Gateway streams response back to client
   └─ Status: 200
   └─ Body: { "message": "Login successful.", "token": "...", "user": {...} }
```

---

## Technology Choices

| Technology | Role | Why |
|------------|------|-----|
| **Node.js + Express** | Gateway + Backend runtime | Lightweight, fast, async I/O |
| **ioredis** | Redis client in gateway | Reliable, Promise-based, supports pipelining |
| **Redis** | Rate limit counter store | Atomic INCR, built-in TTL, sub-millisecond ops |
| **Docker** | Redis container | Isolated, reproducible, no local install needed |
| **Native fetch** | Proxy HTTP calls | Built-in to Node 18+, no extra dependency |
| **ES Modules** | Module system | Modern JS standard, clean import/export |
| **dotenv** | Config management | Keep secrets and env config out of code |

---

## What This System Demonstrates

- **Gateway pattern** — single entry point for all traffic
- **Rate limiting** — protecting APIs from abuse and overuse
- **Fixed window counter algorithm** — simple, efficient, Redis-native
- **Two-tier limiting** — global + per-route policies on the same request
- **Reverse proxy** — transparent forwarding with header propagation
- **Separation of concerns** — gateway knows nothing about business logic, backend knows nothing about rate limiting
- **Namespace isolation** — Redis keys are prefixed (`rl:`) so multiple projects can share one Redis instance safely
