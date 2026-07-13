import type { Decision, RateLimiter } from '../types.ts';

export type SlidingWindowCounterOptions = {
  /** Requests allowed per rolling window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * The book notes the estimate "can either be rounded up or down"; its worked
   * example rounds 6.5 down to 6. Rounding down is permissive at the margin,
   * rounding up is strict. Default: `down`, matching the book.
   */
  rounding?: 'down' | 'up';
};

/**
 * Sliding window counter.
 *
 * The hybrid, and the one that actually ships. Keep just two integers — the
 * count in the current window and the count in the previous one — and estimate
 * the rolling count by *weighting the previous window by how much of it the
 * rolling window still overlaps*:
 *
 *     estimate = current + previous * overlap
 *     overlap  = 1 - (elapsed in current window / window length)
 *
 * The book's example: limit 7/min, 5 requests in the previous minute, 3 in the
 * current, a request arriving 30% into the current minute. The rolling window
 * still covers 70% of the previous minute, so:
 *
 *     3 + 5 * 0.7 = 6.5 -> 6 (rounded down), which is under 7 -> allowed.
 *
 * It is an *approximation*: it assumes the previous window's requests were
 * spread evenly across it, which they may not have been. That assumption is
 * doing real work, and it can be wrong in both directions. But Cloudflare
 * measured the damage at 0.003% of 400 million requests wrongly allowed or
 * wrongly limited — which, for two integers per client instead of a full
 * timestamp log, is an outstanding trade.
 */
export class SlidingWindowCounter implements RateLimiter {
  readonly name = 'sliding-window-counter';
  readonly label = 'Sliding window counter';
  readonly gauge: { key: string; max: number };

  private readonly limit: number;
  private readonly windowMs: number;
  private readonly rounding: 'down' | 'up';

  private windowStart = -1;
  private count = 0;
  private previousCount = 0;

  constructor(opts: SlidingWindowCounterOptions) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.rounding = opts.rounding ?? 'down';
    this.gauge = { key: 'rolling', max: opts.limit };
  }

  get params() {
    return {
      limit: this.limit,
      'window(s)': this.windowMs / 1000,
      rounding: this.rounding,
    };
  }

  allow(t: number): Decision {
    const windowStart = Math.floor(t / this.windowMs) * this.windowMs;

    if (windowStart !== this.windowStart) {
      // Only the *immediately* preceding window carries over. If we skipped one
      // or more windows entirely, there is nothing to carry.
      const isAdjacent = windowStart === this.windowStart + this.windowMs;
      this.previousCount = isAdjacent ? this.count : 0;
      this.windowStart = windowStart;
      this.count = 0;
    }

    const elapsed = t - windowStart;
    const overlap = 1 - elapsed / this.windowMs;
    const estimate = this.count + this.previousCount * overlap;
    const rolling =
      this.rounding === 'down' ? Math.floor(estimate) : Math.ceil(estimate);

    const allowed = rolling < this.limit;
    if (allowed) this.count += 1;

    return {
      t,
      allowed,
      state: {
        rolling,
        current: this.count,
        previous: this.previousCount,
        // Handy when debugging or teaching: the raw, unrounded estimate.
        estimate: Math.round(estimate * 100) / 100,
      },
    };
  }
}
