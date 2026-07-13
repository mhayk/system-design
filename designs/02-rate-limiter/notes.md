# 🚦 Rate Limiter — Recall Deck

Active-recall notes for *System Design Interview – An Insider's Guide*, **Chapter 4**. Built for self-testing and for the night before an interview — not for reading like prose.

Answers are hidden behind `<details>` blocks. **Say your answer out loud first, then expand.**

Full write-up: [`README.md`](./README.md) · Run the algorithms: [`./simulator/README.md`](./simulator/README.md)

---

## ⏱️ The 60-second answer

> If someone says "design a rate limiter", say this, in this order:

**"A rate limiter caps how many requests a client may send in a period and rejects the excess — to stop DoS-style resource starvation, to cut cost, and to protect servers from overload.**

**I'd put it in middleware — an API gateway — rather than in the client (which can be forged) or in each API server (which duplicates the logic). The middleware checks a counter in Redis keyed by the client and the rule; under the limit it forwards to the API servers and increments; over the limit it returns `429 Too Many Requests` with `X-Ratelimit-Limit`, `X-Ratelimit-Remaining` and `X-Ratelimit-Retry-After`, and the request is either dropped or pushed onto a queue to be processed later.**

**Rules — domain, descriptor, unit, requests-per-unit, in the Lyft config style — live on disk; workers pull them into a cache the limiter reads.**

**For the algorithm I'd default to token bucket if bursts are legitimate (Amazon and Stripe use it) or sliding window counter if I want near-sliding accuracy at fixed-window cost. I'd avoid a plain fixed window because it lets 2× the limit through at a boundary, and a sliding window log unless the endpoint is low-volume and high-value, because it stores a timestamp per request — including rejected ones.**

**Distributed, there are exactly two problems. A race condition on read-check-increment — solved with a Lua script or Redis sorted sets, *not* locks, which are slow. And a synchronisation problem because the web tier is stateless and a client can hit any limiter — solved with a centralised Redis, *not* sticky sessions, which are neither scalable nor flexible.**

**Then: deploy at the edge for latency, sync counters with eventual consistency, monitor whether the rules and the algorithm are actually effective, and fail open if Redis goes down so the limiter never takes the API with it."**

---

## 🃏 Active recall

### The basics

**Q: Name the three benefits of an API rate limiter the book lists.**
<details><summary>Answer</summary>

1. **Prevent resource starvation caused by DoS attacks** — intentional or unintentional.
2. **Reduce cost** — fewer servers, more resources for high-priority APIs; essential when you pay per call for third-party APIs (check credit, make a payment, retrieve health records).
3. **Prevent servers from being overloaded** — filter out excess requests from bots or users' misbehaviour.
</details>

**Q: The three places you could put a rate limiter, and the verdict on each.**
<details><summary>Answer</summary>

- **Client-side** — *unreliable*. Client requests can easily be forged by malicious actors, and you might not control the client implementation.
- **Server-side** — the limiter sits with the API servers. Full control of the algorithm.
- **Middleware** — a rate limiter in front of the API servers. In microservices this is usually the **API gateway**: a managed middleware doing rate limiting, SSL termination, authentication, IP whitelisting, static content, etc.
</details>

**Q: Server-side or API gateway? What decides it?**
<details><summary>Answer</summary>
No absolute answer — depends on the company's tech stack, engineering resources, priorities and goals. Guidelines:

- Is your **current language/stack** efficient enough to do it server-side?
- Choose the **algorithm that fits your business** — server-side gives full control; a third-party gateway may limit your choice.
- Already have **microservices + a gateway** doing auth/IP-whitelisting? Add the limiter there.
- Building your own **takes time** — without the engineering resources, a **commercial API gateway is the better option**.
</details>

**Q: The book's six requirements for the system.**
<details><summary>Answer</summary>

1. Accurately limit excessive requests.
2. **Low latency** — must not slow down HTTP response time.
3. Use **as little memory as possible**.
4. **Distributed** rate limiting — shareable across multiple servers/processes.
5. **Exception handling** — clear exceptions to throttled users.
6. **High fault tolerance** — if a cache server goes offline, it does not affect the entire system.
</details>

---

### The algorithms

**Q: List all five.**
<details><summary>Answer</summary>
Token bucket · Leaking bucket · Fixed window counter · Sliding window log · Sliding window counter.
</details>

