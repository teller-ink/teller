import { describe, expect, it } from 'vitest';
import { layerBy, mergeBy, mergeNamed, refine } from './merge.ts';

describe('refine — a later layer wins what it names, and nothing else', () => {
  it('keeps the fields the later value never mentioned', () => {
    expect(refine({ name: 'Trapped', cap: 5 }, { name: 'Trapped', note: 'the book' })).toEqual({
      name: 'Trapped',
      cap: 5,
      note: 'the book',
    });
  });

  it('goes all the way down — the system rolls the money, the pack cites the page', () => {
    expect(refine({ wallet: { roll: '6B' } }, { wallet: { page: 8 } })).toEqual({
      wallet: { roll: '6B', page: 8 },
    });
  });

  it('replaces arrays and scalars whole — a list is a statement about all of it', () => {
    expect(refine({ tiers: [1, 2, 3], cap: 5 }, { tiers: [9] })).toEqual({
      tiers: [9],
      cap: 5,
    });
    expect(refine({ a: 1 }, 4 as unknown as { a: number })).toBe(4);
    expect(refine({ a: 1 }, null as unknown as { a: number })).toBe(null);
  });
});

describe('layerBy — mergeBy, refining instead of replacing', () => {
  const key = (item: { name: string }) => item.name.toLowerCase();
  const named = (item: Record<string, unknown>) => String(item.name).toLowerCase();

  it('layers the same name and appends a new one, in the order it arrived', () => {
    const out = layerBy(
      key,
      [
        { name: 'Doctor', skills: { Nerve: '2B' } },
        { name: 'Hunter', skills: { Nerve: '3B' } },
      ],
      [{ name: 'doctor', overview: 'the book on doctors' }],
      [{ name: 'Spooked' }],
    );
    expect(out).toEqual([
      { name: 'doctor', skills: { Nerve: '2B' }, overview: 'the book on doctors' },
      { name: 'Hunter', skills: { Nerve: '3B' } },
      { name: 'Spooked' },
    ]);
  });

  it('is the only difference from mergeBy — which still replaces whole', () => {
    const layers: Record<string, unknown>[][] = [[{ name: 'a', keep: 1 }], [{ name: 'a', add: 2 }]];
    expect(mergeBy(named, ...layers)).toEqual([{ name: 'a', add: 2 }]);
    expect(mergeNamed(...(layers as { name: string }[][]))).toEqual([{ name: 'a', add: 2 }]);
    expect(layerBy(named, ...layers)).toEqual([{ name: 'a', keep: 1, add: 2 }]);
  });
});
