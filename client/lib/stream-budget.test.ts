// The stream budget's races, without a browser: every leader runs
// `streamOrPoll` alone over what it can read, so the law has to hold
// from each seat at the table separately.

import { describe, expect, it } from 'vitest';
import { STREAM_CAP, streamOrPoll, type Claim } from './stream-budget.ts';

const NOW = 1_000_000;
const claim = (slot: string, since: number, open: boolean, extra: Partial<Claim> = {}): Claim => ({
  slot,
  at: NOW - 1_000,
  since,
  open,
  ...extra,
});

/** Run every slot's decision against the same board, like one election beat. */
function beat(claims: Claim[]): Record<string, 'stream' | 'poll'> {
  return Object.fromEntries(claims.map((me) => [me.slot, streamOrPoll(claims, me, NOW)]));
}

describe('the stream budget', () => {
  it('leaves two connections free: the fifth and sixth slots poll', () => {
    const claims = ['main', 'tv', 'board', 'art', 'seat', 'x'].map((s, i) => claim(s, i, i < 4));
    const out = beat(claims);
    expect(Object.values(out).filter((v) => v === 'stream')).toHaveLength(STREAM_CAP);
    expect(out.seat).toBe('poll');
    expect(out.x).toBe('poll');
  });

  it('two slots arriving at the same instant: exactly one gets the last stream', () => {
    const claims = [
      claim('main', 1, true),
      claim('tv', 2, true),
      claim('board', 3, true),
      claim('b', 10, false),
      claim('a', 10, false),
    ];
    const out = beat(claims);
    expect(out.a).toBe('stream');
    expect(out.b).toBe('poll');
  });

  it('a holder closing hands its place to the longest-waiting poller', () => {
    const claims = [
      claim('tv', 2, true),
      claim('board', 3, true),
      claim('art', 4, true),
      claim('late', 9, false),
      claim('waiting', 5, false),
    ];
    // `main` was the fourth holder and its tab just closed (record gone).
    const out = beat(claims);
    expect(out.waiting).toBe('stream');
    expect(out.late).toBe('poll');
  });

  it('a dead slot stops counting once stale', () => {
    const stale = claim('ghost', 0, true, { at: NOW - 100_000 });
    const claims = [stale, claim('tv', 2, true), claim('board', 3, true), claim('art', 4, true)];
    expect(streamOrPoll(claims, claim('new', 9, false), NOW)).toBe('stream');
  });

  it('the console displaces a holder, but never opens before the holder lets go', () => {
    const holders = ['tv', 'board', 'art', 'seat'].map((s, i) => claim(s, i, true));
    const gm = claim('main', 50, false, { first: true });
    const before = beat([...holders, gm]);
    // Ranked in, but four are still open: wait.
    expect(before.main).toBe('poll');
    // The displaced holder sees it, and lets go on the same beat.
    expect(before.seat).toBe('poll');
    // Next beat: three open, so the console opens. Never five at once.
    const after = beat([...holders.slice(0, 3), claim('seat', 3, false), gm]);
    expect(after.main).toBe('stream');
    expect(after.seat).toBe('poll');
  });

  it('a slot that already holds a stream keeps it while ranked in', () => {
    const claims = [claim('main', 1, true), claim('tv', 2, true)];
    expect(beat(claims)).toEqual({ main: 'stream', tv: 'stream' });
  });
});
