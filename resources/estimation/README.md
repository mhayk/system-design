# 📐 Back-of-the-Envelope Estimation

A reusable toolkit for **step 4 of every design** — the scale estimate. Sizing QPS, storage, bandwidth, memory and availability from a handful of assumptions, fast enough to do out loud in an interview.

Based on **Chapter 2, "Back-of-the-Envelope Estimation"** of *System Design Interview – An Insider's Guide* (Alex Xu), with a few clearly-marked additions of my own.

> Estimation is cross-cutting: it feeds the **Scale Estimation** step of the [Uber](../../designs/01-uber/) and [rate limiter](../../designs/02-rate-limiter/) designs, and every design still to come. This is the reference those write-ups point back to.

**In this folder:**

- 🧮 **[Interactive calculator](./estimator/)** — type your assumptions, watch every step of the arithmetic
- 🖨️ **[Printable wall poster](./poster/)** — the three tables + formulas on one A4 sheet, for pinning above your desk
- 🃏 **[Cheat sheet](./cheat-sheet.md)** — active-recall deck for the night before an interview

---

## 🎯 Why estimate at all

> *"Back-of-the-envelope calculations are estimates you create using a combination of thought experiments and common performance numbers to get a good feel for which designs will meet your requirements."* — Jeff Dean, Google Senior Fellow

The point is not the answer. It is to find out, in two minutes and before drawing a single box, **which order of magnitude you are dealing with** — because 300 requests per second and 300,000 requests per second are different systems, and you want to know which one you are designing before you commit to a datastore.

The book's own framing, worth internalising: *"Solving the problem is more important than obtaining results."* An interviewer watching you estimate is grading the **method** — your assumptions, your units, your arithmetic — not whether you landed on their number.

Everything here rests on three sets of numbers you should be able to recall cold, followed by the handful of formulas that turn assumptions into an envelope.

---

## 🔢 The three foundation tables

### Powers of two (data volumes)

A byte is 8 bits; one ASCII character is one byte. Data volume is counted in powers of two, and the approximations to powers of ten are close enough to do in your head.

| Power | Approximate value | Unit | Short |
|------:|-------------------|------|-------|
| 2^10 | 1 Thousand | 1 Kilobyte | 1 KB |
| 2^20 | 1 Million | 1 Megabyte | 1 MB |
| 2^30 | 1 Billion | 1 Gigabyte | 1 GB |
| 2^40 | 1 Trillion | 1 Terabyte | 1 TB |
| 2^50 | 1 Quadrillion | 1 Petabyte | 1 PB |

*Source: book Table 2-1.*

The lesson is the ladder: **each step up is ×1000**. KB → MB → GB → TB → PB. If you can hold that ladder and the payload sizes below, you can size any store.

### Latency numbers every programmer should know

These tell you the *relative* cost of operations — the intuition that memory is fast and disk and network are slow. The book prints two versions: the original 2010 figures (Dr. Dean) and an updated 2020 set. **Memorise the 2020 numbers** — they are current, and the shape is what matters more than the exact digit.

| Operation | 2020 (memorise) | 2010 (original) |
|-----------|----------------:|----------------:|
| L1 cache reference | 1 ns | 0.5 ns |
| Branch mispredict | 3 ns | 5 ns |
| L2 cache reference | 4 ns | 7 ns |
| Mutex lock/unlock | 17 ns | 100 ns |
| Main memory reference | 100 ns | 100 ns |
| Send 2 KB over commodity network | 44 ns | 20 µs *(1 Gbps)* |
| Compress 1 KB with Zippy | 2 µs | 10 µs |
| Read 1 MB sequentially from memory | 3 µs | 250 µs |
| SSD random read | 16 µs | — *(no SSD row)* |
| Read 1 MB sequentially from SSD | 49 µs | — |
| Round trip within same datacenter | 500 µs | 500 µs |
| Read 1 MB sequentially from disk | 825 µs | 30 ms |
| Disk seek | 2 ms | 10 ms |
| Round trip CA ⇄ Netherlands | 150 ms | 150 ms |

*Sources: book Figure 2-1 (2020) and Table 2-2 (2010). Units: 1 µs = 1,000 ns; 1 ms = 1,000 µs = 1,000,000 ns.*

