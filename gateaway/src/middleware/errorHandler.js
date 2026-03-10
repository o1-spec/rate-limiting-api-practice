/**
 * Centralized error-handling middleware.
 * Must be mounted LAST in server.js — after all routes.
 *
 * Handles:
 *   - Bad JSON body (SyntaxError from express.json())
 *   - Redis connection/command failures
 *   - Proxy / fetch failures
 *   - Unexpected exceptions
 */

export function errorHandler(err, req, res, next) {
  const timestamp = new Date().toISOString();

  // ── Bad JSON body ────────────────────────────────────────────────────────────
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.error(`[${timestamp}] [Error] Bad JSON body: ${req.method} ${req.path}`);
    return res.status(400).json({
      error: "Bad Request",
      message: "Request body contains invalid JSON",
    });
  }

  // ── Redis errors ─────────────────────────────────────────────────────────────
  if (err.name === "ReplyError" || err.message?.includes("Redis")) {
    console.error(`[${timestamp}] [Error] Redis failure: ${err.message}`);
    return res.status(503).json({
      error: "Service Unavailable",
      message: "Rate limiting service is temporarily unavailable",
    });
  }

  // ── Proxy / fetch errors ──────────────────────────────────────────────────────
  if (err.name === "TypeError" && err.message?.includes("fetch")) {
    console.error(`[${timestamp}] [Error] Proxy fetch failure: ${err.message}`);
    return res.status(502).json({
      error: "Bad Gateway",
      message: "Could not reach the backend service",
    });
  }

  // ── Generic / unexpected ──────────────────────────────────────────────────────
  console.error(`[${timestamp}] [Error] Unhandled exception: ${err.stack || err.message}`);
  return res.status(500).json({
    error: "Internal Server Error",
    message: "An unexpected error occurred in the gateway",
  });
}
