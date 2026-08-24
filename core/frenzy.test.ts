// What a gated child does, once it's running. Every creature here is
// invented — core carries nobody's book (rule 4) — but the SHAPES are
// the ones a real pack writes.

import { describe, expect, it } from 'vitest';
import type { Entity } from './entity.ts';
import {
  activeFrenzies,
  applyDelta,
  costOf,
  durationOf,
  effectiveList,
  grantsOf,
  immunities,
  isActive,
  isEvent,
  isSpent,
  modificationsFor,
  modificationsOf,
  modifiedAttack,
  pendingEvents,
} from './frenzy.ts';

const bite: Entity = {
  id: 'atk_bite',
  name: 'Bite',
  type: 'attack',
  lists: {
    profile: [
      { name: 'Band', value: 'Melee' },
      { name: 'Cost', value: 3 },
      { name: 'Damage', value: '2B2G' },
    ],
    inflicts: [{ name: 'Dazed', value: 2 }],
  },
};

const wail: Entity = {
  id: 'atk_wail',
  name: 'Wail',
  type: 'attack',
  lists: {
    profile: [
      { name: 'Band', value: 'Long' },
      { name: 'Cost', value: 2 },
      { name: 'Damage', value: '1G' },
    ],
  },
};

const frenzy: Entity = {
  id: 'frz_rage',
  name: 'Rage',
  type: 'frenzy',
  notes: 'It stops being careful.',
  lists: {
    gate: [{ name: 'Health', value: 10 }],
    cost: [{ name: 'Grit', value: 4 }],
    add: [{ name: 'Defense', value: '1B' }],
    set: [{ name: 'Speed', value: 'Fast' }],
    immune: [{ name: 'Afraid' }],
    duration: [{ name: 'Duration', value: 'for two rounds' }],
  },
  children: [
    {
      id: 'mod_1',
      name: 'Bite',
      type: 'modifies',
      lists: { set: [{ name: 'Damage', value: '6B6G' }] },
      refs: { attack: { id: 'atk_bite', name: 'Bite' } },
    },
  ],
};

const beast = (running: boolean): Entity => ({
  id: 'ent_beast',
  name: 'Invented Beast',
  type: 'foe',
  lists: {
    stats: [
      { name: 'Defense', value: '5G' },
      { name: 'Speed', value: 'Slow' },
    ],
    tolerances: [{ name: 'Shock', value: '-2B' }],
    resources: [{ name: 'Health', value: 8, max: 40 }],
    ...(running ? { frenzy: [{ name: 'Rage' }] } : {}),
  },
  children: [bite, wail, frenzy],
});

describe('the active mark — stored, never derived', () => {
  it('is off until somebody stores it, and on by name once they do', () => {
    expect(isActive(beast(false), frenzy)).toBe(false);
    expect(isActive(beast(true), frenzy)).toBe(true);
    expect(activeFrenzies(beast(true)).map((f) => f.name)).toEqual(['Rage']);
    expect(activeFrenzies(beast(false))).toEqual([]);
  });
});

describe('reading the child', () => {
  it('gives the price, the words for how long, and what it grants', () => {
    expect(costOf(frenzy)).toEqual({ name: 'Grit', value: 4 });
    expect(durationOf(frenzy)).toBe('for two rounds');
    expect(grantsOf(frenzy)).toEqual([]);
  });

  it('reads a rewrite off its ref, not off a name it copied', () => {
    const [mod] = modificationsOf(frenzy);
    expect(mod.attack).toEqual({ id: 'atk_bite', name: 'Bite' });
    expect(mod.set).toEqual([{ name: 'Damage', value: '6B6G' }]);
    expect(mod.from).toEqual({ id: 'frz_rage', name: 'Rage' });
  });
});

describe('applyDelta — an absent base is zero, system-wide', () => {
  it('moves a number, and counts a missing one as nothing', () => {
    expect(applyDelta(4, 2)).toBe(6);
    expect(applyDelta(undefined, 2)).toBe(2);
    expect(applyDelta(4, -1)).toBe(3);
  });

  it('adds a pool per letter, and a missing pool is an empty handful', () => {
    expect(applyDelta('5G', '1B')).toBe('1B5G');
    expect(applyDelta('5G', '+1G')).toBe('6G');
    expect(applyDelta(undefined, '2B')).toBe('2B');
  });

  it('subtracts a pool, floored at nothing', () => {
    expect(applyDelta('5G2B', '-2B')).toBe('5G');
    expect(applyDelta('1B', '-2B')).toBe('');
    expect(applyDelta(undefined, '-2B')).toBe('');
  });

  it('leaves a named rung alone — a rung has no arithmetic', () => {
    expect(applyDelta('Slow', 'Fast')).toBe('Slow');
  });
});

