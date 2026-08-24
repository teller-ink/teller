// Invented fixtures throughout — a made-up system with made-up
// creatures, because a test is a place a book's words would be repo
// content (rule 4).

import { describe, expect, it } from 'vitest';
import {
  afterDamage,
  coversOf,
  damageFrom,
  defensesOf,
  isAoe,
  locate,
  proposeSeverity,
  toExchangeRecord,
  toRollRecord,
  toleranceFor,
  toleration,
  vitalIn,
} from './exchange.ts';

const sheet = {
  resources: [
    { name: 'Vigor', value: 7, max: 12 },
    { name: 'Wind', value: 3, max: 6 },
    { name: 'Coin', value: 40 },
  ],
  stats: [
    { name: 'Ward', value: '2B' },
    { name: 'Pace', value: 'Normal' },
  ],
  tolerances: [
    { name: 'Scalded', value: '1G' },
    { name: 'Chilled', value: '-2B' },
    { name: 'Snared', value: 2 },
    { name: 'Blinded', value: '' },
  ],
};

describe('locate — an entry by name, wherever the system filed it', () => {
  it('finds it across lists, case-insensitively, and says which list', () => {
    expect(locate(sheet, 'ward')).toEqual({ list: 'stats', entry: { name: 'Ward', value: '2B' } });
  });

  it('is nothing when nobody holds it', () => {
    expect(locate(sheet, 'Luck')).toBeUndefined();
    expect(locate(undefined, 'Ward')).toBeUndefined();
  });
});

describe('vitalIn — the first bounded counter, as everywhere', () => {
  it('prefers resources and skips the unbounded', () => {
    expect(vitalIn(sheet)).toEqual({ list: 'resources', entry: { name: 'Vigor', value: 7, max: 12 } });
  });

  it('falls through to any other list on a sheet that files differently', () => {
    expect(vitalIn({ pools: [{ name: 'Sap', value: 2, max: 4 }] })).toEqual({
      list: 'pools',
      entry: { name: 'Sap', value: 2, max: 4 },
    });
  });

  it('is nothing when nothing is bounded', () => {
    expect(vitalIn({ resources: [{ name: 'Coin', value: 40 }] })).toBeUndefined();
  });
});

describe('defensesOf — whatever the system pinned to the vital', () => {
  it('reads the pins record, never a list name', () => {
    expect(defensesOf(sheet, { Vigor: ['ward'] }, vitalIn(sheet)!.entry)).toEqual([
      { name: 'Ward', value: '2B' },
    ]);
  });

  it('offers nothing when the system pinned nothing, or pinned what is missing', () => {
    expect(defensesOf(sheet, undefined, vitalIn(sheet)!.entry)).toEqual([]);
    expect(defensesOf(sheet, { Vigor: ['Aura'] }, vitalIn(sheet)!.entry)).toEqual([]);
  });
});

describe('coversOf — what the system offers anybody, per attack', () => {
  it('reads the record into the same entries a pinned defense arrives as', () => {
    expect(coversOf({ 'Behind a Rock': '1B', 'Behind a Wall': '2B' })).toEqual([
      { name: 'Behind a Rock', value: '1B' },
      { name: 'Behind a Wall', value: '2B' },
    ]);
  });

  it('offers nothing at all when the system declares none', () => {
    expect(coversOf(undefined)).toEqual([]);
    expect(coversOf({})).toEqual([]);
  });

  it('keeps a flat number and drops what carries no value to roll', () => {
    expect(coversOf({ Dug_In: 2, Nothing: null, Shapeless: { pool: '1B' }, '  ': '1B' })).toEqual([
      { name: 'Dug_In', value: 2 },
    ]);
  });
});

describe('the subtraction', () => {
  it('is hits minus blocked, floored at zero', () => {
    expect(damageFrom(5, 2)).toBe(3);
    expect(damageFrom(2, 5)).toBe(0);
    expect(damageFrom(0, 0)).toBe(0);
  });

  it('comes off the vital, floored at zero, never past it', () => {
    const vital = vitalIn(sheet)!.entry;
    expect(afterDamage(vital, 3)).toBe(4);
    expect(afterDamage(vital, 99)).toBe(0);
    expect(afterDamage({ name: 'Vigor' }, 2)).toBe(0);
  });
});

