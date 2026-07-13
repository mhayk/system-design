import type { Decision, RateLimiter } from '../types.ts';

export type LeakingBucketOptions = {
  /** Queue size. A request is dropped when the queue is already this deep. */
  capacity: number;
  /** Requests drained from the queue per second — the fixed outflow rate. */
  outflowPerSecond: number;
};

/**
 * Leaking bucket.
 *
 * A FIFO queue drained at a *constant* rate. An arriving request joins the queue
 * if there is room, otherwise it is dropped. The queue is the shock absorber and
 * the outflow rate never varies.
 *
 * This is the one algorithm of the five that does not answer "allow or reject"
 * immediately — an admitted request *waits*. That queueing delay is the whole
 * point (downstream sees a perfectly smooth stream) and also the whole problem:
 * under a burst the queue fills with stale requests, so a fresh request is
 * either rejected or served so late that nobody is waiting for it any more.
 *
 * We track `queueDelayMs` on every decision precisely so this cost is visible
 * rather than hand-waved.
 */
export class LeakingBucket implements RateLimiter {
  readonly name = 'leaking-bucket';
  readonly label = 'Leaking bucket';
  readonly gauge: { key: string; max: number };

  private readonly capacity: number;
  private readonly outflowPerSecond: number;
  /** Minimum gap between two departures — the fixed drain rate. */
  private readonly intervalMs: number;

  /** Departure times of the requests currently queued, in FIFO order. */
  private queue: number[] = [];
  /** When the most recently drained request left. */
  private lastDepartureAt = Number.NEGATIVE_INFINITY;

  constructor(opts: LeakingBucketOptions) {
    this.capacity = opts.capacity;
    this.outflowPerSecond = opts.outflowPerSecond;
    this.intervalMs = 1000 / opts.outflowPerSecond;
    this.gauge = { key: 'queue', max: opts.capacity };
  }

  get params() {
    return {
      capacity: this.capacity,
      'outflow/s': this.outflowPerSecond,
    };
  }

  /**
   * Drain every request whose departure time has already passed.
   *
   * Strictly `<`, not `<=`: a request departing at exactly `t` is still holding
   * its slot at the instant `t`. Otherwise a burst arriving all at the same
   * timestamp would see the first request depart and free its slot in the same
   * instant it took it, and the queue would never fill at all.
   */
  private leak(t: number): void {
    while (this.queue.length > 0 && this.queue[0]! < t) {
      this.lastDepartureAt = this.queue.shift()!;
    }
  }

  allow(t: number): Decision {
    this.leak(t);

    if (this.queue.length >= this.capacity) {
      return { t, allowed: false, state: { queue: this.queue.length } };
    }

    // The next departure is one drain interval after whatever leaves last —
    // or right now, if the bucket has been idle long enough.
    const previousDeparture =
      this.queue.length > 0 ? this.queue[this.queue.length - 1]! : this.lastDepartureAt;
    const departsAt = Math.max(t, previousDeparture + this.intervalMs);

    this.queue.push(departsAt);

    return {
      t,
      allowed: true,
      departsAt,
      queueDelayMs: departsAt - t,
      state: { queue: this.queue.length },
    };
  }
}
