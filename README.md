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

> Status legend: 🚧 In progress · ✅ Complete · 🧊 Planned

---

## 🗂️ Repository Structure

```
system-design/
├── README.md                # You are here
├── designs/                 # One folder per system design
│   └── 01-uber/
│       ├── README.md         # The design write-up
│       ├── diagrams/         # Architecture & sequence diagrams
│       └── notes.md          # Scratch notes, references, open questions
└── resources/               # Shared notes, glossaries, reusable references
```

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

- **Diagrams** — drawn with [Mermaid](https://mermaid.js.org/) (renders directly in Markdown) or [Excalidraw](https://excalidraw.com/) for richer sketches.
- **Language** — all write-ups are in British English.
- **Format** — Markdown throughout, kept readable on GitHub.

---

## 🚀 Roadmap

A non-exhaustive list of systems I would like to design next:

- [ ] Uber (in progress)
- [ ] URL shortener (TinyURL)
- [ ] Chat application (WhatsApp / Messenger)
- [ ] News feed (Twitter / Instagram)
- [ ] Video streaming (YouTube / Netflix)
- [ ] Rate limiter
- [ ] Distributed cache
- [ ] Notification service

---

## 🤝 Contributing

This is a personal study repository, but suggestions, corrections, and discussions are always welcome — feel free to open an issue.

---

_Built one system at a time. 📈_
