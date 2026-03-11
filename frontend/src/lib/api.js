const BASE = "/api-gateway";

export async function fetchStats() {
  const res = await fetch(`${BASE}/admin/gateway-stats`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchRules() {
  const res = await fetch(`${BASE}/admin/rate-limit-rules`);
  if (!res.ok) throw new Error("Failed to fetch rules");
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(`${BASE}/gateway/health`);
  return res.json();
}

export async function fireRequest({ route, method, body, userId }) {
  const headers = { "Content-Type": "application/json" };
  if (userId) headers["x-user-id"] = userId;

  const options = { method, headers };
  if (!["GET", "HEAD"].includes(method) && body) {
    options.body = body;
  }

  const start = Date.now();
  const res = await fetch(`${BASE}${route}`, options);
  const duration = Date.now() - start;

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { raw: "(empty response)" };
  }

  return {
    status: res.status,
    ok: res.ok,
    data,
    headers: {
      limit:       res.headers.get("x-ratelimit-limit"),
      remaining:   res.headers.get("x-ratelimit-remaining"),
      reset:       res.headers.get("x-ratelimit-reset"),
      retryAfter:  res.headers.get("retry-after"),
    },
    duration,
    timestamp: new Date().toISOString(),
    route,
    method,
  };
}