describe('toleration — a pool, a flat number, or a sign that reverses it', () => {
  it('reads a pool', () => {
    expect(toleranceFor(sheet.tolerances, 'Scalded')).toEqual({
      name: 'Scalded',
      pool: '1G',
      worsens: false,
    });
  });

  it('reads a leading minus as making it worse, pool stripped', () => {
    expect(toleranceFor(sheet.tolerances, 'chilled')).toEqual({
      name: 'Chilled',
      pool: '2B',
      worsens: true,
    });
  });

  it('reads a plain number as flat, and a negative one as flat and reversed', () => {
    expect(toleranceFor(sheet.tolerances, 'Snared')).toEqual({
      name: 'Snared',
      flat: 2,
      worsens: false,
    });
    expect(toleration({ name: 'Snared', value: -2 })).toEqual({
      name: 'Snared',
      flat: 2,
      worsens: true,
    });
  });

  it('is nothing for an empty tolerance or one nobody carries', () => {
    expect(toleranceFor(sheet.tolerances, 'Blinded')).toBeUndefined();
    expect(toleranceFor(sheet.tolerances, 'Charmed')).toBeUndefined();
    expect(toleranceFor(undefined, 'Scalded')).toBeUndefined();
  });
});

describe('proposeSeverity — and the arithmetic in words beside it', () => {
  it('is the printed severity when nothing modifies it', () => {
    expect(proposeSeverity({ printed: 4 })).toEqual({ value: 4 });
  });

  it('subtracts what the tolerance came to, and says so', () => {
    const out = proposeSeverity({ printed: 4, relief: 3 });
    expect(out.value).toBe(1);
    expect(out.note).toContain('4 − 3 tolerance = 1');
  });

  it('never goes below nothing', () => {
    expect(proposeSeverity({ printed: 2, relief: 9 }).value).toBe(0);
  });

  it('adds it instead when the tolerance is a weakness', () => {
    const out = proposeSeverity({ printed: 2, relief: 3, worsens: true });
    expect(out.value).toBe(5);
    expect(out.note).toContain('2 + 3 tolerance = 5');
  });

  it('takes the higher of held and proposed — the old route\'s own stacking', () => {
    expect(proposeSeverity({ printed: 2, held: 5 })).toMatchObject({ value: 5 });
    expect(proposeSeverity({ printed: 5, held: 2 })).toMatchObject({ value: 5 });
  });

  it('presents a declared cap, and waives it where the system said so', () => {
    expect(proposeSeverity({ printed: 9, cap: 6 })).toMatchObject({ value: 6 });
    expect(proposeSeverity({ printed: 9, cap: 6, uncapped: true })).toMatchObject({ value: 9 });
  });
});

