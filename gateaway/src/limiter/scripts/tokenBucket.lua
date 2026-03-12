--[[
  Atomic Token Bucket Rate Limiter
  =================================
  The race condition this fixes:

    Without Lua — two gateways both read tokens=1 from Redis:
      Gateway A: HGETALL → tokens=1  → allowed, write tokens=0
      Gateway B: HGETALL → tokens=1  → allowed, write tokens=0
      Both allowed. Both wrong. Token was double-spent.

    With this Lua script — Redis serialises all access to the key:
      Gateway A: runs entire script → tokens=1 → allowed, writes tokens=0
      Gateway B: runs entire script → tokens=0 → blocked immediately

  Arguments (ARGV):
    ARGV[1]  now              — current timestamp in ms
    ARGV[2]  capacity         — max tokens the bucket can hold
    ARGV[3]  refillRate       — tokens added per interval
    ARGV[4]  refillIntervalMs — how often tokens are added
    ARGV[5]  ttlMs            — key TTL for idle cleanup

  Keys (KEYS):
    KEYS[1]  — the Redis hash key for this client+route
              Fields: tokens (float), lastRefill (timestamp ms)

  Returns a flat table:
    [1]  allowed          (1 = yes, 0 = no)
    [2]  tokens           (remaining after this request, floored)
    [3]  msUntilNextToken (0 if allowed, ms until 1 token refills if blocked)
    [4]  capacity         (echoed back for header generation)
--]]

local key             = KEYS[1]
local now             = tonumber(ARGV[1])
local capacity        = tonumber(ARGV[2])
local refillRate      = tonumber(ARGV[3])
local refillIntervalMs = tonumber(ARGV[4])
local ttlMs           = tonumber(ARGV[5])

-- Step 1: Load current bucket state
local raw = redis.call("HGETALL", key)

local tokens
local lastRefill

if #raw == 0 then
  -- Brand new client: start with a full bucket
  tokens     = capacity
  lastRefill = now
else
  -- Parse the hash fields (HGETALL returns [field, value, field, value, ...])
  local map = {}
  for i = 1, #raw, 2 do
    map[raw[i]] = raw[i + 1]
  end
  tokens     = tonumber(map["tokens"])     or capacity
  lastRefill = tonumber(map["lastRefill"]) or now
end

-- Step 2: Refill — calculate how many whole intervals have passed
local elapsed          = now - lastRefill
local intervalsElapsed = math.floor(elapsed / refillIntervalMs)
local tokensToAdd      = intervalsElapsed * refillRate

if tokensToAdd > 0 then
  tokens = math.min(capacity, tokens + tokensToAdd)
  -- Advance lastRefill by whole intervals only — preserves partial interval progress
  lastRefill = lastRefill + intervalsElapsed * refillIntervalMs
end

-- Step 3: Try to consume one token
local allowed = 0
if tokens >= 1 then
  tokens  = tokens - 1
  allowed = 1
end

-- Step 4: Persist updated state
redis.call("HSET", key, "tokens", tostring(tokens))
redis.call("HSET", key, "lastRefill", tostring(lastRefill))
redis.call("PEXPIRE", key, ttlMs)

-- How long until next token refills?
local msUntilNextToken = 0
if allowed == 0 then
  msUntilNextToken = refillIntervalMs - (now - lastRefill)
  if msUntilNextToken < 0 then msUntilNextToken = refillIntervalMs end
end

return { allowed, math.floor(tokens), msUntilNextToken, capacity }
