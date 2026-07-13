import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FixedWindow,
  LeakingBucket,
  SlidingWindowCounter,
  SlidingWindowLog,
  TokenBucket,
} from '../src/algorithms/index.ts';

const MINUTE = 60_000;

/** Convenience: run a list of arrival times and collect the allow/reject flags. */
function decide(limiter: { allow(t: number): { allowed: boolean } }, arrivals: number[]) {
  return arrivals.map((t) => limiter.allow(t).allowed);
}

// ---------------------------------------------------------------------------
// These tests pin the algorithms to the book's own worked examples. If one of
// them ever fails, the simulator has stopped agreeing with Chapter 4 — which is
// the only thing that makes it trustworthy as study material.
// ---------------------------------------------------------------------------

describe('Token bucket — Figure 4-6', () => {
  // "the token bucket size is 4, and the refill rate is 4 per 1 minute"
  const bucket = () =>
    new TokenBucket({ capacity: 4, refillPerSecond: 4 / 60, refillMode: 'interval' });

  it('starts full and spends a token per request', () => {
    const b = bucket();
    const d = b.allow(0);
    assert.equal(d.allowed, true);
    assert.equal(d.state['tokens'], 3, 'one token consumed, 3 left');
  });

  it('lets three more through at 0:05, emptying the bucket', () => {
    const b = bucket();
    b.allow(0);
    const decisions = [b.allow(5_000), b.allow(5_000), b.allow(5_000)];
    assert.deepEqual(
      decisions.map((d) => d.allowed),
      [true, true, true],
      'all three go through',
    );
    assert.equal(decisions.at(-1)!.state['tokens'], 0, 'bucket is now empty');
  });

  it('drops the request at 0:20 because the bucket is empty', () => {
    const b = bucket();
    decide(b, [0, 5_000, 5_000, 5_000]);
    const d = b.allow(20_000);
    assert.equal(d.allowed, false);
    assert.equal(d.state['tokens'], 0);
  });

  it('refills 4 tokens at the 1 minute interval', () => {
    const b = bucket();
    decide(b, [0, 5_000, 5_000, 5_000, 20_000]);
    const d = b.allow(60_000);
    assert.equal(d.allowed, true, 'the refill has landed');
    assert.equal(d.state['tokens'], 3, '4 refilled, 1 spent on this request');
  });

  it('caps the burst at the bucket capacity, never more', () => {
    // Continuous refill this time — the real-world configuration.
    const b = new TokenBucket({ capacity: 4, refillPerSecond: 4 / 60 });
    // Ten requests, all at the same instant, against a full bucket of 4.
    const allowed = decide(b, Array(10).fill(0)).filter(Boolean).length;
    assert.equal(allowed, 4, 'capacity is the burst ceiling');
  });

  it('banks tokens while idle, up to capacity', () => {
    const b = new TokenBucket({ capacity: 4, refillPerSecond: 4 / 60, initialTokens: 0 });
    assert.equal(b.allow(0).allowed, false, 'empty bucket rejects');
    // Idle for two minutes — but the bucket only holds 4, so it does not bank 8.
    const allowed = decide(b, Array(10).fill(120_000)).filter(Boolean).length;
    assert.equal(allowed, 4, 'surplus tokens overflow and are lost');
  });
});

describe('Fixed window counter — Figures 4-8 and 4-9', () => {
  it('allows exactly `limit` requests per aligned window', () => {
    const w = new FixedWindow({ limit: 3, windowMs: 1_000 });
    // Figure 4-8: 3 requests per second allowed, 5 arrive in second 1.
    const results = decide(w, [1_000, 1_100, 1_200, 1_300, 1_400]);
    assert.deepEqual(results, [true, true, true, false, false]);
  });

  it('resets on the window boundary', () => {
    const w = new FixedWindow({ limit: 3, windowMs: 1_000 });
    decide(w, [0, 100, 200]);
    assert.equal(w.allow(999).allowed, false, 'still in window 1');
    assert.equal(w.allow(1_000).allowed, true, 'window 2 starts fresh');
  });

  it('THE FLAW: lets 2x the limit through a window straddling the boundary', () => {
    // Figure 4-9: 5 requests/min. Five just before the boundary, five just after.
    const w = new FixedWindow({ limit: 5, windowMs: MINUTE });

    const beforeBoundary = [40_000, 40_100, 40_200, 40_300, 40_400];
    const afterBoundary = [60_000, 60_100, 60_200, 60_300, 60_400];

    const results = decide(w, [...beforeBoundary, ...afterBoundary]);
    const allowed = results.filter(Boolean).length;

    assert.equal(allowed, 10, 'all ten got through');
    // ...and they all landed inside a 20.4 second span. The limit was 5/minute.
    const span = 60_400 - 40_000;
    assert.ok(span < MINUTE, 'all ten inside a single rolling minute');
    assert.equal(allowed, 2 * 5, 'exactly twice the configured limit');
  });
});

