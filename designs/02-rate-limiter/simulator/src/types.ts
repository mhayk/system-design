/**
 * Core types for the rate limiter simulator.
 *
 * Everything runs on a *virtual clock*: time is just a number of milliseconds
 * passed into `allow()`. Nothing sleeps, nothing races, and every run is
 * perfectly reproducible — which is what makes the book's figures testable.
 */

/** The outcome of a single admission decision. */
export type Decision = {
  /** Virtual arrival time of the request, in milliseconds. */
  t: number;
  /** Did the request get through? */
  allowed: boolean;
  /**
   * Snapshot of the limiter's internal state immediately *after* the decision.
   * This is what makes the algorithms legible: tokens left, queue depth,
   * window counter, log size, and so on.
   */
  state: Readonly<Record<string, number>>;
  /**
   * Leaking bucket only: how long the request waited in the queue before being
   * processed. This is the cost the other four algorithms do not pay.
   */
  queueDelayMs?: number;
  /**
   * When the request actually reached the downstream service. Only the leaking
   * bucket defers work; for everyone else this is the arrival time.
   *
   * This distinction matters when scoring a limiter. The leaking bucket *admits*
   * a burst but releases it at a constant drip, so judging it by arrival times
   * would wrongly accuse it of letting the burst through. What downstream sees
   * is the departure schedule, so that is what we measure.
   */
  departsAt?: number;
};

/**
 * Every algorithm implements this. `allow` must be called with
 * non-decreasing `t` — requests arrive in time order.
 */
export interface RateLimiter {
  /** Machine name, e.g. `token-bucket`. */
  readonly name: string;
  /** Human label for rendering, e.g. `Token bucket`. */
  readonly label: string;
  /** The tuning parameters, echoed back for display. */
  readonly params: Readonly<Record<string, string | number>>;
  /** Decide whether a request arriving at virtual time `t` (ms) is allowed. */
  allow(t: number): Decision;
  /** Which state key is worth plotting as the limiter's "level". */
  readonly gauge?: { key: string; max: number };
}

/** A traffic pattern: the virtual arrival times, in ms, of every request. */
export type Traffic = {
  name: string;
  description: string;
  /** Sorted, non-decreasing arrival times in milliseconds. */
  arrivals: number[];
  /** Total virtual duration of the trace, in ms. */
  durationMs: number;
};

/** A named, self-contained experiment. */
export type Scenario = {
  name: string;
  /** One-line summary shown by `--list`. */
  summary: string;
  /** The lesson this scenario exists to teach. Printed after the timeline. */
  lesson: string;
  /** Book cross-reference, e.g. `Figure 4-6`. Omitted for our own scenarios. */
  figure?: string;
  traffic: Traffic;
  /** Fresh limiter instances. A function so each run starts from a clean slate. */
  limiters: () => RateLimiter[];
  /**
   * Marker interval for the rendered timeline, in ms — usually the rate limit
   * window, so window boundaries line up visually.
   */
  markEveryMs?: number;
};
