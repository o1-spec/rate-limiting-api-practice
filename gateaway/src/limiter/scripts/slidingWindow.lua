--[[
  Atomic Sliding Window Rate Limiter
  ===================================
  Runs entirely inside Redis — no round-trips between gateway and Redis between
  steps. This is the key difference from the two-pipeline JS approach: the
  entire check-and-consume is one atomic operation.

  Why this matters for distributed gateways:
  -------------------------------------------
  Without atomicity, two gateway nodes can race:

    Gateway A:  ZCARD key  → count = 4  (under limit)
    Gateway B:  ZCARD key  → count = 4  (under limit — A hasn't written yet)
    Gateway A:  ZADD key   → count = 5  ✅ allowed
    Gateway B:  ZADD key   → count = 6  ✅ allowed — BUT SHOULD HAVE BEEN BLOCKED

  With this Lua script, Redis executes everything as a single command.
  No other client can interleave between the ZCARD and the ZADD.

  Arguments (ARGV):
    ARGV[1]  now           — current timestamp in ms
    ARGV[2]  windowStart   — now - windowMs (oldest allowed timestamp)
    ARGV[3]  windowMs      — window size in ms (for PEXPIRE)
    ARGV[4]  max           — maximum requests allowed in the window
    ARGV[5]  member        — unique member string for this request

  Keys (KEYS):
    KEYS[1]  — the sorted set key for this client+route

  Returns a flat table (becomes a Redis array reply):
    [1]  allowed        (1 = yes, 0 = no)
    [2]  count          (requests in window AFTER this one, if allowed)
    [3]  remaining      (max - count, floored at 0)
    [4]  oldestScore    (timestamp ms of oldest entry, for retryAfter calc)
    [5]  countBefore    (requests in window BEFORE this one)
--]]

local key         = KEYS[1]
local now         = tonumber(ARGV[1])
local windowStart = tonumber(ARGV[2])
local windowMs    = tonumber(ARGV[3])
local max         = tonumber(ARGV[4])
local member      = ARGV[5]

-- Step 1: Remove all entries outside the rolling window
redis.call("ZREMRANGEBYSCORE", key, 0, windowStart)

-- Step 2: Count how many requests are in the window RIGHT NOW (before adding)
local countBefore = redis.call("ZCARD", key)

-- Step 3: Deny immediately if already at limit — don't consume a slot
if countBefore >= max then
  -- Find the oldest entry to calculate retryAfter
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local oldestScore = now
  if #oldest >= 2 then
    oldestScore = tonumber(oldest[2])
  end
  return { 0, countBefore, 0, oldestScore, countBefore }
end

-- Step 4: Allowed — add this request's timestamp and reset TTL
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, windowMs)

local count = countBefore + 1
local remaining = max - count

-- Find oldest entry for retryAfter (now includes the entry we just added)
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local oldestScore = now
if #oldest >= 2 then
  oldestScore = tonumber(oldest[2])
end

return { 1, count, remaining, oldestScore, countBefore }
