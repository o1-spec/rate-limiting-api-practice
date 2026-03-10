import express from "express";
import dotenv from "dotenv";
import { redis } from "./redis/client.js";
import { rateLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { forwardRequest } from "./proxy/forwardRequest.js";
import { getStats } from "./admin/stats.js";
import { limits } from "./config/limits.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5001";
const startTime = Date.now();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Gateway is running",
    service: "rate-limited-api-gateway",
    backend: BACKEND_URL,
    policies: {
      globalIp:      "300 req / 60s",
      globalUser:    "500 req / 60s  (authenticated traffic via x-user-id header)",
      auth_login:    "5 req / 60s",
      auth_register: "10 req / 60s",
      api_data:      "100 req / 60s",
      users:         "60 req / 60s",
    },
  });
});

app.get("/gateway/health", async (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  let redisStatus = "ok";
  try {
    await redis.ping();
  } catch {
    redisStatus = "unreachable";
  }

  const healthy = redisStatus === "ok";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    service: "rate-limited-api-gateway",
    uptime: `${uptimeSeconds}s`,
    redis: redisStatus,
    redisFailureMode: process.env.REDIS_FAILURE_MODE || "open",
    backend: BACKEND_URL,
    timestamp: new Date().toISOString(),
  });
});

app.get("/admin/rate-limit-rules", (req, res) => {
  res.json({
    description: "All active rate limiting policies for this gateway",
    globalIp: {
      description: "Applied to every request regardless of route",
      windowMs: limits.globalIp.windowMs,
      max: limits.globalIp.max,
      windowLabel: "60s",
    },
    globalUser: {
      description: "Applied to authenticated requests (x-user-id header present)",
      windowMs: limits.globalUser.windowMs,
      max: limits.globalUser.max,
      windowLabel: "60s",
    },
    routes: Object.entries(limits.routes).map(([key, policy]) => ({
      routeKey: key,
      windowMs: policy.windowMs,
      max: policy.max,
      scope: policy.scope,
      windowLabel: "60s",
    })),
    redisFailureMode: process.env.REDIS_FAILURE_MODE || "open",
  });
});

app.get("/admin/gateway-stats", (req, res) => {
  res.json(getStats());
});

app.get("/gateway/redis-test", async (req, res) => {
  await redis.set("gateway:test", "redis is working", "EX", 60);
  const value = await redis.get("gateway:test");
  res.json({ message: "Redis test successful", value });
});

app.use(rateLimiter);
app.all("/{*path}", forwardRequest);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 Gateway running on   http://localhost:${PORT}`);
  console.log(`📡 Proxying to backend  ${BACKEND_URL}`);
  console.log(`🏥 Health:              http://localhost:${PORT}/gateway/health`);
  console.log(`🔧 Admin rules:         http://localhost:${PORT}/admin/rate-limit-rules`);
  console.log(`📊 Admin stats:         http://localhost:${PORT}/admin/gateway-stats\n`);
});