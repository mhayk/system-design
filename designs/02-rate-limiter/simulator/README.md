# Rate limiter simulator

Five rate limiting algorithms, running on a **deterministic virtual clock**, fed the same traffic so you can watch them disagree.

Reading Chapter 4 makes all five algorithms sound reasonable. They only stop sounding reasonable when you point a burst at them.

```bash
npm run sim -- --scenario=fixed-window-edge-burst
```

No install, no dependencies, no Redis, nothing to configure. Node 22.6+ runs the TypeScript directly.

---

## Why a virtual clock

Nothing here sleeps. "Time" is just a number of milliseconds handed to `allow(t)`, so a two-minute traffic trace runs in microseconds and — more importantly — **runs identically every time**.

That is what lets the test suite assert that our token bucket produces the book's Figure 4-6 *exactly*, token for token. A simulator you cannot trust to repeat itself is a simulator you cannot learn from.

---

## Commands

| Command | What it does |
|---|---|
| `npm run sim -- --list` | List every scenario |
| `npm run sim -- --scenario=<name>` | Run one scenario |
| `npm run sim -- --scenario=<name> --trace` | ...plus a request-by-request trace of the limiter's internal state |
| `npm run sim -- --all` | Run everything |
| `npm run sim -- --race` | Demonstrate the distributed race condition |
| `npm run sim -- --json` | Machine-readable output |
| `npm test` | The test suite — 28 tests pinning the algorithms to the book's figures |

---

## Scenarios

### Reproducing the book, figure by figure

| Scenario | Figure | What it shows |
|---|---|---|
| `token-bucket-figure-4-6` | 4-6 | Bucket size 4, refill 4/min. Start full, spend, hit zero, get refused, refill. |
| `sliding-log-figure-4-10` | 4-10 | 2 req/min. Watch the log grow to 3 on a **rejected** request. |
| `sliding-counter-figure-4-11` | 4-11 | The weighted estimate: `3 + 5 × 0.7 = 6.5 → 6 → allowed`. |

Run these with `--trace`. The internal-state columns are the entire point — you can check the algorithm against the book by eye.

### Where the algorithms disagree

| Scenario | What it shows |
|---|---|
| `fixed-window-edge-burst` | **Start here.** The boundary attack (Figure 4-9). Same 5 req/min limit, same ten requests — the fixed window lets *all ten* through. |
| `flash-sale-burst` | A quiet API takes a sudden spike. The token bucket banked tokens during the quiet and absorbs it; the window algorithms have no memory and throw it away. |
| `leaking-bucket-starvation` | The leaking bucket's con, made concrete: a burst fills the queue, and later requests wait ~50 seconds or are refused outright. |
| `steady-traffic` | A metronomic client at 80% of the limit. Everything passes, everywhere. That is the lesson: you cannot evaluate a rate limiter on the happy path. |
| `poisson-traffic` | **Run this straight after `steady-traffic`.** Same average rate, but realistically clumpy — and now four of the five limiters deliver 34 requests in a rolling minute against a limit of 30. Only the sliding window log holds the line, and it pays for it by refusing 18 requests from a client sitting at 83% of quota. The accuracy/permissiveness trade-off, on one screen. |

---

## Reading the output

```
  Fixed window            ✓✓✓✓✓│✓✓✓✓✓
                          limit=5 window(s)=60
                           10/10 allowed (100%) · peak 10 in any 1:00 ⚠ 2.0× the limit
```

One character per request, in arrival order. `│` marks a window boundary.

**`peak` is the number that matters.** It is the most requests the limiter ever actually delivered downstream in *any* rolling window of the limit's length — not just the clock-aligned windows it happens to be counting. A correct limiter's peak never exceeds its limit. The fixed window's does, and that is precisely the bug.

Two subtleties worth knowing, because they look like bugs and are not:

- **The leaking bucket is scored on departure times, not arrival times.** It is the one algorithm that defers work rather than refusing it, so what downstream sees is the drip, not the burst. Judging it by arrivals would wrongly accuse it of letting the burst through. Its cost shows up on the `queueing delay` line instead — and that cost is brutal.
- **The token bucket's `peak` legitimately exceeds its limit.** A bucket sized to the limit starts *full*, so it can spend its whole capacity plus whatever refills during the window. That is the burst allowance you asked for when you chose the algorithm, not a defect. If you need a hard ceiling in every rolling window, you want the sliding window log.

---

## The race condition

```bash
npm run sim -- --race
```

The book's Figure 4-14, scaled up. Ten concurrent requests, a limit of 5, and a Redis 5ms away:

- **Naive `GET` → check → `SET`:** all ten get through. The counter finishes at **2**, so the limiter does not even know it went wrong. Every request that read the counter before anyone wrote to it saw the same stale zero and cheerfully admitted itself.
- **Atomic check-and-increment:** exactly 5. The limit holds.

Nothing in the demo is actually concurrent — it is a fixed, deterministic event schedule. That is the pedagogical point: **a race condition is not "randomness", it is an interleaving.** Once you can name the interleaving, the fix stops being folklore.

> **The trap:** the instinctive fix is a lock. Do not say that in an interview. A lock around every request serialises your entire rate limiter — you would fix correctness by destroying the latency budget the rate limiter existed to protect. The fix is to make the read-check-write *one operation the store executes indivisibly*: a Lua script, or a sorted set. There is no lock at all; the work is simply small enough to do in one hop, so there is no window to race through.

`redis/token-bucket.lua` and `redis/sliding-window-log.lua` are the real thing — production-shaped, commented, and runnable against a real Redis. They are worth reading even though the simulator does not execute them, because the mapping from algorithm to Redis primitives (`ZREMRANGEBYSCORE` → `ZCARD` → `ZADD` → `EXPIRE`) is exactly what an interviewer will ask you to sketch.

---

## Layout

```
simulator/
├── src/
│   ├── algorithms/       # The five, one file each. Start here.
│   ├── traffic.ts        # Traffic generators (steady, burst, edge-burst, Poisson)
│   ├── scenarios.ts      # The named experiments, and the lesson each one teaches
│   ├── simulate.ts       # The runner, and the rolling-window peak metric
│   ├── distributed.ts    # The race condition, as a deterministic interleaving
│   ├── render.ts         # ASCII timelines
│   └── cli.ts
├── test/                 # 28 tests pinning the algorithms to the book's figures
└── redis/                # Production Lua scripts (reference — not run by the sim)
```

The five algorithm files are deliberately small and heavily commented. Read them in this order:

1. `fixed-window.ts` — the naive one, and the one whose flaw you must be able to explain
2. `sliding-window-log.ts` — the exact one, and why nobody runs it at the edge
3. `sliding-window-counter.ts` — the hybrid that actually ships
4. `token-bucket.ts` — the one you should reach for by default
5. `leaking-bucket.ts` — the odd one out: it defers rather than refuses

---

## Practice

The best way to use this is to **predict before you run**.

Open `scenarios.ts`, read the traffic pattern, and write down what you think each algorithm will do — how many it allows, and what its peak will be. Then run it. The scenarios where you were wrong are the ones worth rereading in the book.

Then try changing things:

- Set the token bucket's `capacity` to `1`. What has it become? (Answer: a fixed window of `1/refill_rate`, near enough — the burst allowance *is* the capacity.)
- Make the sliding window counter round `up` instead of `down`. Which scenario changes, and does it now over- or under-admit?
- Widen `rttMs` in the race demo. Watch a slower Redis make the naive implementation strictly worse — the race window is exactly as wide as your network latency.