describe('the records — forgiving read, strict write', () => {
  it('keeps a roll whole and rounds what it must', () => {
    expect(
      toRollRecord({
        by: 'ent_1',
        byName: 'Bog Lurker',
        pool: '2G',
        faces: ['hit', 'blank'],
        total: 1.4,
        unit: 'Hits',
        for: 'Coil damage',
        round: 2,
      }),
    ).toEqual({
      by: 'ent_1',
      byName: 'Bog Lurker',
      pool: '2G',
      faces: ['hit', 'blank'],
      total: 1,
      unit: 'Hits',
      for: 'Coil damage',
      round: 2,
    });
  });

  it('keeps a die thrown again — what it was, what it became, and what let it', () => {
    expect(
      toRollRecord({
        pool: '2G',
        faces: ['hit', 'blank'],
        total: 1,
        rerolls: [
          { at: 1, was: 'spur', became: 'blank', by: 'Squint' },
          { at: '2', was: 'hit' },
          { junk: true },
        ],
      }),
    ).toEqual({
      pool: '2G',
      faces: ['hit', 'blank'],
      total: 1,
      // The half-written ones are dropped whole: a reroll that can't say
      // what changed is not a smaller reroll, it's noise.
      rerolls: [{ at: 1, was: 'spur', became: 'blank', by: 'Squint' }],
    });
  });

  it('carries no rerolls key at all when nothing was thrown again', () => {
    expect(toRollRecord({ pool: '1B', faces: ['hit'], total: 1, rerolls: [] })).toEqual({
      pool: '1B',
      faces: ['hit'],
      total: 1,
    });
  });

  it('refuses a roll with no pool, and survives junk', () => {
    expect(toRollRecord({ faces: ['hit'] })).toBeUndefined();
    expect(toRollRecord(undefined)).toBeUndefined();
    expect(toRollRecord({ pool: '1B' })).toEqual({ pool: '1B', faces: [], total: 0 });
  });

  it('keeps an exchange whole, drops nameless statuses, keeps a zero line that says what it bought', () => {
    const out = toExchangeRecord({
      by: 'ent_1',
      byName: 'Bog Lurker',
      target: 'ent_2',
      targetName: 'Ranger',
      action: 'Coil',
      hits: 4,
      blocked: 1,
      damage: 3,
      vital: { name: 'Vigor', from: 7, to: 4 },
      statuses: [{ name: 'Snared', severity: 2 }, { name: '  ', severity: 3 }],
      spend: [
        { counter: 'Wind', amount: 4, on: 'Coil' },
        { counter: 'Wind', amount: 0, on: 'a free step' },
        { counter: 'Wind', amount: 0 },
      ],
      round: 3,
    });
    expect(out!.statuses).toEqual([{ name: 'Snared', severity: 2 }]);
    expect(out!.spend).toEqual([
      { counter: 'Wind', amount: 4, on: 'Coil' },
      { counter: 'Wind', amount: 0, on: 'a free step' },
    ]);
    expect(out!.vital).toEqual({ name: 'Vigor', from: 7, to: 4 });
  });

  it('refuses an exchange with no actor, and names a turn aimed at nobody', () => {
    expect(toExchangeRecord({ action: 'hiding' })).toBeUndefined();
    expect(toExchangeRecord({ by: 'ent_1' })).toMatchObject({ action: 'a turn', targets: [] });
    expect(toExchangeRecord({ by: 'ent_1', target: 'ent_2' })).toMatchObject({ action: 'an attack' });
  });

  it('reads a single target into the list, so every reader sees one shape', () => {
    const out = toExchangeRecord({
      by: 'ent_1',
      target: 'ent_2',
      targetName: 'Ranger',
      action: 'Coil',
      hits: 4,
      blocked: 1,
      damage: 3,
      vital: { name: 'Vigor', from: 7, to: 4 },
      statuses: [{ name: 'Snared', severity: 2 }],
    })!;
    expect(out.targets).toEqual([
      {
        target: 'ent_2',
        targetName: 'Ranger',
        hits: 4,
        blocked: 1,
        damage: 3,
        vital: { name: 'Vigor', from: 7, to: 4 },
        statuses: [{ name: 'Snared', severity: 2 }],
      },
    ]);
  });

  it('keeps every target of a blast, and puts the first of them back on the head', () => {
    const out = toExchangeRecord({
      by: 'ent_1',
      byName: 'Bog Lurker',
      action: 'Mire',
      targets: [
        {
          target: 'ent_2',
          targetName: 'Ranger',
          hits: 5,
          blocked: 2,
          damage: 3,
          vital: { name: 'Vigor', from: 7, to: 4 },
          statuses: [{ name: 'Snared', severity: 4 }, { name: ' ', severity: 9 }],
        },
        { target: 'ent_3', targetName: 'Drover', hits: 5, blocked: 5, damage: 0, statuses: [{ name: 'Snared', severity: 2 }] },
        { targetName: 'nobody in particular' },
      ],
      // Paid once, however many it caught.
      spend: [{ counter: 'Wind', amount: 4, on: 'Mire' }],
      round: 2,
    })!;
    expect(out.targets).toHaveLength(2);
    expect(out.targets[1]).toEqual({
      target: 'ent_3',
      targetName: 'Drover',
      hits: 5,
      blocked: 5,
      damage: 0,
      statuses: [{ name: 'Snared', severity: 2 }],
    });
    // Nameless statuses drop on a target the same way they drop on the head.
    expect(out.targets[0].statuses).toEqual([{ name: 'Snared', severity: 4 }]);
    expect(out.target).toBe('ent_2');
    expect(out.targetName).toBe('Ranger');
    expect(out.hits).toBe(5);
    expect(out.blocked).toBe(2);
    expect(out.damage).toBe(3);
    expect(out.vital).toEqual({ name: 'Vigor', from: 7, to: 4 });
    expect(out.statuses).toEqual([{ name: 'Snared', severity: 4 }]);
    expect(out.spend).toEqual([{ counter: 'Wind', amount: 4, on: 'Mire' }]);
  });

  it('prefers the list when a payload carries both', () => {
    const out = toExchangeRecord({
      by: 'ent_1',
      target: 'ent_2',
      targetName: 'Ranger',
      hits: 5,
      blocked: 2,
      damage: 3,
      statuses: [],
      targets: [
        { target: 'ent_2', targetName: 'Ranger', hits: 5, blocked: 2, damage: 3, statuses: [] },
        { target: 'ent_3', targetName: 'Drover', hits: 5, blocked: 0, damage: 5, statuses: [] },
      ],
    })!;
    expect(out.targets.map((t) => t.target)).toEqual(['ent_2', 'ent_3']);
    expect(out.damage).toBe(3);
  });
});

describe('the AOE marker', () => {
  it('reads a bare name, however the profile spells it', () => {
    expect(isAoe([{ name: 'Band', value: 'Short' }, { name: 'AOE' }])).toBe(true);
    expect(isAoe([{ name: 'aoe' }])).toBe(true);
    expect(isAoe([{ name: 'Area of Effect' }])).toBe(true);
    expect(isAoe([{ name: 'Area', value: 'yes' }])).toBe(true);
  });

  it('is absent when nothing says it, and a value only ever denies it', () => {
    expect(isAoe([{ name: 'Band', value: 'Melee' }, { name: 'Damage', value: '2G' }])).toBe(false);
    expect(isAoe(undefined)).toBe(false);
    expect(isAoe([])).toBe(false);
    expect(isAoe([{ name: 'AOE', value: 'no' }])).toBe(false);
    expect(isAoe([{ name: 'AOE', value: 0 }])).toBe(false);
  });
});
