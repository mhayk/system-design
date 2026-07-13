import {
  FixedWindow,
  LeakingBucket,
  SlidingWindowCounter,
  SlidingWindowLog,
  TokenBucket,
} from './algorithms/index.ts';
import { burst, edgeBurst, exact, poisson, steady } from './traffic.ts';
import type { Scenario } from './types.ts';

const MINUTE = 60_000;

/** The five algorithms, all configured to the same nominal limit. */
function allFive(limit: number, windowMs: number) {
  return [
    new TokenBucket({ capacity: limit, refillPerSecond: limit / (windowMs / 1000) }),
    new LeakingBucket({ capacity: limit, outflowPerSecond: limit / (windowMs / 1000) }),
    new FixedWindow({ limit, windowMs }),
    new SlidingWindowLog({ limit, windowMs }),
    new SlidingWindowCounter({ limit, windowMs }),
  ];
}

export const scenarios: Scenario[] = [
  // ---------------------------------------------------------------------------
  // Scenarios that reproduce the book's figures exactly.
  // ---------------------------------------------------------------------------
  {
    name: 'token-bucket-figure-4-6',
    figure: 'Figure 4-6',
    summary: "The book's token bucket walkthrough: bucket size 4, refill 4 per minute.",
    markEveryMs: MINUTE,
    traffic: exact(
      'book',
      "the book's arrivals: one at 0:00, three at 0:05, one at 0:20, one at 1:00",
      [0, 5_000, 5_000, 5_000, 20_000, 60_000],
      90_000,
    ),
    limiters: () => [
      new TokenBucket({
        capacity: 4,
        refillPerSecond: 4 / 60,
        // The figure refills in one lump every minute, not smoothly.
        refillMode: 'interval',
      }),
    ],
    lesson: `
      Read the tokens column in the trace (--trace) and follow the book's figure:
      start full at 4, spend one, spend three more, hit zero, get rejected, then
      the refill lands at 1:00 and the bucket is full again.

      The bucket is a *savings account*. Idle time earns tokens; a burst spends
      them. That is the whole idea, and it is why a client that has been quiet
      for a minute may fire four requests back-to-back without being punished.
    `,
  },

  {
    name: 'sliding-log-figure-4-10',
    figure: 'Figure 4-10',
    summary: 'The sliding window log, allowing 2 requests per minute.',
    markEveryMs: MINUTE,
    traffic: exact(
      'book',
      "the book's timestamps: 0:01, 0:30, 0:50, 1:40",
      [1_000, 30_000, 50_000, 100_000],
      120_000,
    ),
    limiters: () => [new SlidingWindowLog({ limit: 2, windowMs: MINUTE })],
    lesson: `
      Watch the "log" column, not the decision column. At 0:50 the request is
      REJECTED and yet the log grows to 3 — the rejected request's timestamp is
      stored anyway.

      That is the algorithm's whole weakness in one line. A client hammering you
      at 100x your limit costs you 100x the memory, and every one of those
      timestamps is one you are paying to store on behalf of traffic you already
      decided to refuse.

      By 1:40 the two oldest timestamps have aged out of the window, so the log
      shrinks back to 2 and the request is allowed.
    `,
  },

  {
    name: 'sliding-counter-figure-4-11',
    figure: 'Figure 4-11',
    summary: "The sliding window counter's weighted estimate: 3 + 5 x 0.7 = 6.5.",
    markEveryMs: MINUTE,
    traffic: exact(
      'book',
      '5 requests in the previous minute, 3 in the current, then one at the 30% mark',
      [
        // Previous window: 5 requests.
        10_000, 20_000, 30_000, 40_000, 50_000,
        // Current window: 3 requests.
        60_500, 61_000, 61_500,
        // The book's request, arriving 30% into the current minute.
        78_000,
        // And one more, to show the limit being reached.
        78_100,
      ],
      120_000,
    ),
    limiters: () => [new SlidingWindowCounter({ limit: 7, windowMs: MINUTE })],
    lesson: `
      Run with --trace and look at the request at 1:18 — that is 30% into the
      second minute. previous=5, current=3, so the rolling window still overlaps
      70% of the previous minute:

          estimate = 3 + 5 x 0.7 = 6.5  ->  6 (rounded down)  ->  6 < 7  ->  ALLOWED

      That is the book's number, exactly. Now look at the very next request: the
      estimate climbs to 7.49 -> 7, and 7 is not < 7, so it is rejected. The book
      says "the limit will be reached after receiving one more request" — this is
      that request.

      Note: the book's *text* uses a limit of 7, while the image in Figure 4-11 is
      labelled "5 requests/min". The text is what the worked example follows, so
      that is what we implement.
    `,
  },

  // ---------------------------------------------------------------------------
  // The comparison scenarios — where the algorithms stop agreeing.
  // ---------------------------------------------------------------------------
  {
    name: 'fixed-window-edge-burst',
    figure: 'Figure 4-9',
    summary:
      'The boundary attack: a full quota either side of a window edge. The fixed window lets 2x through.',
    markEveryMs: MINUTE,
    traffic: edgeBurst({ limit: 5, windowMs: MINUTE, offsetMs: 20_000 }),
    limiters: () => allFive(5, MINUTE),
    lesson: `
      Every limiter here is configured for 5 requests per minute. Ten requests
      arrive, all of them inside a single 21-second span that happens to straddle
      the minute boundary.

      The FIXED WINDOW lets all ten through — and it is not even wrong by its own
      logic. Five landed in minute one, five in minute two; both windows are
      individually legal. But the rolling minute that straddles the boundary saw
      double the limit. That is the flaw, and it is not a corner case: aligned
      windows mean every client on your platform shares the same boundary, so a
      cron job firing on the minute across a fleet hits you all at once.

      The SLIDING WINDOW LOG is exact — 5, never more, because it is literally
      counting the requests in the true rolling window.

      The SLIDING WINDOW COUNTER lets 6 through, not 5. It is an approximation and
      here you can watch it be slightly wrong. But "slightly" is the point: 6 vs
      the fixed window's 10, for two integers of memory instead of a full log.

      The TOKEN BUCKET also lets 6 through, and its warning is honest rather than a
      bug. A bucket sized to the limit starts full, so it can spend its entire
      capacity *and* whatever trickles in while the burst is landing. That is the
      burst allowance you explicitly asked for when you chose this algorithm. If
      you need a hard ceiling in every rolling window, the token bucket is not
      your algorithm — that is what the sliding window log is for.

      The LEAKING BUCKET's peak stays at 5 because it does not release the burst —
      it queues it and drips it out. Look at what that costs: the queueing delay
      line. Requests are being answered nearly a minute after they were sent.
    `,
  },

  {
    name: 'flash-sale-burst',
    summary:
      'A quiet API takes a sudden 30-request spike. Who absorbs it, who drops it, who defers it?',
    markEveryMs: MINUTE,
    traffic: burst({
      durationMs: 3 * MINUTE,
      baselinePerSecond: 0.1,
      burstAtMs: 90_000,
      burstSize: 30,
      burstSpreadMs: 2_000,
    }),
    limiters: () => allFive(20, MINUTE),
    lesson: `
      This is the flash sale, the retry storm, the celebrity tweet. All five
      limiters are set to 20 requests per minute, and the API has been almost idle
      before the spike.

      The TOKEN BUCKET is the star here, and this scenario is why it is the
      default choice for public APIs. The quiet period *banked* tokens, so when
      the burst lands the bucket is full and pays for a big chunk of it
      immediately. Bursty clients are normal clients; punishing them for
      bunching up requests they were always entitled to make is user-hostile.

      The LEAKING BUCKET admits what fits in its queue and then drips it out at a
      constant rate. Downstream never sees a spike — beautiful for a service that
      cannot scale quickly. Check the queueing delay: that smoothness is bought
      with latency, and the requests still waiting in the queue may belong to
      users who gave up long ago.

      The WINDOW algorithms have no memory of the quiet period. They cap at 20 and
      throw the rest away, no matter how well-behaved the client was beforehand.
    `,
  },

  {
    name: 'steady-traffic',
    summary: 'A metronomic client at 80% of the limit. Everyone agrees — and that is the point.',
    markEveryMs: MINUTE,
    traffic: steady(0.4, 3 * MINUTE),
    limiters: () => allFive(30, MINUTE),
    lesson: `
      30 requests per minute allowed; a client sending 24 per minute, perfectly
      evenly spaced.

      Everything passes, everywhere. The five algorithms are indistinguishable
      under polite traffic — which is precisely why you cannot evaluate a rate
      limiter on the happy path. They only differ under stress, and if you pick
      one by testing it with traffic like this you have learned nothing.

      Now run 'poisson-traffic'. Same average rate. Very different outcome.
    `,
  },

  {
    name: 'poisson-traffic',
    summary:
      'The same average rate as steady-traffic, but realistically clumpy — and now there are rejections.',
    markEveryMs: MINUTE,
    traffic: poisson({ ratePerSecond: 0.4, durationMs: 10 * MINUTE, seed: 11 }),
    limiters: () => allFive(30, MINUTE),
    lesson: `
      Run this straight after 'steady-traffic'. The mean rate is the SAME — about
      25 requests per minute against a limit of 30, comfortably under quota. The
      only thing that changed is that arrivals are now Poisson: independent
      clients showing up on their own schedule, rather than on a metronome.

      Look at what that alone did to the peaks.

      Under steady traffic every limiter sat at a peak of 24 and rejected nothing.
      Here, FOUR of the five delivered 34 requests in a rolling minute — over a
      limit of 30 — from a client whose average never came close to it. Nothing
      misbehaved. Random arrivals simply *clump*, and the clumps breach a limit
      the average never approaches.

      Only the SLIDING WINDOW LOG held the line at exactly 30. And look at what
      that cost: it refused 18 requests from a client sitting at 83% of its quota.

      There is the whole trade-off, on one screen. You can be exact and reject
      compliant-on-average clients, or be permissive and overshoot your own limit.
      There is no third option that is both, and choosing between them is a
      product decision, not a technical one.

      Practical consequence worth remembering: when a customer says they are
      getting 429s while their dashboard shows they are well under the limit —
      they are not lying, and this is why.
    `,
  },

  {
    name: 'leaking-bucket-starvation',
    summary:
      'The leaking bucket con: a burst fills the queue with stale requests and starves the fresh ones.',
    markEveryMs: MINUTE,
    traffic: burst({
      durationMs: 2 * MINUTE,
      baselinePerSecond: 0.05,
      burstAtMs: 10_000,
      burstSize: 30,
      burstSpreadMs: 1_000,
    }),
    limiters: () => [
      new LeakingBucket({ capacity: 10, outflowPerSecond: 10 / 60 }),
      new TokenBucket({ capacity: 10, refillPerSecond: 10 / 60 }),
    ],
    lesson: `
      The book's stated con, made concrete: "a burst of traffic fills up the queue
      with old requests, and if they are not processed in time, recent requests
      will be rate limited."

      The burst at 0:10 fills the leaking bucket's queue. Every request that
      arrives afterwards — including perfectly reasonable, well-spaced ones — is
      rejected, not because the client misbehaved but because the queue is still
      grinding through requests from ten, twenty, forty seconds ago.

      Look at the worst queueing delay. Those "successful" requests were served so
      late that the user has very probably closed the tab. A 429 arriving
      instantly is often kinder than a 200 arriving a minute late.

      The token bucket, same capacity and same rate, rejects the overflow up front
      and stays responsive.
    `,
  },
];

export function findScenario(name: string): Scenario | undefined {
  return scenarios.find((s) => s.name === name);
}
