import { describe, expect, it } from 'vitest';
import { SIDE_LIST, SIDE_MARK, sideOf, storedSide, toSide } from './side.ts';

const TRADES = new Set(['marshal', 'trapper']);
const FURNITURE = new Set(['vendor']);
const side = (e: Parameters<typeof sideOf>[0]) => sideOf(e, TRADES, FURNITURE);
const marked = (value: unknown) => ({ [SIDE_LIST]: [{ name: SIDE_MARK, value: value as string }] });

describe('which side of the table, asked fail-closed', () => {
  it('the declared word and the declared trades are the party', () => {
    expect(side({ type: 'pc' })).toBe('party');
    expect(side({ type: 'Marshal' })).toBe('party');
    // The trade as creation might have cased it, and as a human retyped it.
    expect(side({ type: 'trapper' })).toBe('party');
    expect(side({ type: ' Trapper ' })).toBe('party');
  });

  it('everything else is a foe — including the words nobody typed', () => {
    expect(side({ type: 'foe' })).toBe('foe');
    expect(side({ type: 'npc' })).toBe('foe');
    expect(side({ type: 'Sheriff' })).toBe('foe');
    // The one that put numbers on the glass: a foe whose template never
    // said the word.
    expect(side({})).toBe('foe');
    expect(side({ type: '   ' })).toBe('foe');
  });

  it('furniture is on no side — a vendor is neither posse nor enemy', () => {
    expect(side({ type: 'vendor' })).toBe('none');
    expect(side({ type: 'Vendor' })).toBe('none');
    // Only the words the host names as furniture; core knows none itself.
    expect(sideOf({ type: 'vendor' }, TRADES)).toBe('foe');
  });

  it('a system with no trades leaves `pc` as the only derived way in', () => {
    const none: Set<string> = new Set();
    expect(sideOf({ type: 'pc' }, none)).toBe('party');
    expect(sideOf({ type: 'Marshal' }, none)).toBe('foe');
  });
});

describe('the stored side', () => {
  it('wins over every derivation — the sheriff beside the posse, the mystery PC', () => {
    expect(side({ type: 'Sheriff', lists: marked('party') })).toBe('party');
    expect(side({ type: 'Marshal', lists: marked('foe') })).toBe('foe');
    expect(side({ type: 'pc', lists: marked('none') })).toBe('none');
    expect(side({ type: 'vendor', lists: marked('party') })).toBe('party');
  });

  it('is read forgivingly and refused when it says nothing', () => {
    expect(side({ type: 'Marshal', lists: marked(' Foe ') })).toBe('foe');
    expect(side({ type: 'Marshal', lists: marked('ally') })).toBe('party');
    expect(side({ type: 'Marshal', lists: marked(3) })).toBe('party');
    expect(storedSide({ lists: marked('ally') })).toBeUndefined();
    expect(storedSide({ lists: {} })).toBeUndefined();
    expect(storedSide(undefined)).toBeUndefined();
  });

  it('toSide names exactly the three sides', () => {
    expect(toSide('party')).toBe('party');
    expect(toSide('FOE')).toBe('foe');
    expect(toSide('none')).toBe('none');
    expect(toSide('pc')).toBeUndefined();
    expect(toSide(undefined)).toBeUndefined();
  });
});
