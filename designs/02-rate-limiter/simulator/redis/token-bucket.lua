--[[
  Token bucket, atomically.

  This is the answer to the race condition in Figure 4-14. Redis runs a Lua
  script as a single indivisible operation: no other client can observe or
  interleave with the state between the read and the write. That is what kills
  the race — not a lock.

  Why not a lock? Because a lock serialises every request through your rate
  limiter. You would fix correctness by destroying the latency budget the rate
  limiter existed to protect in the first place. The script is not "a cleverer
  lock"; there is no lock at all. The work is simply small enough to do in one
  hop, so there is no window to race through.

  Note there is no polling refill loop anywhere. Tokens are computed lazily from
  the elapsed time on each call. A background job topping up millions of buckets
  would be absurd; this costs nothing and is exactly equivalent.

  Usage:
    EVAL <script> 1 <key> <capacity> <refill_per_second> <now_ms> <cost>

  Returns: { allowed (1|0), tokens_remaining, retry_after_ms }

  In an interview, being able to say "one Lua script, so the read-check-write is
  atomic, and the TTL garbage-collects idle buckets for free" is the whole of the
  distributed section in two sentences.
]]

local key             = KEYS[1]
local capacity        = tonumber(ARGV[1])
local refill_rate     = tonumber(ARGV[2])  -- tokens per second
local now_ms          = tonumber(ARGV[3])
local cost            = tonumber(ARGV[4]) or 1

-- Read the bucket. A missing bucket is a full one: a client we have never seen
-- gets its full burst allowance.
local bucket        = redis.call('HMGET', key, 'tokens', 'updated_at')
local tokens        = tonumber(bucket[1])
local updated_at    = tonumber(bucket[2])

if tokens == nil then
  tokens     = capacity
  updated_at = now_ms
end

-- Lazily accrue the tokens earned since we last looked. Guard against a clock
-- that went backwards (NTP correction, or a caller passing a stale timestamp) —
-- without this, elapsed goes negative and silently *steals* tokens.
local elapsed_ms = math.max(0, now_ms - updated_at)
local refilled   = (elapsed_ms / 1000) * refill_rate

tokens = math.min(capacity, tokens + refilled)

local allowed        = tokens >= cost
local retry_after_ms = 0

if allowed then
  tokens = tokens - cost
else
  -- How long until enough tokens have accrued to serve this request? Hand it
  -- back so the caller can populate the X-Ratelimit-Retry-After header instead
  -- of making the client guess.
  retry_after_ms = math.ceil(((cost - tokens) / refill_rate) * 1000)
end

redis.call('HSET', key, 'tokens', tokens, 'updated_at', now_ms)

-- Expire idle buckets rather than keeping a row per client forever. A bucket is
-- worthless once it has had time to refill completely, because a full bucket is
-- indistinguishable from a brand new one. This is the whole memory story for a
-- token bucket at scale.
local ttl_seconds = math.ceil((capacity / refill_rate) * 2)
redis.call('EXPIRE', key, ttl_seconds)

return { allowed and 1 or 0, math.floor(tokens), retry_after_ms }
