import { describe, expect, it } from 'vitest';
import {
  findEntry,
  isDraft,
  formatEntry,
  hasEntry,
  numberOf,
  refIn,
  refsIn,
  sameName,
  toEntity,
  toEntries,
  toLists,
  withoutEntry,
} from './entity.ts';

describe('toEntries — reading forgiving', () => {
  it('eats the current shape, legacy strings, and the counter spelling together', () => {
    const entries = toEntries([
      { name: 'Nerve', value: 3, max: 5 },
      'Afraid 2',
      'Trapped [4]',
      { name: 'Health', current: 17, max: 20 },
      'Gunslinger',
    ]);
    expect(entries).toEqual([
      { name: 'Nerve', value: 3, max: 5 },
      { name: 'Afraid', value: 2 },
      { name: 'Trapped', value: 4 },
      { name: 'Health', value: 17, max: 20 },
      { name: 'Gunslinger' },
    ]);
  });

  it('keeps a string rung and drops garbage without guessing', () => {
    const entries = toEntries([
      { name: 'Vargas Family', value: 'Revered' },
      { value: 9 },
      42,
      null,
      '   ',
    ]);
    expect(entries).toEqual([{ name: 'Vargas Family', value: 'Revered' }]);
  });

  it('is not an array, is nothing', () => {
    expect(toEntries({ name: 'sneaky' })).toEqual([]);
    expect(toEntries(undefined)).toEqual([]);
  });
});

describe('toLists', () => {
  it('drops empty keys and empty lists so round-trips do not accumulate husks', () => {
    expect(
      toLists({ skills: [{ name: 'Charm', value: 2 }], junk: [], '  ': ['x'] }),
    ).toEqual({ skills: [{ name: 'Charm', value: 2 }] });
  });
});

describe('toEntity', () => {
  it('round-trips the full shape', () => {
    const raw = {
      id: 'ent_abc123',
      name: 'Barrett',
      type: 'character',
      lists: { resources: [{ name: 'Grit', value: 2, max: 3 }] },
      notes: 'rides at dawn',
      children: [{ id: 'ent_gun', name: 'Rusty Pistol', lists: {} }],
      refs: { from: { id: 'npc_wiw_outlaw', name: 'Outlaw' } },
    };
    expect(toEntity(raw)).toEqual(raw);
  });

  it('mints an id for an inline child that arrived without one', () => {
    const entity = toEntity({
      id: 'ent_x',
      name: 'Barrett',
      children: [{ name: 'Rusty Pistol' }],
    });
    expect(entity?.children?.[0].id).toMatch(/^ent_[0-9a-f]{12}$/);
  });

  it('refuses a nameless thing', () => {
    expect(toEntity({ id: 'ent_x', lists: {} })).toBeUndefined();
  });

  it('accepts a ref slot holding an ordered list', () => {
    const entity = toEntity({
      id: 'ent_root',
      name: 'The Unlikely Duo',
      refs: {
        system: { id: 'sys_wiw', name: 'Wild Imaginary West' },
        packs: [
          { id: 'pak_guide', name: 'Guidebook' },
          { id: 'pak_home', name: 'House Rules' },
        ],
      },
    });
    expect(refIn(entity?.refs, 'system')?.id).toBe('sys_wiw');
    expect(refsIn(entity?.refs, 'packs').map((r) => r.id)).toEqual([
      'pak_guide',
      'pak_home',
    ]);
    expect(refsIn(entity?.refs, 'system')).toHaveLength(1);
    expect(refsIn(entity?.refs, 'nothing')).toEqual([]);
  });
});

describe('entry helpers', () => {
  const entries = [
    { name: 'Trapped', value: 4 },
    { name: 'Vargas Family', value: 'Revered' },
  ];

  it('matches by name, case-insensitively — trapped and Trapped are one condition', () => {
    expect(sameName('trapped', 'Trapped')).toBe(true);
    expect(hasEntry(entries, 'TRAPPED')).toBe(true);
    expect(findEntry(entries, 'trapped')?.value).toBe(4);
    expect(withoutEntry(entries, 'trapped')).toHaveLength(1);
  });

  it('numberOf is the single door for arithmetic — a rung is not a count', () => {
    expect(numberOf(findEntry(entries, 'Trapped'))).toBe(4);
    expect(numberOf(findEntry(entries, 'Vargas Family'))).toBeUndefined();
    expect(numberOf(undefined)).toBeUndefined();
  });

  it('formats for a human, and for a model that wants the number', () => {
    expect(formatEntry({ name: 'Afraid', value: 3 })).toBe('Afraid 3');
    expect(formatEntry({ name: 'Prone' })).toBe('Prone');
  });
});

describe('the draft mark — the only trace a half-made entity carries', () => {
  it('is an ordinary entry in an ordinary list, readable and strikeable by hand', () => {
    expect(isDraft({ id: 'ent_a', name: 'Nobody', lists: { meta: [{ name: 'draft' }] } })).toBe(
      true,
    );
    // Cleared at the last step — and cleared is the ordinary state.
    expect(isDraft({ id: 'ent_a', name: 'Nobody', lists: { meta: [] } })).toBe(false);
    expect(isDraft({ id: 'ent_a', name: 'Nobody', lists: {} })).toBe(false);
    expect(isDraft(undefined)).toBe(false);
  });
});
