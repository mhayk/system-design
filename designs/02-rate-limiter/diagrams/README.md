# Diagrams

Diagrams for the **rate limiter** design, redrawn from Chapter 4 of *System Design Interview – An Insider's Guide* (Alex Xu).

They are split into three files so each one can be opened on its own and read end to end. Drawn with [Mermaid](https://mermaid.js.org/) — they render inline on GitHub.

| File | What it shows | Open it when… |
|---|---|---|
| [`architecture.md`](./architecture.md) | Where the rate limiter sits — server-side vs middleware, the 429 rejection, the high-level design with Redis counters, and the full detailed design with the rules pipeline and the message queue. | …you are asked *"where would you put it, and what does the system look like?"* |
| [`algorithms.md`](./algorithms.md) | The five algorithms — token bucket, leaking bucket, fixed window counter, sliding window log, sliding window counter — each with a worked example and the trade-off that picks it. | …you are asked *"which algorithm, and why?"*, or you want to re-derive all five from scratch. |
| [`distributed.md`](./distributed.md) | What breaks once there is more than one server: the race condition on the counter, the synchronisation problem, centralised Redis as the fix, plus edge/eventual consistency and monitoring. | …you have the happy path and the interviewer says *"now run it on a hundred servers"*. |

## Suggested reading order

1. **`architecture.md`** — establish the shape of the system and the vocabulary (middleware, 429, counters in Redis).
2. **`algorithms.md`** — the substance. Note the thread running through it: each algorithm exists to fix the flaw in the one before.
3. **`distributed.md`** — the deep dive. The two failures here are the ones interviewers reliably push on.

## The one insight per file

- **Architecture** — the middleware is **stateless**; all the state is in Redis. Everything else follows from that.
- **Algorithms** — the fixed window counter lets a burst straddling the boundary through at **twice the quota**. Every later algorithm is an answer to that.
- **Distributed** — a **centralised Redis** solves the race condition *and* the synchronisation problem in one move.

## Conventions

Every Mermaid block uses the repo's house style:

```
---
config:
  look: handDrawn
  layout: elk
  theme: neutral
---
```

Write-ups are in British English.
