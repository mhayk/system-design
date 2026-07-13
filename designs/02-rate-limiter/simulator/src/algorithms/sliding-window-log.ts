import type { Decision, RateLimiter } from '../types.ts';

export type SlidingWindowLogOptions = {
  /** Requests allowed in any rolling window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

/**
 * Sliding window log.
 *
 * Keep a timestamp for every request. On each arrival: evict everything older
 * than the window, append the newcomer, then check the size of the log.
 *
 * This is the *exact* algorithm — in any rolling window, by construction, the
 * count can never exceed the limit. No boundary burst, no approximation.
 *
 * The catch, and the bit candidates forget: the timestamp of a **rejected**
 * request is still appended and still held in memory (the book is explicit —
 * "this request is rejected even though the timestamp remains in the log").
 * So a client hammering you at 100x your limit costs you 100x the memory. That
 * is a denial-of-wallet vector, and it is why nobody runs this at the edge.
 *
 * In production this is a Redis sorted set: ZREMRANGEBYSCORE to evict, ZADD to
 * append, ZCARD to count — see `redis/sliding-window-log.lua`.
 */
export class SlidingWindowLog implements RateLimiter {
  readonly name = 'sliding-window-log';
  readonly label = 'Sliding window log';
  readonly gauge: { key: string; max: number };

  private readonly limit: number;
  private readonly windowMs: number;

  /** Timestamps of every request seen in the window — accepted *and* rejected. */
  private log: number[] = [];

  constructor(opts: SlidingWindowLogOptions) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    // The log can grow past the limit, so give the gauge headroom.
    this.gauge = { key: 'log', max: opts.limit };
  }

  get params() {
    return { limit: this.limit, 'window(s)': this.windowMs / 1000 };
  }

  allow(t: number): Decision {
    // Evict timestamps that have fallen out of the rolling window.
    //
    // The window is half-open — `(t - w, t]` — so a request that is *exactly* w
    // old has aged out. The book's prose is ambiguous here and its worked example
    // never lands on the boundary, so it does not settle the question. Two things
    // do:
    //
    //  1. Redis settles it. `ZREMRANGEBYSCORE key -inf (now - window)` is
    //     inclusive of its max, so the real implementation evicts at exactly w.
    //     A closed window here would have made this file disagree with our own
    //     `redis/sliding-window-log.lua`.
    //
    //  2. A closed window is pathological. A client sending at exactly the limit
    //     (30/min, evenly spaced, against a 30/min limit) counts 31 requests in
    //     the closed window `[t - w, t]` — both endpoints — and gets refused.
    //     Worse, because a rejected request's timestamp is stored too, the log
    //     never drains back below the limit and the client is locked out
    //     permanently. Perfectly compliant traffic, refused forever.
    const cutoff = t - this.windowMs;
    while (this.log.length > 0 && this.log[0]! <= cutoff) {
      this.log.shift();
    }

    // Append first, then check — the rejected request's timestamp stays.
    this.log.push(t);
    const allowed = this.log.length <= this.limit;

    return { t, allowed, state: { log: this.log.length } };
  }
}
