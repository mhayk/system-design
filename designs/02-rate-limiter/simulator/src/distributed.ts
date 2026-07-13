/**
 * The race condition, made reproducible.
 *
 * The book's Figure 4-14: two requests both read the counter as 3, both write 4,
 * and the counter that should have reached 5 sits at 4. Here we scale that up to
 * an arbitrary number of concurrent requests and watch the limit fall apart.
 *
 * Nothing here is actually concurrent — it is a deterministic event schedule.
 * That is the point: a race condition is not "random", it is an *interleaving*,
 * and once you can name the interleaving you can reason about the fix.
 */

export type Strategy =
  /**
   * What a naive implementation does, and what the book describes:
   *
   *     value = GET counter          <- network round trip
   *     if value + 1 > limit: reject
   *     SET counter = value + 1      <- another round trip
   *
   * Between the GET and the SET there is a window — one network round trip wide —
   * in which every other request in flight reads the same stale value.
   */
  | 'read-check-write'
  /**
   * What Redis actually gives you: the read, the check and the write happen as
   * one indivisible operation that no other client can interleave with. In
   * practice that is a Lua script (`EVAL`) or a sorted-set pipeline in a
   * transaction — see `redis/token-bucket.lua`.
   */
  | 'atomic';

export type RaceResult = {
  strategy: Strategy;
  limit: number;
  concurrency: number;
  /** How many requests the limiter let through. */
  allowed: number;
  /** What the counter says at the end — which may not be the truth. */
  finalCounter: number;
  /** How many requests got through *over* the limit. */
  overAdmitted: number;
  /** Writes that were silently clobbered by a concurrent write. */
  lostUpdates: number;
  /** Human-readable event log. */
  timeline: string[];
};

export type RaceOptions = {
  limit: number;
  /** How many requests are in flight at roughly the same moment. */
  concurrency: number;
  /** How far apart the requests arrive. Small gap = tight race. */
  gapMs?: number;
  /** Round-trip latency to the counter store. This is the width of the race window. */
  rttMs?: number;
};

/**
 * Run one strategy against a burst of near-simultaneous requests.
 */
export function raceCondition(
  strategy: Strategy,
  opts: RaceOptions,
): RaceResult {
  const { limit, concurrency } = opts;
  const gapMs = opts.gapMs ?? 1;
  const rttMs = opts.rttMs ?? 5;

  let counter = 0;
  let allowed = 0;
  let lostUpdates = 0;
  const timeline: string[] = [];

  if (strategy === 'atomic') {
    // One indivisible operation per request. No interleaving is possible, so
    // arrival order is the only thing that matters.
    for (let id = 0; id < concurrency; id++) {
      const t = id * gapMs;
      if (counter < limit) {
        counter += 1;
        allowed += 1;
        timeline.push(
          `t=${String(t).padStart(3)}ms  req${String(id).padStart(2)}  INCR -> ${counter}  ALLOW`,
        );
      } else {
        timeline.push(
          `t=${String(t).padStart(3)}ms  req${String(id).padStart(2)}  counter=${counter} >= ${limit}  REJECT`,
        );
      }
    }

    return {
      strategy,
      limit,
      concurrency,
      allowed,
      finalCounter: counter,
      overAdmitted: Math.max(0, allowed - limit),
      lostUpdates: 0,
      timeline,
    };
  }

  // read-check-write: the read and the write are separate trips to the store,
  // and everything else in flight gets to run in between.
  type Event =
    | { t: number; kind: 'read'; id: number }
    | { t: number; kind: 'write'; id: number };

  const events: Event[] = [];
  for (let id = 0; id < concurrency; id++) {
    events.push({ t: id * gapMs, kind: 'read', id });
    events.push({ t: id * gapMs + rttMs, kind: 'write', id });
  }
  // Stable sort by time; at equal times, reads land before writes (they were
  // issued earlier). This is one legal interleaving of many — and the fact that
  // a *legal* schedule breaks the limit is the whole argument.
  events.sort((a, b) => a.t - b.t || (a.kind === 'read' ? -1 : 1));

  /** What each request read, before it decides. */
  const readValue = new Map<number, number>();

  for (const event of events) {
    if (event.kind === 'read') {
      readValue.set(event.id, counter);
      timeline.push(
        `t=${String(event.t).padStart(3)}ms  req${String(event.id).padStart(2)}  GET  -> ${counter}`,
      );
      continue;
    }

    const seen = readValue.get(event.id)!;

    if (seen >= limit) {
      timeline.push(
        `t=${String(event.t).padStart(3)}ms  req${String(event.id).padStart(2)}  saw ${seen} >= ${limit}  REJECT`,
      );
      continue;
    }

    // It decided based on `seen`, so it writes `seen + 1` — clobbering whatever
    // anyone else wrote in the meantime.
    const clobbered = counter !== seen;
    if (clobbered) lostUpdates += 1;

    counter = seen + 1;
    allowed += 1;

    timeline.push(
      `t=${String(event.t).padStart(3)}ms  req${String(event.id).padStart(2)}  saw ${seen}, SET ${seen + 1}` +
        (clobbered ? `  <- LOST UPDATE (counter had moved on)` : '') +
        `  ALLOW`,
    );
  }

  return {
    strategy,
    limit,
    concurrency,
    allowed,
    finalCounter: counter,
    overAdmitted: Math.max(0, allowed - limit),
    lostUpdates,
    timeline,
  };
}