**Q: Token bucket — mechanism, parameters, who uses it?**
<details><summary>Answer</summary>
A container with a **pre-defined capacity**; tokens are added at preset rates periodically; once full, **extra tokens overflow**. Each request **consumes one token**; enough tokens → allowed; not enough → **dropped**.

**Parameters:** *bucket size* (max tokens) and *refill rate* (tokens added per second).

**Used by Amazon and Stripe.**
</details>

**Q: Walk the token bucket timeline from Figure 4-6 (bucket size 4, refill 4 per minute).**
<details><summary>Answer</summary>

- **1:00:00** — start with 4 tokens. 1 request → allowed, 1 token consumed (3 left).
- **1:00:05** — start with 3 tokens. 3 requests → all allowed, 3 tokens consumed (0 left).
- **1:00:20** — start with 0 tokens. 1 request → **dropped**.
- **1:01:00** — **4 tokens refilled** at the 1-minute interval.
</details>

**Q: How many token buckets do you need?**
<details><summary>Answer</summary>
Depends on the rules.

- **Per endpoint** — 1 post/sec + 150 friends/day + 5 likes/sec ⇒ **3 buckets per user**.
- **Per IP** — one bucket per IP address.
- **Global** — a system-wide 10,000 req/sec limit ⇒ **one global bucket** shared by all.
</details>

**Q: Token bucket pros and cons.**
<details><summary>Answer</summary>
**Pros:** easy to implement; memory efficient; **allows a burst of traffic** for short periods (a request goes through as long as tokens remain).
**Cons:** two parameters (bucket size, refill rate) — **challenging to tune properly**.
</details>

**Q: Leaking bucket — mechanism, parameters, who uses it?**
<details><summary>Answer</summary>
Like the token bucket **except requests are processed at a fixed rate**, usually via a **FIFO queue**. Request arrives → if the queue is not full, add it; otherwise **drop** it. Requests are **pulled from the queue and processed at regular intervals**.

**Parameters:** *bucket size* (= queue size) and *outflow rate* (how many requests are processed at a fixed rate, usually per second).

**Used by Shopify.**
</details>

**Q: Leaking bucket pros and cons.**
<details><summary>Answer</summary>
**Pros:** memory efficient given the limited queue size; **stable outflow rate** — suits use cases that need one.
**Cons:** a **burst fills the queue with old requests**, and if they aren't processed in time, **recent requests get rate limited**; two parameters, not easy to tune.
</details>

**Q: Fixed window counter — mechanism and its one fatal flaw.**
<details><summary>Answer</summary>
Divide the timeline into **fixed-size windows**, one counter each. Each request **increments the counter by one**. Once the counter hits the threshold, new requests are **dropped until a new window starts**.

**Flaw:** a **burst at the edges of two adjacent windows** lets more than the quota through.
</details>

**Q: Show the fixed-window edge burst with the book's numbers.**
<details><summary>Answer</summary>
Limit = **5 requests per minute**; quota resets at the round minute.

- **5 requests between 2:00:00 and 2:01:00** → all allowed.
- **5 requests between 2:01:00 and 2:02:00** → all allowed.
- Look at the rolling minute **2:00:30 → 2:01:30**: **10 requests go through — twice the allowed number.**

▶️ `npm run sim -- --scenario=fixed-window-edge-burst`
</details>

**Q: Fixed window pros and cons.**
<details><summary>Answer</summary>
**Pros:** memory efficient; easy to understand; **resetting the quota at the end of a unit window fits certain use cases**.
**Cons:** a **spike at the window edges** can let more than the allowed quota through.
</details>

**Q: Sliding window log — the four steps.**
<details><summary>Answer</summary>

1. Track **request timestamps**, usually in cache — **Redis sorted sets**.
2. On a new request, **remove all outdated timestamps** (older than the start of the current window).
3. **Add the new request's timestamp** to the log.
4. If the **log size ≤ allowed count** → accept. Otherwise → **reject**.
</details>

**Q: Walk the sliding window log example (allow 2 req/min).**
<details><summary>Answer</summary>

- **1:00:01** — log empty → **allowed**. Log: `[1:00:01]`.
- **1:00:30** — inserted; size 2, not larger than allowed → **allowed**. Log: `[1:00:01, 1:00:30]`.
- **1:00:50** — inserted; size **3 > 2** → **rejected — but the timestamp stays in the log.**
- **1:01:40** — window is `[1:00:40, 1:01:40)`. `1:00:01` and `1:00:30` are outdated → removed. Log size becomes **2** → **accepted**.
</details>

