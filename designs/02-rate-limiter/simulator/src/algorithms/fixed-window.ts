import type { Decision, RateLimiter } from '../types.ts';

export type FixedWindowOptions = {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

/**
 * Fixed window counter.
 *
 * The timeline is chopped into fixed, *wall-clock-aligned* windows (every whole
 * minute, say). Each window owns a counter that starts at zero. Count up; reject
 * once the counter hits the limit; reset when the next window starts.
 *
 * Dirt cheap — one integer per client — and correspondingly naive. The
 * alignment is the flaw: a client that sends its full quota just before the
 * boundary and its full quota again just after has pushed 2x the limit through
 * a window of the same length, straddling the boundary. See the
 * `fixed-window-edge-burst` scenario, which is the book's Figure 4-9.
 */
export class FixedWindow implements RateLimiter {
  readonly name = 'fixed-window';
  readonly label = 'Fixed window';
  readonly gauge: { key: string; max: number };

  private readonly limit: number;
  private readonly windowMs: number;

  private windowStart = -1;
  private count = 0;

  constructor(opts: FixedWindowOptions) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.gauge = { key: 'count', max: opts.limit };
  }

  get params() {
    return { limit: this.limit, 'window(s)': this.windowMs / 1000 };
  }

  allow(t: number): Decision {
    // Windows are aligned to the clock, not to first use. This is exactly what
    // creates the boundary burst.
    const windowStart = Math.floor(t / this.windowMs) * this.windowMs;

    if (windowStart !== this.windowStart) {
      this.windowStart = windowStart;
      this.count = 0;
    }

    const allowed = this.count < this.limit;
    if (allowed) this.count += 1;

    return { t, allowed, state: { count: this.count } };
  }
}
