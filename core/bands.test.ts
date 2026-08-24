import { describe, expect, it } from 'vitest';
import { acrossGround, bandOf, bandsIn, bandsOn } from './bands.ts';
import type { Entry } from './entity.ts';

// A ladder nobody plays on: the rungs are Underfoot, Yonder and Far
// Yonder, and the fixture's weapon prints them in longer words than the
// ladder uses — which is the whole point of the matching.
const LADDER = bandsIn([
  { name: 'Underfoot', to: 1, world: 'close enough to smell' },
  { name: 'Yonder', from: 1, to: 6 },
  { name: 'Far Yonder', from: 6 },
  { name: 'nameless' },
  { name: '' },
]);

const musket: Entry[] = [
  { name: 'Vigour', value: 3 },
  { name: 'Underfoot', value: '1R' },
  { name: 'Yonder Reach', value: '3R' },
  { name: 'Make', value: 'Worn' },
];

const cudgel: Entry[] = [
  { name: 'Vigour', value: 1 },
  { name: 'Underfoot', value: '2R' },
];

describe('bandsIn / bandOf — the ladder, unchanged by the move to core', () => {
  it('reads the rungs it can and drops the ones it cannot name', () => {
    expect(LADDER.map((b) => b.name)).toEqual(['Underfoot', 'Yonder', 'Far Yonder', 'nameless']);
    expect(bandOf(0.5, LADDER)?.name).toBe('Underfoot');
    expect(bandOf(1, LADDER)?.name).toBe('Yonder');
    expect(bandOf(90, LADDER)?.name).toBe('Far Yonder');
  });
});

describe('acrossGround', () => {
  it('is the rung that begins away from you, and only that', () => {
    expect(acrossGround(LADDER[0])).toBe(false);
    expect(acrossGround(LADDER[1])).toBe(true);
    expect(acrossGround(LADDER[3])).toBe(false);
  });
});

describe('bandsOn — what a thing does at each rung it is printed for', () => {
  it('matches the ladder to the print, exactly then by prefix', () => {
    expect(bandsOn(musket, LADDER).map((b) => [b.band.name, b.entry.name])).toEqual([
      ['Underfoot', 'Underfoot'],
      ['Yonder', 'Yonder Reach'],
    ]);
  });

  it('keeps the ladder order, never the print order', () => {
    const backwards: Entry[] = [
      { name: 'Yonder Reach', value: '3R' },
      { name: 'Underfoot', value: '1R' },
    ];
    expect(bandsOn(backwards, LADDER).map((b) => b.band.name)).toEqual(['Underfoot', 'Yonder']);
  });

  it('gives a thing printed for one rung exactly one rung', () => {
    expect(bandsOn(cudgel, LADDER)).toHaveLength(1);
    expect(bandsOn(cudgel, LADDER).some(({ band }) => acrossGround(band))).toBe(false);
  });

  it('is empty for a thing that reaches nothing, and for a system with no ladder', () => {
    expect(bandsOn([{ name: 'Cost', value: '$3.00' }], LADDER)).toEqual([]);
    expect(bandsOn(musket, [])).toEqual([]);
  });

  it('never lets two rungs claim the same printed stat', () => {
    const ladder = bandsIn([{ name: 'Yonder', from: 1 }, { name: 'Yond', from: 6 }]);
    expect(bandsOn(musket, ladder).map((b) => b.band.name)).toEqual(['Yonder']);
  });
});