**Why the two columns differ, and why it is worth seeing both:** the decade of hardware progress is concentrated exactly where you would hope. Memory bandwidth improved ~80× (1 MB from memory: 250 µs → 3 µs). Storage was transformed — spinning disk gave way to SSD, and a sequential 1 MB read went from 30 ms to under 50 µs, roughly **600× faster**. But the two numbers that barely moved are the two set by **physics, not silicon**: main memory reference (100 ns, unchanged) and the transatlantic round trip (150 ms, unchanged — that is the speed of light through fibre, and no amount of engineering will fix it). That is the durable lesson: you can buy your way out of slow storage, but not out of distance.

The book's five takeaways:

- **Memory is fast, disk is slow.**
- **Avoid disk seeks** where you can.
- **Simple compression is fast** — cheap enough to always consider.
- **Compress before sending over the internet** — the network is the bottleneck, not the CPU.
- **Cross-region transfer costs time** — data centres in different regions are 100+ ms apart, so replicate deliberately.

### Availability — the "nines"

Availability is the percentage of time a service is operational. 100 % means zero downtime; most services live between 99 % and 100 %. Cloud providers (Amazon, Google, Microsoft) set SLAs at 99.9 % or above. **The more nines, the better** — and each nine costs an order of magnitude more effort than the last.

| Availability | Downtime / day | Downtime / year |
|-------------:|----------------|-----------------|
| 99 % | 14.40 minutes | 3.65 days |
| 99.9 % *("three nines")* | 1.44 minutes | 8.77 hours |
| 99.99 % | 8.64 seconds | 52.60 minutes |
| 99.999 % *("five nines")* | 864 milliseconds | 5.26 minutes |
| 99.9999 % | 86.4 milliseconds | 31.56 seconds |

*Source: book Table 2-3.*

The pattern to remember: **each extra nine divides the downtime by ten.** Three nines is a comfortable "8-and-a-bit hours a year". Five nines — the pager-duty gold standard — is about **five minutes a year**, which is a budget so tight that a single bad deploy blows the whole year.

---

## 🧮 The method

The book only *implies* these formulas through its example. Written out, they are the whole job — assumptions in, envelope out.

### 1. QPS from users

```
DAU            = MAU × (daily-active fraction)
requests/day   = DAU × (actions per user per day)
average QPS    = requests/day ÷ 86,400          (86,400 = seconds in a day)
peak QPS       = average QPS × peak factor       (peak factor ≈ 2–3×)
```

The single most useful constant here is **86,400 seconds in a day**. Commit it to memory; it is the denominator of almost every QPS estimate you will ever do.

### 2. Storage

```
storage/day    = writes/day × average record size
storage total  = storage/day × 365 × (retention years)
                              × (replication factor)     ← easy to forget
```

Storage is where interviews are won and lost on a detail: **replication.** A record written once is stored three times if your replication factor is 3. If your envelope forgets it, you are off by 3× before you start.

### 3. Bandwidth

```
egress (bytes/s)  = QPS × response payload size
ingress (bytes/s) = write QPS × request payload size
```

### 4. Cache size (the 80-20 rule)

A common rule of thumb: **80 % of requests hit 20 % of the data.** So size a cache to hold that hot 20 %:

```
cache size ≈ 20% × (daily working-set size)
```

### 5. Number of servers

```
servers ≈ peak QPS ÷ (QPS a single box can serve)
```

You will rarely have the per-box number precisely; state your assumption ("a box handles ~1,000 QPS") and move on. The interviewer wants the shape of the reasoning, not a benchmark.

---

## ✍️ Worked example — Twitter QPS and storage

Straight from the book (*"these numbers are for this exercise only… not real numbers from Twitter"*), and reproduced exactly by the [interactive calculator](./estimator/) when you feed it these assumptions.

**Assumptions**

- 300 million monthly active users
- 50 % use Twitter daily
- 2 tweets per user per day on average
- 10 % of tweets contain media
- data stored for 5 years
- sizes: `tweet_id` 64 B, `text` 140 B, `media` 1 MB

**QPS**

```
DAU        = 300M × 50%           = 150M
tweets/day = 150M × 2             = 300M
QPS        = 300M ÷ 86,400        ≈ 3,500
peak QPS   = 3,500 × 2            ≈ 7,000
```