describe('effectiveList — what a stat reads while it runs', () => {
  it('is the printed list until something is running', () => {
    expect(effectiveList(beast(false), 'stats')).toEqual([
      { name: 'Defense', value: '5G' },
      { name: 'Speed', value: 'Slow' },
    ]);
  });

  it('lands absolutes and deltas on the right stat', () => {
    expect(effectiveList(beast(true), 'stats')).toEqual([
      { name: 'Defense', value: '1B5G' },
      { name: 'Speed', value: 'Fast' },
    ]);
  });

  it('does not sprout a stat override in the tolerance list', () => {
    expect(effectiveList(beast(true), 'tolerances')).toEqual([{ name: 'Shock', value: '-2B' }]);
  });

  it('writes a tolerance nobody printed, treating the base as zero', () => {
    const sheet = beast(true);
    sheet.children![2] = {
      ...frenzy,
      lists: { ...frenzy.lists, set: [], add: [{ name: 'Sweep', value: 2 }] },
    };
    expect(effectiveList(sheet, 'tolerances')).toEqual([
      { name: 'Shock', value: '-2B' },
      { name: 'Sweep', value: 2 },
    ]);
  });

  it('keeps a counter its ceiling when an override moves it', () => {
    const sheet = beast(true);
    sheet.children![2] = {
      ...frenzy,
      lists: { ...frenzy.lists, set: [], add: [{ name: 'Health', value: 5 }] },
    };
    expect(effectiveList(sheet, 'resources')).toEqual([{ name: 'Health', value: 13, max: 40 }]);
  });

  it('collects what it stops taking', () => {
    expect(immunities(beast(true))).toEqual([{ name: 'Afraid' }]);
    expect(immunities(beast(false))).toEqual([]);
  });
});

describe('modifications — which attacks a rewrite reaches', () => {
  it('reaches only the attack its ref names', () => {
    const sheet = beast(true);
    expect(modificationsFor(sheet, bite)).toHaveLength(1);
    expect(modificationsFor(sheet, wail)).toHaveLength(0);
  });

  it('reaches nothing at all while the frenzy is off', () => {
    expect(modificationsFor(beast(false), bite)).toHaveLength(0);
  });

  it('reaches every attack when it names none', () => {
    const sheet = beast(true);
    sheet.children![2] = {
      ...frenzy,
      children: [
        { id: 'mod_all', name: 'every attack', type: 'modifies', lists: { add: [{ name: 'Cost', value: -1 }] } },
      ],
    };
    expect(modificationsFor(sheet, bite)).toHaveLength(1);
    expect(modificationsFor(sheet, wail)).toHaveLength(1);
  });

  it('narrows an all-attacks rewrite to the band it names', () => {
    const sheet = beast(true);
    sheet.children![2] = {
      ...frenzy,
      children: [
        {
          id: 'mod_melee',
          name: 'every melee attack',
          type: 'modifies',
          lists: {
            profile: [{ name: 'Band', value: 'Melee' }],
            inflicts: [{ name: 'Burned', value: 1 }],
          },
        },
      ],
    };
    expect(modificationsFor(sheet, bite)).toHaveLength(1);
    expect(modificationsFor(sheet, wail)).toHaveLength(0);
  });
});

