const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5001";

export async function forwardRequest(req, res) {
  const targetUrl = `${BACKEND_URL}${req.originalUrl}`;

  const forwardedHeaders = {};
  const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ]);

  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      forwardedHeaders[key] = value;
    }
  }

  forwardedHeaders["x-forwarded-for"] =
    req.headers["x-forwarded-for"] || req.ip || "unknown";
  forwardedHeaders["x-forwarded-host"] = req.headers["host"] || "";
  forwardedHeaders["x-gateway"] = "rate-limited-api-gateway";

  const fetchOptions = {
    method: req.method,
    headers: forwardedHeaders,
  };

  if (!["GET", "HEAD"].includes(req.method)) {
    fetchOptions.body = JSON.stringify(req.body);
    fetchOptions.headers["content-type"] = "application/json";
  }

  try {
    const backendResponse = await fetch(targetUrl, fetchOptions);

    res.status(backendResponse.status);

    for (const [key, value] of backendResponse.headers.entries()) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    const data = await backendResponse.json();
    return res.json(data);
  } catch (error) {
    console.error(`[Proxy Error] ${req.method} ${targetUrl} →`, error.message);

    return res.status(502).json({
      error: "Bad Gateway",
      message: "The backend service is unavailable or returned an invalid response",
      target: targetUrl,
    });
  }
}