describe('Sliding window log — Figure 4-10', () => {
  // "the rate limiter allows 2 requests per minute"
  const log = () => new SlidingWindowLog({ limit: 2, windowMs: MINUTE });

  it('reproduces the figure exactly', () => {
    const l = log();
    // 1:00:01, 1:00:30, 1:00:50, 1:01:40 -> allow, allow, reject, allow
    assert.deepEqual(decide(l, [1_000, 30_000, 50_000, 100_000]), [
      true,
      true,
      false,
      true,
    ]);
  });

  it('stores the timestamp of a REJECTED request — the memory con', () => {
    const l = log();
    l.allow(1_000);
    l.allow(30_000);

    const rejected = l.allow(50_000);
    assert.equal(rejected.allowed, false, 'over the limit');
    assert.equal(
      rejected.state['log'],
      3,
      'the log grew to 3 even though the request was refused',
    );
  });

  it('evicts timestamps that fall out of the rolling window', () => {
    const l = log();
    decide(l, [1_000, 30_000, 50_000]);

    // At 1:40 the window is [0:40, 1:40). 0:01 and 0:30 are outdated; 0:50 survives.
    const d = l.allow(100_000);
    assert.equal(d.allowed, true);
    assert.equal(d.state['log'], 2, '0:50 plus the newcomer');
  });

  it('does not refuse a client sending exactly at the limit', () => {
    // A regression guard on the window's boundary semantics, which are subtle
    // enough that the "obvious" choice is wrong.
    //
    // The window must be half-open — (t - w, t] — so a request exactly w old has
    // aged out. Close it at both ends and a client sending 30/min against a
    // 30/min limit counts 31 in the window (both endpoints) and is refused. And
    // because a rejected request's timestamp is stored too, the log never drains
    // back under the limit: perfectly compliant traffic, locked out forever.
    const l = new SlidingWindowLog({ limit: 30, windowMs: MINUTE });

    // 30 requests per minute, evenly spaced, for five minutes.
    const arrivals = Array.from({ length: 150 }, (_, i) => i * 2_000);
    const allowed = decide(l, arrivals).filter(Boolean).length;

    assert.equal(allowed, 150, 'every request accepted — the client is compliant');
  });

  it('is exact: never exceeds the limit in ANY rolling window', () => {
    const l = new SlidingWindowLog({ limit: 5, windowMs: MINUTE });

    // The same boundary attack that beats the fixed window.
    const arrivals = [
      40_000, 40_100, 40_200, 40_300, 40_400, 60_000, 60_100, 60_200, 60_300, 60_400,
    ];
    const allowed = decide(l, arrivals).filter(Boolean).length;

    assert.equal(allowed, 5, 'the boundary attack does not work here');
  });
});

describe('Sliding window counter — Figure 4-11', () => {
  it("reproduces the book's 3 + 5 x 0.7 = 6.5 -> 6 -> allowed", () => {
    const c = new SlidingWindowCounter({ limit: 7, windowMs: MINUTE });

    // Previous minute: 5 requests.
    decide(c, [10_000, 20_000, 30_000, 40_000, 50_000]);
    // Current minute: 3 requests.
    decide(c, [60_500, 61_000, 61_500]);

    // The book's request: 30% into the current minute.
    const d = c.allow(60_000 + 0.3 * MINUTE);

    assert.equal(d.state['previous'], 5, '5 in the previous window');
    assert.equal(d.state['current'], 4, '3 before this one, now 4');
    assert.equal(d.state['estimate'], 6.5, 'the weighted estimate is exactly 6.5');
    assert.equal(d.state['rolling'], 6, 'rounded down to 6, as the book does');
    assert.equal(d.allowed, true, '6 < 7, so it goes through');
  });

  it('"the limit will be reached after receiving one more request"', () => {
    const c = new SlidingWindowCounter({ limit: 7, windowMs: MINUTE });
    decide(c, [10_000, 20_000, 30_000, 40_000, 50_000]);
    decide(c, [60_500, 61_000, 61_500]);
    c.allow(78_000); // the book's request — allowed

    const next = c.allow(78_100);
    assert.equal(next.allowed, false, 'the very next request is refused');
  });

  it('only carries over the IMMEDIATELY preceding window', () => {
    const c = new SlidingWindowCounter({ limit: 5, windowMs: MINUTE });
    decide(c, [10_000, 20_000, 30_000, 40_000, 50_000]); // window 0: 5 requests

    // Skip window 1 entirely. Window 2 must not inherit window 0's count.
    const d = c.allow(120_000);
    assert.equal(d.state['previous'], 0, 'a skipped window carries nothing');
    assert.equal(d.allowed, true);
  });

  it('is an approximation — it lets 6 through the boundary attack, not 5', () => {
    const c = new SlidingWindowCounter({ limit: 5, windowMs: MINUTE });
    const arrivals = [
      40_000, 40_100, 40_200, 40_300, 40_400, 60_000, 60_100, 60_200, 60_300, 60_400,
    ];
    const allowed = decide(c, arrivals).filter(Boolean).length;

    // Not the exact 5 of the sliding log — but nowhere near the fixed window's 10.
    assert.equal(allowed, 6, 'slightly permissive, hugely better than 10');
  });
});

