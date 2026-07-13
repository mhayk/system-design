--[[
  Sliding window log, atomically, on a Redis sorted set.

  This is the "sorted sets" strategy the book mentions alongside the Lua script
  as a way to beat the race condition. In fact you want both: the sorted set is
  the data structure, and the script is what makes the read-check-write
  indivisible.

  The mapping from algorithm to Redis is unusually direct — worth knowing cold,
  because interviewers ask:

    evict outdated timestamps  ->  ZREMRANGEBYSCORE key -inf (now - window)
    count what is left         ->  ZCARD key
    record the new request     ->  ZADD key now now
    garbage-collect idle keys  ->  EXPIRE key window

  Usage:
    EVAL <script> 1 <key> <limit> <window_ms> <now_ms> <member>

  Returns: { allowed (1|0), count_in_window, retry_after_ms }

  A note on `member`: a sorted set is a *set*, so two requests landing on the
  same millisecond would collide and the second would silently overwrite the
  first — under-counting exactly when you are under load and can least afford
  it. Pass a unique member (a request id, or now_ms .. '-' .. random) rather
  than the timestamp alone.
]]

local key       = KEYS[1]
local limit     = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now_ms    = tonumber(ARGV[3])
local member    = ARGV[4] or tostring(now_ms)

-- Drop everything that has fallen out of the rolling window.
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now_ms, member)
  -- The set is worthless once every entry in it has aged out.
  redis.call('PEXPIRE', key, window_ms)
  return { 1, count + 1, 0 }
end

--[[
  Over the limit.

  NOTE — a deliberate divergence from the book, and worth being able to defend.

  The book's version appends the timestamp *even for a rejected request* ("this
  request is rejected even though the timestamp remains in the log"), which is
  what makes the algorithm memory-hungry: a client hammering you at 100x your
  limit costs you 100x the memory. Our in-memory simulator reproduces that
  faithfully, because reproducing the book is its job.

  A real deployment should not. Storing the timestamps of traffic you have
  already refused hands an attacker a memory amplification primitive: they
  choose how much RAM you spend, for free. So here we reject *without* writing,
  and the set stays bounded by `limit`.

  The trade: the book's version makes an abusive client wait out a full window
  of silence before any request is admitted (each rejection pushes the window
  along). Ours lets them back in as soon as the genuine requests age out. That
  is the right trade — punishing abuse is a job for a ban list, not for your
  rate limiter's memory.
]]
local oldest         = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry_after_ms = 0

if oldest[2] then
  -- Room frees up when the oldest entry falls out of the window.
  retry_after_ms = math.ceil(tonumber(oldest[2]) + window_ms - now_ms)
end

redis.call('PEXPIRE', key, window_ms)

return { 0, count, math.max(0, retry_after_ms) }
