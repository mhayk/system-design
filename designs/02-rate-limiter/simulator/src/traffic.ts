import type { Traffic } from './types.ts';

/**
 * Traffic generators.
 *
 * All arrival times are virtual milliseconds. Randomised patterns use a seeded
 * PRNG so that every run of a given scenario produces byte-identical output —
 * a simulator you cannot trust to repeat itself is a simulator you cannot learn
 * from.
 */

/** mulberry32 — small, fast, good enough, and crucially deterministic. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An exact list of arrival times. Used to reproduce the book's figures. */
export function exact(
  name: string,
  description: string,
  arrivals: number[],
  durationMs?: number,
): Traffic {
  const sorted = [...arrivals].sort((a, b) => a - b);
  return {
    name,
    description,
    arrivals: sorted,
    durationMs: durationMs ?? (sorted.at(-1) ?? 0) + 1000,
  };
}

/** A perfectly even stream at `ratePerSecond`. The polite, unrealistic client. */
export function steady(ratePerSecond: number, durationMs: number): Traffic {
  const gap = 1000 / ratePerSecond;
  const arrivals: number[] = [];
  for (let t = 0; t < durationMs; t += gap) arrivals.push(Math.round(t));
  return {
    name: 'steady',
    description: `steady ${ratePerSecond} req/s for ${durationMs / 1000}s`,
    arrivals,
    durationMs,
  };
}

/**
 * Quiet, then a wall of requests, then quiet again. The flash sale, the retry
 * storm, the cron job that fires on the minute across your whole fleet.
 */
export function burst(opts: {
  durationMs: number;
  /** Background rate outside the burst. */
  baselinePerSecond: number;
  /** When the burst lands. */
  burstAtMs: number;
  /** How many requests arrive, effectively at once. */
  burstSize: number;
  /** Spread the burst over this long. 0 means truly simultaneous. */
  burstSpreadMs?: number;
}): Traffic {
  const spread = opts.burstSpreadMs ?? 0;
  const arrivals: number[] = [];

  const gap = 1000 / opts.baselinePerSecond;
  for (let t = 0; t < opts.durationMs; t += gap) arrivals.push(Math.round(t));

  for (let i = 0; i < opts.burstSize; i++) {
    const offset = spread === 0 ? 0 : Math.round((i / opts.burstSize) * spread);
    arrivals.push(opts.burstAtMs + offset);
  }

  return {
    name: 'burst',
    description: `${opts.baselinePerSecond} req/s baseline, ${opts.burstSize} requests at ${opts.burstAtMs / 1000}s`,
    arrivals: arrivals.sort((a, b) => a - b),
    durationMs: opts.durationMs,
  };
}

/**
 * The fixed window's nemesis: a full quota fired just *before* a window
 * boundary and another full quota just *after* it. Both windows are individually
 * legal; the rolling window straddling the boundary sees double the limit.
 *
 * This is the book's Figure 4-9.
 */
export function edgeBurst(opts: {
  /** The rate limit — how many requests go in each half of the burst. */
  limit: number;
  /** Window length, i.e. where the boundary falls. */
  windowMs: number;
  /** How close to the boundary the two clumps sit. */
  offsetMs: number;
}): Traffic {
  const boundary = opts.windowMs;
  const arrivals: number[] = [];

  // Full quota fired in the closing moments of window 1.
  for (let i = 0; i < opts.limit; i++) {
    arrivals.push(boundary - opts.offsetMs + i * 100);
  }
  // Full quota again in the opening moments of window 2.
  for (let i = 0; i < opts.limit; i++) {
    arrivals.push(boundary + i * 100);
  }

  return {
    name: 'edge-burst',
    description: `${opts.limit} requests either side of the ${opts.windowMs / 1000}s window boundary`,
    arrivals: arrivals.sort((a, b) => a - b),
    durationMs: opts.windowMs * 2,
  };
}

/**
 * Poisson arrivals — the standard model for independent clients showing up on
 * their own schedule. Clumpier than `steady`, and much closer to real traffic.
 */
export function poisson(opts: {
  ratePerSecond: number;
  durationMs: number;
  seed?: number;
}): Traffic {
  const random = seededRandom(opts.seed ?? 42);
  const arrivals: number[] = [];
  let t = 0;

  while (t < opts.durationMs) {
    // Inter-arrival times of a Poisson process are exponentially distributed.
    const gapMs = (-Math.log(1 - random()) / opts.ratePerSecond) * 1000;
    t += gapMs;
    if (t < opts.durationMs) arrivals.push(Math.round(t));
  }

  return {
    name: 'poisson',
    description: `Poisson arrivals, mean ${opts.ratePerSecond} req/s for ${opts.durationMs / 1000}s`,
    arrivals,
    durationMs: opts.durationMs,
  };
}