**Q: Sliding window log pros and cons.**
<details><summary>Answer</summary>
**Pro:** **very accurate** — in any rolling window, requests never exceed the limit.
**Con:** **consumes a lot of memory** — even a **rejected** request's timestamp may still be stored.
</details>

**Q: Sliding window counter — the formula.**
<details><summary>Answer</summary>

```
rolling count = requests in current window
              + requests in previous window × overlap % of the rolling window with the previous window
```
</details>

**Q: Do the book's arithmetic. Limit 7/min, 5 requests in the previous minute, 3 in the current, new request at the 30% position.**
<details><summary>Answer</summary>
The rolling minute overlaps the previous minute by **70%**.

**3 + 5 × 0.7 = 6.5** → the book **rounds down to 6** (up or down depending on the use case).

6 < 7 ⇒ the request **goes through** — but **one more request** reaches the limit.
</details>

**Q: Sliding window counter pros and cons.**
<details><summary>Answer</summary>
**Pros:** **smooths out spikes**, because the rate is based on the **average rate of the previous window**; **memory efficient**.
**Cons:** works only for a **not-so-strict look-back window** — it is an **approximation** assuming requests in the previous window are **evenly distributed**. But per Cloudflare's experiments, **only 0.003% of requests are wrongly allowed or rate limited among 400 million requests**.
</details>

**Q: Rank the five on memory, then on accuracy.**
<details><summary>Answer</summary>
**Memory (cheapest → dearest):** fixed window ≈ sliding window counter ≈ token bucket ≈ leaking bucket (all O(1)-ish per client) → **sliding window log** (O(requests in window), the outlier).

**Accuracy (highest → lowest):** sliding window log → sliding window counter (~0.003% error) → token bucket / leaking bucket (exact against *their own* definition, which permits bursts / reshapes traffic) → fixed window (up to **2× the limit** at a boundary).
</details>

---

### Architecture & rules

**Q: Where do you store counters, and why not a database?**
<details><summary>Answer</summary>
**In-memory cache** — a database is a bad idea because of **slow disk access**. The cache is fast and supports **time-based expiry**. **Redis** is the popular choice, offering the two commands you need:

- **`INCR`** — increases the stored counter by 1.
- **`EXPIRE`** — sets a timeout; when it expires the counter is **deleted automatically**.
</details>

**Q: Describe the detailed design (Figure 4-13).**
<details><summary>Answer</summary>

- **Rules are stored on disk.** **Workers** frequently **pull rules from disk into the cache**.
- A client request hits the **rate limiter middleware** first.
- The middleware **loads rules from the cache** and **fetches counters and the last request timestamp from Redis**.
  - **Not rate limited** → forwarded to the **API servers**.
  - **Rate limited** → returns **429**; the request is **either dropped (option 1) or forwarded to a message queue (option 2)** to be processed later.
</details>

**Q: Why would you ever *queue* a rate-limited request instead of dropping it?**
<details><summary>Answer</summary>
The book's example: if some **orders** are rate limited due to system overload, you may want to **keep those orders to be processed later** rather than lose the business.
</details>

**Q: Reproduce the Lyft rule config shape.**
<details><summary>Answer</summary>

```yaml
domain: messaging
descriptors:
  - key: message_type
    Value: marketing
    rate_limit:
      unit: day
      requests_per_unit: 5      # max 5 marketing messages per day
```

```yaml
domain: auth
descriptors:
  - key: auth_type
    Value: login
    rate_limit:
      unit: minute
      requests_per_unit: 5      # cannot log in more than 5 times per minute
```

Rules are **generally written in configuration files and saved on disk**.
</details>

**Q: The three headers — exact names and meanings.**
<details><summary>Answer</summary>

| Header | Meaning |
|---|---|
| `X-Ratelimit-Remaining` | The **remaining** number of allowed requests within the window. |
| `X-Ratelimit-Limit` | How many calls the client **can make per time window**. |
| `X-Ratelimit-Retry-After` | The number of **seconds to wait** until you can make a request again without being throttled. |

When a user has sent too many requests: **`429 Too Many Requests`** **plus** `X-Ratelimit-Retry-After` are returned.
</details>

---

### Distributed environment

