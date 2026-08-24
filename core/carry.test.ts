import { describe, expect, it } from 'vitest';
import {
  carryIn,
  handsOf,
  heldIn,
  loadIn,
  overIn,
  stateIn,
  stateOf,
  swapIn,
} from './carry.ts';
import type { Entity } from './entity.ts';

// Not one system's words: the fixture's person has THREE paws, wears a
// pelt, and swaps for Vigour. If any sentence below reads like a
// particular game, this file has stopped testing what it means to.
const DECL = carryIn({
  states: [
    { name: 'pelt', label: 'wearing', limit: 1, rule: 'One pelt at a time.' },
    {
      name: 'paws',
      label: 'in paw',
      hands: 3,
      rule: 'Three paws. A thing that takes two leaves room for one.',
      swap: { counter: 'Vigour', amount: 1, as: 'Scramble' },
    },
    { name: 'slung', limit: 1 },
  ],
  handsStat: 'Paws',
  hands: 1,
});

function thing(id: string, paws?: number): Entity {
  return {
    id,
    name: id,
    lists: paws === undefined ? {} : { stats: [{ name: 'Paws', value: paws }] },
  };
}

const club = thing('club', 2);
const knife = thing('knife');
const stick = thing('stick', 1);
const pelt = thing('pelt-a');
const ITEMS = new Map([club, knife, stick, pelt].map((i) => [i.id, i]));

function person(refs: Entity['refs']): Entity {
  return { id: 'who', name: 'Somebody', lists: {}, refs };
}

describe('carryIn — reading forgivingly', () => {
  it('takes what it recognises and drops what it cannot use', () => {
    expect(DECL?.states.map((s) => s.name)).toEqual(['pelt', 'paws', 'slung']);
    expect(stateIn(DECL, 'PAWS')?.hands).toBe(3);
    expect(stateIn(DECL, 'paws')?.swap).toEqual({
      counter: 'Vigour',
      amount: 1,
      as: 'Scramble',
    });
  });

  it('is nothing at all when nothing declared it', () => {
    expect(carryIn(undefined)).toBeUndefined();
    expect(carryIn({ states: [] })).toBeUndefined();
    expect(carryIn({ states: [{ label: 'nameless' }] })).toBeUndefined();
    expect(carryIn('a sentence')).toBeUndefined();
  });

  it('drops a price with no counter or no amount rather than half-reading it', () => {
    const decl = carryIn({ states: [{ name: 'paws', swap: { counter: 'Vigour' } }] });
    expect(stateIn(decl, 'paws')?.swap).toBeUndefined();
  });
});

describe('handsOf', () => {
  it('reads the thing own stat', () => {
    expect(handsOf(club, DECL)).toBe(2);
  });

  it('falls to the declared default when the thing says nothing', () => {
    expect(handsOf(knife, DECL)).toBe(1);
  });

  it('is one when the system declared no default and no stat', () => {
    expect(handsOf(club, carryIn({ states: [{ name: 'paws' }] }))).toBe(1);
    expect(handsOf(undefined, DECL)).toBe(1);
  });
});

describe('stateOf / heldIn', () => {
  const carrying = person({
    paws: [{ id: 'knife', name: 'knife' }, { id: 'stick', name: 'stick' }],
    pelt: { id: 'pelt-a', name: 'pelt-a' },
  });

  it('reads one ref and a list of refs the same way', () => {
    expect(heldIn(carrying, 'paws')).toEqual(['knife', 'stick']);
    expect(heldIn(carrying, 'pelt')).toEqual(['pelt-a']);
    expect(heldIn(carrying, 'slung')).toEqual([]);
  });

  it('says where a thing is, and nothing for a thing that is merely had', () => {
    expect(stateOf(carrying, 'stick', DECL)).toBe('paws');
    expect(stateOf(carrying, 'pelt-a', DECL)).toBe('pelt');
    expect(stateOf(carrying, 'club', DECL)).toBeUndefined();
  });
});

describe('loadIn / overIn — reporting, never refusing', () => {
  it('counts hands by what each thing takes', () => {
    const held = person({ paws: [{ id: 'club', name: 'club' }, { id: 'stick', name: 'stick' }] });
    const load = loadIn(held, stateIn(DECL, 'paws')!, ITEMS, DECL);
    expect(load.hands).toBe(3);
    expect(load.over).toBe(false);
  });

  it('flags a budget that was gone past, and quotes the system saying so', () => {
    const held = person({
      paws: [
        { id: 'club', name: 'club' },
        { id: 'stick', name: 'stick' },
        { id: 'knife', name: 'knife' },
      ],
    });
    const [over] = overIn(held, ITEMS, DECL);
    expect(over.state.name).toBe('paws');
    expect(over.hands).toBe(4);
    expect(over.rule).toContain('Three paws');
  });

  it('flags a count limit the same way, and says nothing when nothing is over', () => {
    const two = person({
      pelt: [{ id: 'pelt-a', name: 'pelt-a' }, { id: 'club', name: 'club' }],
    });
    expect(overIn(two, ITEMS, DECL).map((l) => l.state.name)).toEqual(['pelt']);
    expect(overIn(person({ pelt: { id: 'pelt-a', name: 'pelt-a' } }), ITEMS, DECL)).toEqual([]);
  });

  it('counts a ref that names nothing carried rather than dropping it', () => {
    const ghost = person({ pelt: [{ id: 'gone', name: 'a pelt lost' }, { id: 'pelt-a', name: 'pelt-a' }] });
    const load = loadIn(ghost, stateIn(DECL, 'pelt')!, ITEMS, DECL);
    expect(load.ids).toEqual(['gone', 'pelt-a']);
    expect(load.over).toBe(true);
  });

  it('holds no opinion where the system declared no bound', () => {
    const decl = carryIn({ states: [{ name: 'paws' }] });
    const held = person({ paws: [{ id: 'club', name: 'club' }, { id: 'stick', name: 'stick' }] });
    expect(overIn(held, ITEMS, decl)).toEqual([]);
  });
});

describe('swapIn — the price of moving a thing, proposed', () => {
  it('prices the state moved INTO', () => {
    expect(swapIn(DECL, 'slung', 'paws')).toEqual({
      counter: 'Vigour',
      amount: 1,
      as: 'Scramble',
    });
  });

  it('charges nothing for taking a thing out of storage, or for staying put', () => {
    expect(swapIn(DECL, undefined, 'paws')).toBeUndefined();
    expect(swapIn(DECL, 'paws', 'paws')).toBeUndefined();
    expect(swapIn(DECL, 'paws', undefined)).toBeUndefined();
  });

  it('charges nothing for a state the system never priced', () => {
    expect(swapIn(DECL, 'paws', 'slung')).toBeUndefined();
  });
});
