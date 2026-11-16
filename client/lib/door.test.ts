// The door's arithmetic: when a slip is too old to trust, and when two
// readers may share one answer. No browser — the races are in the
// bookkeeping, not the fetch.

import { describe, expect, it } from 'vitest';
import { Shared, SLIPS_GRACE_MS, SLIPS_RENEW_MS, slipsDue, slipsSuspect } from './door.ts';

const HOUR = 60 * 60_000;

describe('permission slips', () => {
  it('renew at half the host’s twelve hours, never at the edge of them', () => {
    expect(SLIPS_RENEW_MS).toBeLessThanOrEqual(6 * HOUR);
    expect(slipsDue(0, 5 * HOUR)).toBe(false);
    expect(slipsDue(0, SLIPS_RENEW_MS)).toBe(true);
  });

  it('a kiosk on all weekend is due, whatever it did meanwhile', () => {
    expect(slipsDue(0, 60 * HOUR)).toBe(true);
  });

  it('a clock that ran backwards makes them due rather than immortal', () => {
    expect(slipsDue(10 * HOUR, 9 * HOUR)).toBe(true);
    expect(slipsSuspect(10 * HOUR, 9 * HOUR)).toBe(true);
  });

  it('brand-new slips are not blamed for a refusal — no ticket storm', () => {
    expect(slipsSuspect(1_000, 1_000 + SLIPS_GRACE_MS - 1)).toBe(false);
    expect(slipsSuspect(1_000, 1_000 + SLIPS_GRACE_MS)).toBe(true);
  });
});

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('shared reads', () => {
  it('readers asking at the same moment share one request', async () => {
    const shared = new Shared<number>();
    const d = deferred<number>();
    let asks = 0;
    const ask = () => {
      asks++;
      return d.promise;
    };
    const a = shared.run('/notes', 0, ask);
    const b = shared.run('/notes', 0, ask);
    const c = shared.run('/notes', 0, ask);
    expect(asks).toBe(1);
    expect([a.joined, b.joined, c.joined]).toEqual([false, true, true]);
    d.resolve(7);
    expect(await Promise.all([a.answer, b.answer, c.answer])).toEqual([7, 7, 7]);
  });

  it('different urls are different questions', () => {
    const shared = new Shared<number>();
    let asks = 0;
    const ask = () => {
      asks++;
      return new Promise<number>(() => {});
    };
    shared.run('/a', 0, ask);
    shared.run('/b', 0, ask);
    expect(asks).toBe(2);
  });

  it('a reader after a nudge never joins a request that left before it', async () => {
    const shared = new Shared<string>();
    const before = deferred<string>();
    const after = deferred<string>();
    const first = shared.run('/turn', 4, () => before.promise);
    // The wire said "turn" — the generation moved on.
    const second = shared.run('/turn', 5, () => after.promise);
    expect(second.joined).toBe(false);
    // And a third reader in the new generation joins the NEW request.
    const third = shared.run('/turn', 5, () => Promise.resolve('wrong'));
    expect(third.joined).toBe(true);
    before.resolve('old');
    after.resolve('new');
    expect(await first.answer).toBe('old');
    expect(await second.answer).toBe('new');
    expect(await third.answer).toBe('new');
  });

  it('the old request finishing does not evict the newer one', async () => {
    const shared = new Shared<string>();
    const before = deferred<string>();
    const after = deferred<string>();
    shared.run('/turn', 1, () => before.promise);
    shared.run('/turn', 2, () => after.promise);
    before.resolve('old');
    await before.promise;
    await Promise.resolve();
    expect(shared.run('/turn', 2, () => Promise.resolve('x')).joined).toBe(true);
    after.resolve('new');
  });

  it('a finished answer is never handed out again: the next read asks', async () => {
    const shared = new Shared<number>();
    let asks = 0;
    const ask = () => {
      asks++;
      return Promise.resolve(asks);
    };
    await shared.run('/x', 0, ask).answer;
    await Promise.resolve();
    expect(shared.size).toBe(0);
    expect(await shared.run('/x', 0, ask).answer).toBe(2);
  });

  it('a failure is shared like an answer, and forgotten like one', async () => {
    const shared = new Shared<number>();
    const d = deferred<number>();
    const a = shared.run('/x', 0, () => d.promise);
    const b = shared.run('/x', 0, () => d.promise);
    d.reject(new Error('host down'));
    await expect(a.answer).rejects.toThrow('host down');
    await expect(b.answer).rejects.toThrow('host down');
    await Promise.resolve();
    expect(shared.size).toBe(0);
  });
});
