# 📐 Estimation — Recall Deck

Active-recall notes for back-of-the-envelope estimation (*System Design Interview*, **Chapter 2**). Built for self-testing and for the night before an interview — not for reading like prose.

Answers are hidden behind `<details>` blocks. **Say your answer out loud first, then expand.**

Full reference: [`README.md`](./README.md) · Practise: [interactive calculator ↗](https://estimation.mhayk.workers.dev/estimator/) · Pin it up: [wall poster ↗](https://estimation.mhayk.workers.dev/poster/)

---

## ⏱️ The 60-second method

> If someone says "estimate the scale", run this, in this order, out loud:

**"First, my assumptions — I'll state the user count, how active they are, and how much each one does, and write them down.**

**Users: MAU × daily-active fraction gives DAU. Load: DAU × actions-per-user-per-day gives requests per day; divide by 86,400 seconds for average QPS; multiply by a peak factor of 2–3× for peak QPS.**

**Storage: writes per day × record size gives bytes per day; times 365, times retention years, times replication factor — I won't forget replication. Bandwidth: QPS × payload size, both directions.**

**Then I sanity-check: is this 300 QPS or 300,000? Is this gigabytes or petabytes? That order of magnitude tells me where the design is hard before I draw a single box. I'll round aggressively — 86,400 is basically 10^5 — and label every unit."**

---

## 🔢 Numbers worth memorising

### Powers of two — the ×1000 ladder

| Power | ≈ | Unit |
|------:|---|------|
| 2^10 | 1 Thousand | KB |
| 2^20 | 1 Million | MB |
| 2^30 | 1 Billion | GB |
| 2^40 | 1 Trillion | TB |
| 2^50 | 1 Quadrillion | PB |

*Book Table 2-1. Each step up = ×1000.*

### Latency (2020 — the shape matters more than the digit)

| Operation | Time |
|-----------|-----:|
| L1 cache | 1 ns |
| Main memory reference | 100 ns |
| Compress 1 KB (Zippy) | 2 µs |
| Read 1 MB seq from memory | 3 µs |
| SSD random read | 16 µs |
| Read 1 MB seq from SSD | 49 µs |
| Datacenter round trip | 500 µs |
| Read 1 MB seq from disk | 825 µs |
| Disk seek | 2 ms |
| Round trip CA ⇄ Netherlands | 150 ms |

*Book Figure 2-1. Memory fast, disk slow, distance is physics.*

### Availability — each nine ÷10 the downtime

| Availability | Downtime / year |
|-------------:|-----------------|
| 99 % | 3.65 days |
| 99.9 % | 8.77 hours |
| 99.99 % | 52.6 minutes |
| 99.999 % | 5.26 minutes |
| 99.9999 % | 31.6 seconds |

*Book Table 2-3.*

---

## 🧮 The formulas

| Quantity | Formula |
|----------|---------|
| DAU | MAU × daily-active fraction |
| Average QPS | (DAU × actions/day) ÷ **86,400** |
| Peak QPS | average QPS × peak factor **(2–3×)** |
| Storage/day | writes/day × record size |
| Storage total | storage/day × 365 × years × **replication** |
| Bandwidth | QPS × payload size |
| Cache size | 20 % of the daily working set (80-20 rule) |
| Servers | peak QPS ÷ per-box QPS |

---

## 🃏 Active recall

**Q: How many seconds in a day, and the shortcut?**

<details><summary>Answer</summary>

**86,400.** For a first pass, round to **10^5** (100,000) — within 15 %, and it turns division into shifting a decimal. Use 86,400 only if that ~1.15× factor changes your conclusion.
</details>

**Q: 150M DAU posting 2×/day — what's the QPS?**

<details><summary>Answer</summary>

`150M × 2 = 300M requests/day`. `300M ÷ 86,400 ≈ 3,500 QPS`. Peak ≈ `2 × 3,500 = 7,000`. (The book's Twitter example.)
</details>

**Q: The ladder from KB to PB — what's each step?**

<details><summary>Answer</summary>

**×1000 each time.** KB → MB → GB → TB → PB, i.e. 2^10 → 2^20 → 2^30 → 2^40 → 2^50. Approx 10^3, 10^6, 10^9, 10^12, 10^15.
</details>

**Q: What's the storage formula, and which term does everyone forget?**

<details><summary>Answer</summary>

`writes/day × record size × 365 × retention years × replication factor`. The forgotten term is **replication** — a factor of 3 triples the whole number.
</details>

**Q: 150M DAU, 2 tweets/day, 10 % with 1 MB media — media storage per day and over 5 years?**

<details><summary>Answer</summary>

`150M × 2 × 10% × 1 MB = 30 TB/day`. Over 5 years: `30 TB × 365 × 5 ≈ 55 PB`. (Book example. Text + id are rounding error next to 1 MB media.)
</details>

**Q: What does 99.999 % ("five nines") allow you per year?**

<details><summary>Answer</summary>

About **5.26 minutes** of downtime per year (864 ms/day). Each extra nine divides downtime by ten: 99.9 % = 8.77 hr/yr, 99.99 % = 52.6 min/yr, 99.999 % = 5.26 min/yr.
</details>

**Q: Which two latency numbers barely improved from 2010 to 2020, and why?**

<details><summary>Answer</summary>

**Main memory reference (100 ns)** and the **transatlantic round trip (150 ms)**. Both are set by physics, not silicon — the second is the speed of light through fibre. Storage and memory bandwidth improved ~80–600×; distance did not.
</details>

**Q: You have 1,000 QPS of 1 MB responses. What's the bandwidth, and why care?**

<details><summary>Answer</summary>

`1,000 × 1 MB = 1 GB/s` of egress — enough to saturate a 10 Gbps link and cost real money. Bandwidth = QPS × payload; it's easy to size QPS and storage and forget the pipe between them.
</details>

**Q: How do you size a cache from a working set?**

<details><summary>Answer</summary>

**80-20 rule:** 80 % of requests hit 20 % of the data, so size the cache to hold that hot **20 %** of the daily working set.
</details>

---

## ⚠️ The traps

| Trap | The correction |
|------|----------------|
| "A day is ~100,000 seconds." | **86,400.** 10^5 is fine for the first pass, but know the real number when precision matters. |
| "Peak QPS = average QPS." | Peak is **2–3× average** (spikier for consumer apps with an evening peak). State the factor you assume. |
| "Storage = records × size × time." | Multiply by **replication factor** too — RF 3 triples it. |
| "It's 5." | 5 *what*? **Always label the unit.** 5 KB and 5 MB are three orders of magnitude apart. |
| "Read 1 MB from disk is like from memory." | Disk sequential is ~825 µs vs 3 µs from memory — **~275× slower**, and a disk *seek* is 2 ms. Avoid seeks. |
| "KB is 1,024 bytes." | Strictly that's **KiB**; KB = 1,000. The book (and everyone) uses KB loosely for 2^10 — fine for estimates, but know the distinction. |
| "More nines is just a bit better." | Each nine is **10× less downtime** and roughly 10× more engineering effort. Five nines ≈ 5 min/year — a brutal budget. |

---

## 🏃 Mental-math shortcuts

- **Seconds in a day ≈ 10^5.** (Real: 86,400.) QPS becomes a decimal shift.
- **1M ÷ 100,000 = 10.** So "1M actions/day" ≈ 10 QPS. Scale from there: 100M/day ≈ 1,000 QPS; 1B/day ≈ 10,000 QPS.
- **Each nine ÷10 the downtime.** Anchor on 99.9 % = ~9 hr/yr, then shift.
- **The ×1000 ladder.** KB→MB→GB→TB→PB. Any storage number is "how many rungs up from bytes".
- **Round the ugly parts first.** `99987 / 9.1` → `100,000 / 10`. Then decide if the leftover factor matters (usually not).

---

## 🧪 Self-test loop

The cheapest revision, in order:

1. **The three tables** — reproduce powers-of-two, the availability nines, and the shape of the latency numbers from memory.
2. **The 60-second method** — say it out loud without looking.
3. **The Twitter example** — derive 3,500 QPS and 55 PB from the five assumptions, on paper.
4. **The traps** — read the left column, correct it yourself, check against the right.
5. **[The calculator ↗](https://estimation.mhayk.workers.dev/estimator/)** — invent an app, guess its envelope, then check your mental arithmetic against the tool.