**Q: The two challenges of the distributed setting.**
<details><summary>Answer</summary>
**Race condition** and **synchronisation issue**. (That's it — exactly two. If you can only remember one thing about this chapter's deep dive, remember these two words and their two *wrong* answers.)
</details>

**Q: Describe the race condition precisely.**
<details><summary>Answer</summary>
The limiter does: **read** counter from Redis → **check** if `counter + 1` exceeds the threshold → if not, **increment** by 1.

With counter = 3 and two concurrent requests: both **read 3 before either writes back**, both increment to **4**, both believe they are right. **The counter should be 5.**
</details>

**Q: What are the two accepted solutions to the race condition — and what is the wrong one?**
<details><summary>Answer</summary>
**Wrong (but obvious):** **locks** — they **significantly slow down the system**.

**Right:** **Lua script** (atomic read-check-increment inside Redis, one round-trip) or **sorted sets** data structure in Redis.
</details>

**Q: Describe the synchronisation issue.**
<details><summary>Answer</summary>
One limiter server is not enough for millions of users. But the **web tier is stateless**, so a client's requests can be routed to **different limiter servers**. If nothing synchronises them, **limiter 1 holds no data about the traffic limiter 2 saw** — so the limiter cannot work properly.
</details>

**Q: Solution to the synchronisation issue — and the wrong one?**
<details><summary>Answer</summary>
**Wrong:** **sticky sessions** (pin a client to the same limiter) — **not advisable: neither scalable nor flexible**.

**Right:** a **centralised data store like Redis**. Limiter servers stay stateless; all read/write the same counters.
</details>

**Q: The two performance optimisations.**
<details><summary>Answer</summary>

1. **Multi-data-centre / edge.** Latency is high for users far from the data centre. Cloud providers run many edge locations — **as of 5/20/2020, Cloudflare had 194 geographically distributed edge servers** — and traffic is **automatically routed to the closest edge server**.
2. **Eventual consistency** for synchronising the counter data. (See the "Consistency" section of Chapter 6, Design a Key-value Store.)
</details>

**Q: What do you monitor, and what do you do about it?**
<details><summary>Answer</summary>
Gather analytics to check that **(a) the algorithm is effective** and **(b) the rules are effective**.

- **Rules too strict** → many valid requests dropped → **relax the rules a little**.
- **Limiter ineffective during a traffic surge** (e.g. a **flash sale**) → **replace the algorithm with one supporting burst traffic — token bucket is a good fit here.**
</details>

---

### Wrap-up talking points

**Q: Hard vs soft rate limiting.**
<details><summary>Answer</summary>
**Hard:** the number of requests **cannot exceed** the threshold.
**Soft:** requests **can exceed** the threshold **for a short period**.
</details>

**Q: Rate limiting at different OSI layers.**
<details><summary>Answer</summary>
The chapter only discusses the **application layer — HTTP, layer 7**. You can also limit at other layers: e.g. **by IP address using Iptables — IP, layer 3**.

OSI's 7 layers: 1 Physical, 2 Data link, **3 Network**, 4 Transport, 5 Session, 6 Presentation, **7 Application**.
</details>

**Q: Four client best practices to avoid being rate limited.**
<details><summary>Answer</summary>

1. Use a **client cache** to avoid frequent API calls.
2. **Understand the limit** and don't send too many requests in a short time frame.
3. **Catch exceptions/errors** so the client recovers gracefully.
4. Add **sufficient back-off time** to retry logic.
</details>

---

## ⚠️ The traps

The things that go wrong under pressure.