describe('Leaking bucket — Figure 4-7', () => {
  it('admits up to the queue size, then drops', () => {
    const b = new LeakingBucket({ capacity: 3, outflowPerSecond: 1 });
    // Five requests at once against a queue of 3.
    const results = decide(b, [0, 0, 0, 0, 0]);
    assert.deepEqual(results, [true, true, true, false, false]);
  });

  it('releases requests at a constant rate, whatever the arrival pattern', () => {
    const b = new LeakingBucket({ capacity: 5, outflowPerSecond: 1 });

    // All five arrive simultaneously...
    const decisions = [0, 0, 0, 0, 0].map((t) => b.allow(t));
    assert.ok(
      decisions.every((d) => d.allowed),
      'all admitted',
    );

    // ...but they depart one per second. That is the whole point.
    const departures = decisions.map((d) => d.departsAt);
    assert.deepEqual(departures, [0, 1_000, 2_000, 3_000, 4_000]);
  });

  it('THE COST: admitted requests wait, and the wait grows with the burst', () => {
    const b = new LeakingBucket({ capacity: 5, outflowPerSecond: 1 });
    const decisions = [0, 0, 0, 0, 0].map((t) => b.allow(t));

    assert.equal(decisions[0]!.queueDelayMs, 0, 'first one is served immediately');
    assert.equal(decisions[4]!.queueDelayMs, 4_000, 'the last one waits 4 seconds');
  });

  it('THE CON: a later request is admitted, but stuck behind stale ones', () => {
    const b = new LeakingBucket({ capacity: 3, outflowPerSecond: 1 });

    // A burst of six at t=0 against a queue of three: three in, three dropped.
    const bursted = [0, 0, 0, 0, 0, 0].map((t) => b.allow(t));
    assert.deepEqual(
      bursted.map((d) => d.allowed),
      [true, true, true, false, false, false],
    );

    // Now a single, perfectly well-behaved request arrives half a second later.
    const polite = b.allow(500);

    assert.equal(polite.allowed, true, 'it does get in...');
    assert.equal(
      polite.queueDelayMs,
      2_500,
      '...but waits 2.5 seconds behind a burst it had nothing to do with',
    );

    // This is the book's con, and it is subtler than "recent requests are
    // dropped": the request is *accepted* and then served so late that the user
    // has very likely given up. A fast 429 can be kinder than a slow 200.
  });

  it('THE CON, harder: while the queue stays full, later requests ARE dropped', () => {
    const b = new LeakingBucket({ capacity: 3, outflowPerSecond: 1 });

    decide(b, [0, 0, 0, 0, 0, 0]); // burst fills the queue
    b.allow(500); // takes the one slot that drained

    // The queue is full again, and now the well-behaved client is simply refused.
    assert.equal(b.allow(600).allowed, false, 'starved by stale requests');
  });

  it('drains over time, freeing queue slots', () => {
    const b = new LeakingBucket({ capacity: 2, outflowPerSecond: 2 }); // one per 500ms
    assert.equal(b.allow(0).allowed, true);
    assert.equal(b.allow(0).allowed, true);
    assert.equal(b.allow(0).allowed, false, 'queue full');
    assert.equal(b.allow(600).allowed, true, 'one has drained, room again');
  });
});