**Storage (media only — text and ids are rounding error next to 1 MB media)**

```
media/day  = 150M × 2 × 10% × 1 MB = 30 TB / day
5-year     = 30 TB × 365 × 5       ≈ 55 PB
```

Notice the shape: **3,500 QPS** is a modest number a handful of boxes can serve, but **55 PB** is a serious storage problem. The estimate has already told you where the design's difficulty lives — before you drew anything. That is the entire value of doing it first.

### House worked examples

Rather than restate them, see how this method was applied in the repo's own designs:

- **[Uber §4](../../designs/01-uber/README.md#4-scale-estimation)** — QPS from fan-out: ~1M drivers pinging every 4 s ⇒ **250,000 location writes/sec**, dwarfing everything else by ~1000×. A case where the estimate dictated a separate write-optimised path.
- **[Rate limiter §4](../../designs/02-rate-limiter/README.md#4-scale-estimation)** — sizing Redis: 100k req/s peak, counter memory `1M clients × 5 rules × 2 × 100 B ≈ 1 GB`, and the sliding-window-log memory blow-up made concrete.

---

## 💡 Tips

From the book, and each one saves you in the room:

- **Round and approximate.** Precision is not expected. `99987 / 9.1` becomes `100,000 / 10`. You are estimating, not accounting.
- **Write your assumptions down.** You will reference them repeatedly, and stating them makes the estimate defensible even if a number is off.
- **Label your units.** "5" is ambiguous — 5 KB or 5 MB? Always write the unit. This is the single most common self-inflicted error.
- **Practise the common asks.** Interviewers reach for the same five: **QPS, peak QPS, storage, cache, number of servers.** Have the method for each ready.

---

## 📌 Beyond the book

> Everything in this section is **my own addition** — accurate to my knowledge, but **not from Chapter 2**. Useful in practice; keep it separate when reciting the chapter.

**1. `86,400 ≈ 10^5` for the first pass.** Seconds in a day is 86,400, but 100,000 is within 15 % and turns any QPS estimate into moving a decimal point. Use `10^5` to get the order of magnitude instantly, then reach for 86,400 only if a factor of ~1.15 actually changes your conclusion (it rarely does).

**2. Peak factor is a *range*, not a constant.** The book uses 2×. Real traffic is spikier: a consumer app with an evening peak might be 3–5× its daily average, and a system with a daily batch job or a "cron on the minute" can spike far higher for seconds at a time. State the factor you assume rather than defaulting to 2× silently — and if the design is about handling spikes (as the [rate limiter](../../designs/02-rate-limiter/) is), the peak factor *is* the problem.

**3. Replication multiplies storage.** Covered above but worth repeating because it is the most-forgotten term: a replication factor of 3 triples every storage number. Availability comes from redundancy, and redundancy is copies, and copies cost disk.

**4. KB vs KiB — know the ambiguity exists.** Strictly, KB = 10^3 bytes (decimal, SI) and KiB = 2^10 = 1,024 bytes (binary). The book — like most of the industry, and this document — uses "KB" loosely for 2^10. It does not matter for an estimate (a ~2.4 % gap per step), but know the distinction exists so you are not caught out if an interviewer raises it.

**5. Read:write ratio drives the architecture.** Before sizing, ask whether the system is read-heavy or write-heavy — it decides everything downstream (caching, replicas, CQRS). A 100:1 read:write ratio means your cache and read replicas carry the system; a write-heavy system means the write path and the datastore's write throughput are the constraint.

**6. Bandwidth is QPS × payload — and it is often the real ceiling.** It is easy to size QPS and storage and forget the pipe between them. A modest 1,000 QPS of 1 MB responses is **1 GB/s** of egress — enough to saturate a 10 Gbps link and rack up a serious cloud bill. Always multiply through.

---

## 📎 References

- [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832) — the canonical gist the book's tables descend from
- [Interactive "Latency Numbers" by year](https://colin-scott.github.io/personal_website/research/interactive_latency.html) — Colin Scott's tool showing how the numbers evolved 1990→2020, which is where the "physics doesn't improve" lesson comes from
- The book's own worked examples, reproduced and extended in the [calculator](./estimator/)

---

_One envelope at a time. 📈_
