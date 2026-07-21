# 🏗️ System Design

A personal repository for studying, practising, and documenting **system design** — one architecture at a time.

The goal is simple: pick a real-world product, break down how it works, and rebuild its architecture from first principles. Each design is a self-contained case study covering requirements, trade-offs, data models, scaling strategies, and the reasoning behind every decision.

---

## 🎯 Goals

- **Learn by doing** — designing real systems is the fastest way to internalise the concepts.
- **Build intuition** — understand *why* a particular approach wins, not just *what* it is.
- **Create a reference** — a growing library I can revisit before interviews or design discussions.
- **Track progress** — watch the depth and quality of the designs improve over time.

---

## 📚 Designs

| # | System | Status | Notes |
|---|--------|--------|-------|
| 01 | [Uber](./designs/01-uber/) | 🚧 In progress | Ride-hailing: real-time matching, location tracking, pricing |
| 02 | [Rate limiter](./designs/02-rate-limiter/) | ✅ Complete | Throttling: five algorithms, Redis counters, the distributed race condition. Ships with a [runnable simulator](./designs/02-rate-limiter/simulator/) — **[try it live ↗](https://rate-limiter.mhayk.workers.dev/)** |

> Status legend: 🚧 In progress · ✅ Complete · 🧊 Planned

---

## 🧰 Resources

Cross-cutting references that serve every design, not just one:

| Resource | What it is |
|----------|------------|
| [📐 Estimation](./resources/estimation/) | Back-of-the-envelope sizing — QPS, storage, bandwidth, latency, availability. A [reference](./resources/estimation/README.md), a [recall deck](./resources/estimation/cheat-sheet.md), and two live tools: an [interactive calculator ↗](https://estimation.mhayk.workers.dev/estimator/) and a [printable wall poster ↗](https://estimation.mhayk.workers.dev/poster/). |

---

## 🗂️ Repository Structure

```
system-design/
├── README.md                 # You are here
├── designs/                  # One folder per system design
│   ├── 01-uber/
│   │   ├── README.md          # The design write-up
│   │   ├── diagrams/          # Architecture & sequence diagrams
│   │   └── notes.md           # Scratch notes, references, open questions
│   └── 02-rate-limiter/
│       ├── README.md          # The design write-up
│       ├── notes.md           # Active-recall deck for interview prep
│       ├── diagrams/          # Architecture, algorithms, distributed concerns
│       └── simulator/         # Runnable: the five algorithms, tests, CLI, visual
└── resources/                # Shared, cross-cutting references
    └── estimation/            # Back-of-the-envelope: reference, deck, poster, calculator
```

Some designs ship with a **simulator** — a runnable implementation of the thing being designed. It is the most useful part: reading about an algorithm and *implementing* it are different activities, and the second one is where the misunderstandings surface. The rate limiter's simulator contradicted the book twice.

Where a simulator has a visual version, it is deployed on Cloudflare Workers (see [`wrangler.jsonc`](./wrangler.jsonc)) and linked from the table above:

- 🚦 **[Rate Limiter Scope](https://rate-limiter.mhayk.workers.dev/)** — all five algorithms processing the same live traffic stream. Hit *Boundary attack* and watch the fixed window let through twice its limit.

---

## 🧩 Design Template

Each design follows a consistent structure so they are easy to compare and revisit:

1. **Problem statement** — what are we building and for whom?
2. **Functional requirements** — what the system must *do*.
3. **Non-functional requirements** — scalability, availability, latency, consistency.
4. **Scale estimation** — back-of-the-envelope numbers (users, QPS, storage).
5. **API design** — the core endpoints and contracts.
6. **High-level architecture** — the major components and how they talk.
7. **Data model** — schemas, storage choices, and the reasoning behind them.
8. **Deep dives** — the hard parts, examined in detail.
9. **Bottlenecks & trade-offs** — what breaks first and how we mitigate it.
10. **Future improvements** — what I would revisit with more time.

---

## 🛠️ Tools & Conventions

- **Diagrams** — drawn with [Mermaid](https://mermaid.js.org/), which renders natively on GitHub. House style is the hand-drawn look with the ELK layout engine:

  ```
  ---
  config:
    look: handDrawn
    layout: elk
    theme: neutral
  ---
  ```
- **Language** — all write-ups are in British English.
- **Format** — Markdown throughout, kept readable on GitHub.
- **Simulators** — zero-dependency TypeScript, run directly by Node 22+ via native type stripping (`node --experimental-strip-types`). No `npm install`, no build step, no lock file. Tests use the built-in `node:test` runner and pin the implementation to the book's own worked examples, so a passing suite means the simulator still agrees with the source material.

---

## 🚀 Roadmap

A non-exhaustive list of systems I would like to design next:

- [ ] Uber (in progress)
- [x] Rate limiter
- [ ] URL shortener (TinyURL)
- [ ] Chat application (WhatsApp / Messenger)
- [ ] News feed (Twitter / Instagram)
- [ ] Video streaming (YouTube / Netflix)
- [ ] Distributed cache
- [ ] Notification service

---

## 🤝 Contributing

This is a personal study repository, but suggestions, corrections, and discussions are always welcome — feel free to open an issue.

---

_Built one system at a time. 📈_
