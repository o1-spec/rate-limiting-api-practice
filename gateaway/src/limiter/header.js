export function setRateLimitHeaders(res, result) {
  res.setHeader("X-RateLimit-Limit", result.limit ?? 0);
  res.setHeader("X-RateLimit-Remaining", result.remaining ?? 0);
  res.setHeader(
    "X-RateLimit-Reset",
    Math.ceil((Date.now() + (result.retryAfterMs ?? 0)) / 1000)
  );
}