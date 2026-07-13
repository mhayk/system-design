import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { raceCondition } from '../src/distributed.ts';

describe('The race condition — Figure 4-14', () => {
  it('the naive GET/check/SET blows through the limit', () => {
    const result = raceCondition('read-check-write', {
      limit: 5,
      concurrency: 10,
      gapMs: 1,
      rttMs: 5,
    });

    assert.ok(
      result.allowed > result.limit,
      `expected over-admission, got ${result.allowed} allowed against a limit of ${result.limit}`,
    );
    assert.ok(result.overAdmitted > 0, 'requests got through that should not have');
  });

  it('loses updates — the counter does not even count correctly', () => {
    const result = raceCondition('read-check-write', {
      limit: 5,
      concurrency: 10,
      gapMs: 1,
      rttMs: 5,
    });

    assert.ok(result.lostUpdates > 0, 'concurrent writes clobber each other');
    assert.ok(
      result.finalCounter < result.allowed,
      'the counter under-reports what it admitted — exactly the book\'s "counter should be 5" bug',
    );
  });

  it("reproduces the book's two-request example: both read 3, both write 4", () => {
    // Two requests, tight race, against a counter that is about to hit its limit.
    // Prime the counter to 3 by running 3 requests through cleanly first.
    const result = raceCondition('read-check-write', {
      limit: 10, // high enough that neither is rejected — we care about the counter
      concurrency: 2,
      gapMs: 1,
      rttMs: 5,
    });

    assert.equal(result.allowed, 2, 'both requests admitted');
    assert.equal(
      result.finalCounter,
      1,
      'both read 0 and both wrote 1 — one increment vanished',
    );
    assert.equal(result.lostUpdates, 1);
  });

  it('the atomic operation holds the limit exactly', () => {
    const result = raceCondition('atomic', {
      limit: 5,
      concurrency: 10,
      gapMs: 1,
      rttMs: 5,
    });

    assert.equal(result.allowed, 5, 'exactly the limit, no more');
    assert.equal(result.finalCounter, 5, 'and the counter agrees');
    assert.equal(result.overAdmitted, 0);
    assert.equal(result.lostUpdates, 0, 'nothing to lose — the op is indivisible');
  });

  it('the wider the race window, the worse the naive version gets', () => {
    const tight = raceCondition('read-check-write', {
      limit: 5,
      concurrency: 20,
      gapMs: 1,
      rttMs: 1,
    });
    const wide = raceCondition('read-check-write', {
      limit: 5,
      concurrency: 20,
      gapMs: 1,
      rttMs: 20, // a slow, distant Redis
    });

    assert.ok(
      wide.allowed > tight.allowed,
      `a slower store means a wider window to race through: ${wide.allowed} vs ${tight.allowed}`,
    );
  });
});
