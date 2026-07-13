import type { Decision, RateLimiter } from '../types.ts';

export type TokenBucketOptions = {
  /** Maximum number of tokens the bucket can hold. Governs burst size. */
  capacity: number;
  /** Tokens added per second. Governs the sustained rate. */
  refillPerSecond: number;
  /**
   * How tokens are added back.
   *
   * - `continuous` — tokens accrue smoothly, fractionally, as time passes.
   *   This is what real implementations (Stripe, AWS) do, and what you should
   *   describe in an interview.
   * - `interval` — the full refill lands in one lump every `1 / refillPerSecond`
   *   seconds. This is what the book's Figure 4-6 actually draws ("4 tokens are
   *   refilled at 1 minute interval"), and it is deliberately supported here so
   *   the figure is reproducible. It is burstier than continuous refill.
   */
  refillMode?: 'continuous' | 'interval';
  /** Starting tokens. Defaults to a full bucket. */
  initialTokens?: number;
};

/**
 * Token bucket.
 *
 * A bucket holds up to `capacity` tokens and is topped up at `refillPerSecond`.
 * Each request costs one token; no token, no entry. Surplus tokens overflow and
 * are lost, which is what caps the burst.
 *
 * The key property: it *allows bursts* (up to `capacity` back-to-back) while
 * still holding the long-run average down to `refillPerSecond`. That is why it
 * is the default choice for public APIs — real clients are bursty, and punishing
 * them for it is user-hostile.
 */
export class TokenBucket implements RateLimiter {
  readonly name = 'token-bucket';
  readonly label = 'Token bucket';
  readonly gauge: { key: string; max: number };

  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly refillMode: 'continuous' | 'interval';
  private readonly intervalMs: number;

  private tokens: number;
  /** Last time we accrued tokens (continuous) or the last lump refill (interval). */
  private lastRefillAt = 0;

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerSecond = opts.refillPerSecond;
    this.refillMode = opts.refillMode ?? 'continuous';
    this.intervalMs = (opts.capacity / opts.refillPerSecond) * 1000;
    this.tokens = opts.initialTokens ?? opts.capacity;
    this.gauge = { key: 'tokens', max: opts.capacity };
  }

  get params() {
    return {
      capacity: this.capacity,
      'refill/s': this.refillPerSecond,
      mode: this.refillMode,
    };
  }

  private refill(t: number): void {
    if (this.refillMode === 'continuous') {
      const elapsedSeconds = (t - this.lastRefillAt) / 1000;
      this.tokens = Math.min(
        this.capacity,
        this.tokens + elapsedSeconds * this.refillPerSecond,
      );
      this.lastRefillAt = t;
      return;
    }

    // Interval mode: tokens arrive in lumps, not smoothly.
    const lumps = Math.floor((t - this.lastRefillAt) / this.intervalMs);
    if (lumps > 0) {
      const tokensPerLump = (this.intervalMs / 1000) * this.refillPerSecond;
      this.tokens = Math.min(this.capacity, this.tokens + lumps * tokensPerLump);
      this.lastRefillAt += lumps * this.intervalMs;
    }
  }

  allow(t: number): Decision {
    this.refill(t);

    // Floating point: 0.9999999 tokens should count as one.
    const allowed = this.tokens >= 1 - 1e-9;
    if (allowed) this.tokens -= 1;

    return {
      t,
      allowed,
      state: { tokens: Math.max(0, this.tokens) },
    };
  }
}