| Trap | The correction |
|------|----------------|
| **"Fixed window is fine."** | It lets through **2× the limit** across a boundary: 5/min with 5 requests just before 2:01:00 and 5 just after ⇒ **10 in the rolling minute 2:00:30–2:01:30**. Say the number "2×" out loud — it is the memorable part. |
| **"Use a lock to fix the race condition."** | Locks are the *obvious* answer and the book **rejects them** — they **significantly slow down the system**. Say **Lua script** or **Redis sorted sets**. Reaching for a lock signals you don't know Redis is atomic. |
| **"Use sticky sessions to fix synchronisation."** | The book calls this **neither scalable nor flexible**. Say **centralised Redis**. Keep the limiter tier stateless. |
| **Forgetting that the sliding window log stores *rejected* timestamps too.** | That is *precisely why* it's memory-hungry — "even if a request is rejected, its timestamp might still be stored". Memory scales with **request volume**, not user count. |
| **Mixing up the two buckets.** | **Token** bucket: tokens accumulate, requests **consume** them → **bursts allowed**. **Leaking** bucket: requests queue, drain at a **fixed outflow rate** → **bursts smoothed**, queue overflow dropped. Token = Amazon/Stripe. Leaking = Shopify. |
| **Saying the sliding window counter is "exact".** | It is an **approximation** that assumes the previous window's requests were **evenly distributed**. Defend it with Cloudflare's **0.003% / 400M** figure — don't defend it by claiming accuracy it doesn't have. |
| **Losing throttled requests.** | The rate-limited path is **drop *or* enqueue**. Mentioning the queue (throttled *orders* processed later) is a cheap point most candidates miss. |
| **Forgetting the client is a bad place for the limiter.** | Client requests are **easily forged**, and you may not control the client. |
| **Only rejecting, never telling.** | The interviewer explicitly said **yes, inform throttled users**. `429` + the three `X-Ratelimit-*` headers. |
| **Making the limiter a single point of failure.** | Requirement 6 is **high fault tolerance**: a cache server going offline must **not affect the entire system**. Say **fail open** (my own framing — the book doesn't name it). |
| **Rounding 6.5 the wrong way.** | The book **rounds down to 6**, and notes it may be rounded either way depending on the use case. Don't assert a universal rule. |

---

## 🔢 Numbers worth memorising

All checked against the chapter.

| Number | What it is | Attribution |
|--------|------------|-------------|
| **300 tweets per 3 hours** | Twitter's tweet rate limit | Book, intro (ref [2]) |
| **300 per user per 60 seconds** | Google Docs APIs' default limit **for read requests** | Book, intro (ref [3]) |
| **0.003% of requests wrongly allowed or rate limited, out of 400 million** | Error rate of the **sliding window counter** approximation | **Cloudflare** experiments (ref [10]) |
| **194 edge servers, as of 5/20/2020** | Geographically distributed edge locations | **Cloudflare** (ref [14]) |
| **Token bucket** | Used by **Amazon** and **Stripe** | Book (refs [5], [6]) |
| **Leaking bucket** | Used by **Shopify** | Book (ref [7]) |
| **429** | HTTP status: Too Many Requests | Book |
| **2×** | How far over the limit a **fixed window** can go at a boundary (5/min → 10 in the rolling minute 2:00:30–2:01:30) | Book, Figure 4-9 |
| **4 / 4-per-minute** | Token bucket example: bucket size 4, refill rate 4 per 1 minute | Book, Figure 4-6 |
| **3 + 5 × 0.7 = 6.5 → 6** | Sliding window counter, limit 7/min, 5 previous + 3 current, 30% into the current minute | Book, Figure 4-11 text |
| **2 req/min → 1:00:01, 1:00:30, 1:00:50 ✗, 1:01:40 ✓** | Sliding window log walk-through | Book, Figure 4-10 |

**Non-book examples the book opens with** (handy as rule illustrations): *2 posts per second per user*; *10 accounts per day per IP*; *5 reward claims per week per device*.

---

## 🎤 Interview cues

### Step 1 — the questions a strong candidate asks

The book scripts them. Ask these, in roughly this order:

1. **"Client-side or server-side rate limiter?"** → *Server-side API rate limiter.*
2. **"Throttle by IP, user ID, or other properties?"** → *Flexible enough to support different sets of throttle rules.*
3. **"What's the scale — a startup or a big company with a large user base?"** → *Must handle a large number of requests.*
4. **"Does it work in a distributed environment?"** → *Yes.* ← **this is the question that unlocks the whole deep dive**
5. **"Separate service, or implemented in application code?"** → *A design decision up to you.*
6. **"Do we need to inform users who are throttled?"** → *Yes.* ← **this is what buys you the 429 + headers section**

Questions 4 and 6 are the load-bearing ones: 4 gives you the race condition + synchronisation discussion, 6 gives you the response contract. Ask them even if you ask nothing else.

### If the interviewer pushes on scale

- The interviewer only says *"a large number of requests"* — so **derive** an envelope out loud and label it as an assumption. (Mine, in `README.md` §4: 100k req/s peak ⇒ ~100k Redis ops/s ⇒ shard Redis by key; counters ~1 GB for 1M active clients × 5 rules; latency budget **< 1–2 ms p99**, which forces **one atomic round-trip**, not read-then-write.)
- Make the point that the limiter's cost scales with **request volume**, not user count — the opposite of most services. That's exactly why the sliding window **log** is dangerous and the **counter** variants aren't.
- Then reach for: **shard Redis by key**, **edge deployment**, **eventual consistency** across regions, and — if pressed harder — a **local in-process pre-filter** in front of the centralised counter to absorb hot keys.

### Time-boxing a 45-minute answer

| Minutes | Cover |
|---------|-------|
| 0–5 | Scope questions (the 6 above) + requirements |
| 5–10 | Where to put it (client / server / gateway) + `429` and the headers |
| 10–25 | **The algorithms** — this is where the chapter's value is. Compare, then commit to one and say *why*. |
| 25–35 | High-level → detailed design (rules on disk → workers → cache; Redis counters; drop vs enqueue) |
| 35–42 | **Distributed: race condition + synchronisation**, with the right *and* the wrong answer for each |
| 42–45 | Performance (edge, eventual consistency), monitoring, and one wrap-up point (hard vs soft, OSI layers) |

---

## 📚 References worth actually reading

From the chapter's 16-item list — the ones that repay the click:

| Link | Why |
|------|-----|
| [Stripe — Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters) [6] | The best single practitioner write-up. Also introduces **concurrency limits** alongside rate limits — a distinction the book never makes. |
| [Cloudflare — How we built rate limiting… millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/) [10] | The **source of the 0.003% / 400M figure**, and the original description of the **sliding window counter** approximation. Read it and the chapter's Figure 4-11 clicks. |
| [Lyft — ratelimit](https://github.com/lyft/ratelimit) [12] | The actual open-source component whose **YAML rule format** the chapter reproduces (domain / descriptors / rate_limit). Skim the README's config examples. |
| [ClassDojo — Better rate limiting with Redis sorted sets](https://engineering.classdojo.com/blog/2015/02/06/rolling-rate-limiter/) [8] | The **rolling rate limiter**: how sorted sets implement the sliding window log *and* dodge the race condition. This is the concrete answer to "how, exactly, without a lock?". |
| [Scaling your API with rate limiters (gist)](https://gist.github.com/ptarjan/e38f45f2dfe601419ca3af937fff574d#request-rate-limiter) [13] | The chapter's **Lua script** reference. A short, readable atomic-limiter script. |
| [Google Cloud — Rate-limiting strategies and techniques](https://cloud.google.com/solutions/rate-limiting-strategies-techniques) [1] | Good taxonomy piece; useful vocabulary for the wrap-up (hard/soft, where to enforce). |
| [Shopify REST Admin API rate limits](https://help.shopify.com/en/api/reference/rest-admin-api-rate-limits) [7] | The **leaky bucket** in production, documented for real clients. |
| [AWS — Throttle API requests for better throughput](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html) [5] | **Token bucket** in production, with burst vs steady-state made explicit. |
| [Rate limit requests with Iptables](https://blog.programster.org/rate-limit-requests-with-iptables) [15] | Only if you want to actually say something concrete about **layer-3** limiting in the wrap-up. |

*(The remaining references — Twitter/Google Docs limits, IBM microservices, Redis's homepage, the OSI Wikipedia page, and the Medium article on the alternate sliding-window-counter implementation — are citations rather than reading.)*

---

## 🧪 Self-test loop

Cheapest possible revision, in order:

1. Recite **the 60-second answer** from memory.
2. Name the **five algorithms**, then for each: mechanism → parameters → one pro → one con → who uses it.
3. Do the **three arithmetic drills**: the fixed-window 2× burst; the sliding-window-log 4-step walk; `3 + 5 × 0.7 = 6.5 → 6`.
4. Say the **two distributed problems**, each with its **right** answer *and* its famous **wrong** answer.
5. Recite the **three headers** verbatim.
6. Run the simulator and check your intuition against the output: `npm run sim -- --list`, then `npm test`.

---

## ❓ Open questions (mine, not the book's)

- [ ] How do you set `X-Ratelimit-Retry-After` correctly for a **sliding window counter**? (Exact for token bucket and GCRA; only an estimate for the weighted approximation.)
- [ ] Where exactly does the **local pre-filter + centralised counter** two-level design start to over-permit, and by how much?
- [ ] Is **fail-open** ever the wrong default outside of pay-per-call third-party APIs?
- [ ] The book mentions a **second** sliding-window-counter implementation (ref [9]) but doesn't explain it — what is it, and how does it differ?
