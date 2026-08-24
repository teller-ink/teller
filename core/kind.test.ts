import { describe, expect, it } from 'vitest';
import { kindFor, setEntry, stepOf, type KindDef } from './kind.ts';
import type { Entry } from './entity.ts';

const conditions: KindDef = {
  name: 'conditions',
  domain: { kind: 'count', zero: 'clears', cap: 5 },
};
const standings: KindDef = {
  name: 'standings',
  domain: {
    kind: 'steps',
    steps: ['Hostile', 'Wary', 'Neutral', 'Friendly', 'Revered'],
    rest: 'Neutral',
  },
};

describe('setEntry without a declaration — the conservative write', () => {
  it('zero sticks: deleting a value nobody declared deletable is automation past a human', () => {
    const out = setEntry([{ name: 'Grit', value: 1 }], 'Grit', 0);
    expect(out).toEqual([{ name: 'Grit', value: 0 }]);
  });

  it('sets in place and appends new', () => {
    const start: Entry[] = [{ name: 'Charm', value: 2 }];
    expect(setEntry(start, 'charm', 3)).toEqual([{ name: 'Charm', value: 3 }]);
    expect(setEntry(start, 'Nerve', 1)).toHaveLength(2);
  });

  it('a value write never forgets the ceiling', () => {
    const out = setEntry([{ name: 'Health', value: 20, max: 20 }], 'Health', 12);
    expect(out).toEqual([{ name: 'Health', value: 12, max: 20 }]);
  });
});

describe('setEntry with a count kind that clears', () => {
  it('a Severity eased to nothing comes off entirely', () => {
    const out = setEntry([{ name: 'Trapped', value: 1 }], 'Trapped', 0, conditions);
    expect(out).toEqual([]);
  });

  it('above zero it counts like anything else', () => {
    const out = setEntry([], 'Afraid', 2, conditions);
    expect(out).toEqual([{ name: 'Afraid', value: 2 }]);
  });

  it('the cap is presented, never enforced — a human types past it (rule 1)', () => {
    const out = setEntry([], 'Trapped', 9, conditions);
    expect(out).toEqual([{ name: 'Trapped', value: 9 }]);
  });
});

describe('setEntry with a steps kind — the defaultStep pattern', () => {
  it('standing on the resting rung stores nothing', () => {
    const held = setEntry([], 'Vargas Family', 'Revered', standings);
    expect(held).toEqual([{ name: 'Vargas Family', value: 'Revered' }]);
    expect(setEntry(held, 'Vargas Family', 'Neutral', standings)).toEqual([]);
  });

  it('stepOf reads the default at the point of use, never off the sheet', () => {
    expect(stepOf(undefined, standings)).toBe('Neutral');
    expect(stepOf({ name: 'Vargas Family', value: 'Hostile' }, standings)).toBe(
      'Hostile',
    );
  });
});

describe('kindFor', () => {
  it('matches its list by name, case-insensitively — vocabulary coupling', () => {
    expect(kindFor([conditions, standings], 'Standings')).toBe(standings);
    expect(kindFor([conditions], 'marks')).toBeUndefined();
    expect(kindFor(undefined, 'conditions')).toBeUndefined();
  });
});
