import type { Decision, RateLimiter, Scenario } from './types.ts';

export type LimiterRun = {
  limiter: RateLimiter;
  decisions: Decision[];
  allowed: number;
  rejected: number;
  /**
   * The honest measure of a rate limiter: the most requests it ever delivered
   * downstream in *any* rolling window of the limit's length — not just the
   * clock-aligned ones it happens to count.
   *
   * A correct limiter's peak never exceeds its limit. The fixed window's does,
   * and this number is where that shows up.
   *
   * Measured on *departure* times, so the leaking bucket gets credit for
   * smoothing its queue rather than being blamed for admitting the burst.
   */
  peakInRollingWindow: number;
  /** Leaking bucket only: what admitted requests paid in queueing delay. */
  avgQueueDelayMs?: number;
  maxQueueDelayMs?: number;
};

export type SimulationResult = {
  scenario: Scenario;
  runs: LimiterRun[];
};

/**
 * The most requests admitted in any rolling window of `windowMs`.
 *
 * Two pointers over the sorted admission times: advance the right edge one
 * request at a time, drag the left edge forward until the window is legal, and
 * record the widest the gap ever got. O(n).
 */
function peakInRollingWindow(allowedTimes: number[], windowMs: number): number {
  let left = 0;
  let peak = 0;

  for (let right = 0; right < allowedTimes.length; right++) {
    // Keep the window half-open: [t - windowMs, t].
    while (allowedTimes[right]! - allowedTimes[left]! >= windowMs) left++;
    peak = Math.max(peak, right - left + 1);
  }

  return peak;
}

/** Run one limiter over one traffic trace. */
export function runLimiter(
  limiter: RateLimiter,
  arrivals: number[],
  rollingWindowMs: number,
): LimiterRun {
  const decisions: Decision[] = arrivals.map((t) => limiter.allow(t));

  const accepted = decisions.filter((d) => d.allowed);
  const delays = accepted
    .map((d) => d.queueDelayMs)
    .filter((d): d is number => d !== undefined);

  return {
    limiter,
    decisions,
    allowed: accepted.length,
    rejected: decisions.length - accepted.length,
    peakInRollingWindow: peakInRollingWindow(
      // Departure time where the limiter defers work, arrival time otherwise.
      accepted.map((d) => d.departsAt ?? d.t).sort((a, b) => a - b),
      rollingWindowMs,
    ),
    avgQueueDelayMs:
      delays.length > 0
        ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
        : undefined,
    maxQueueDelayMs: delays.length > 0 ? Math.max(...delays) : undefined,
  };
}

/** Run every limiter in a scenario over the same traffic trace. */
export function simulate(scenario: Scenario): SimulationResult {
  const rollingWindowMs = scenario.markEveryMs ?? 60_000;

  return {
    scenario,
    runs: scenario
      .limiters()
      .map((limiter) => runLimiter(limiter, scenario.traffic.arrivals, rollingWindowMs)),
  };
}