describe('modifiedAttack — the chip, rewritten in place', () => {
  it('is the printed attack when nothing modifies it', () => {
    const out = modifiedAttack(bite, []);
    expect(out.changed).toBe(false);
    expect(out.profile).toEqual(bite.lists.profile);
  });

  it('sets absolutes, moves deltas, and adds what it hangs', () => {
    const out = modifiedAttack(bite, [
      {
        set: [{ name: 'Damage', value: '6B6G' }],
        add: [{ name: 'Cost', value: -1 }],
        inflicts: [{ name: 'Burned', value: 1 }],
        properties: [{ name: 'Piercing', value: 3 }],
        from: { id: 'frz_rage', name: 'Rage' },
      },
    ]);
    expect(out.changed).toBe(true);
    expect(out.profile).toEqual([
      { name: 'Band', value: 'Melee' },
      { name: 'Cost', value: 2 },
      { name: 'Damage', value: '6B6G' },
      { name: 'Piercing', value: 3 },
    ]);
    expect(out.inflicts).toEqual([
      { name: 'Dazed', value: 2 },
      { name: 'Burned', value: 1 },
    ]);
  });

  it('never rewrites the printed lists themselves', () => {
    modifiedAttack(bite, [
      { set: [{ name: 'Damage', value: '9B' }], add: [], inflicts: [], properties: [], from: { id: 'x', name: 'x' } },
    ]);
    expect(bite.lists.profile).toContainEqual({ name: 'Damage', value: '2B2G' });
  });
});

// ---- the two lifecycles: a switch that runs, and a thing that happens
// once. The Event marker is the book's, and it lives in the NAME. ----

const burst: Entity = {
  id: 'frz_burst',
  name: 'Shed Its Coat (Event)',
  type: 'frenzy',
  notes: 'It sheds, all at once.',
  lists: {
    gate: [{ name: 'Health', value: 4 }],
    inflicts: [{ name: 'Dazed', value: 2 }],
    add: [{ name: 'Defense', value: '2B' }],
  },
};

const shedder = (mark?: string | null): Entity => ({
  id: 'ent_shedder',
  name: 'Invented Shedder',
  type: 'foe',
  lists: {
    stats: [{ name: 'Defense', value: '1G' }],
    resources: [{ name: 'Health', value: 4, max: 20 }],
    ...(mark === undefined ? {} : { frenzy: [{ name: 'Shed Its Coat (Event)', ...(mark === null ? {} : { value: mark }) }] }),
  },
  children: [burst, frenzy],
});

describe('isEvent — the book says which kind it is, in the name', () => {
  it('reads the marker however it was spaced or cased', () => {
    expect(isEvent({ name: 'Shed Its Coat (Event)' })).toBe(true);
    expect(isEvent({ name: 'Shed Its Coat ( event )' })).toBe(true);
    expect(isEvent({ name: 'Shed Its Coat (EVENT)' })).toBe(true);
  });

  it('is false for every ordinary one, and for nothing at all', () => {
    expect(isEvent(frenzy)).toBe(false);
    expect(isEvent({ name: 'Eventide Howl' })).toBe(false);
    expect(isEvent({ name: '' })).toBe(false);
    expect(isEvent(undefined)).toBe(false);
  });
});

describe('spent — the same mark, wearing a value', () => {
  it('is unspent until the mark says otherwise', () => {
    expect(isSpent(shedder(), burst)).toBe(false);
    expect(isSpent(shedder(null), burst)).toBe(false);
    expect(isSpent(shedder('spent'), burst)).toBe(true);
    expect(isSpent(shedder(' Spent '), burst)).toBe(true);
  });

  it('stops it running — a one-shot that fired rewrites nothing', () => {
    expect(isActive(shedder(null), burst)).toBe(true);
    expect(isActive(shedder('spent'), burst)).toBe(false);
    expect(effectiveList(shedder(null), 'stats')).toEqual([{ name: 'Defense', value: '2B1G' }]);
    expect(effectiveList(shedder('spent'), 'stats')).toEqual([{ name: 'Defense', value: '1G' }]);
  });
});

describe('pendingEvents — what cannot wait for its own turn', () => {
  it('proposes a met one-shot, and only a one-shot', () => {
    expect(pendingEvents(shedder()).map((f) => f.name)).toEqual(['Shed Its Coat (Event)']);
  });

  it('says nothing once it is spent, or already marked', () => {
    expect(pendingEvents(shedder('spent'))).toEqual([]);
    expect(pendingEvents(shedder(null))).toEqual([]);
  });

  it('says nothing while the line is uncrossed, or when there is no sheet', () => {
    const healthy = shedder();
    healthy.lists.resources = [{ name: 'Health', value: 5, max: 20 }];
    expect(pendingEvents(healthy)).toEqual([]);
    expect(pendingEvents(undefined)).toEqual([]);
  });
});
