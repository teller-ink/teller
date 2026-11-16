// The floor's add form, as arithmetic: what a typed-in entry becomes,
// and which entries are teller's own marks rather than the game's.

import { describe, expect, it } from 'vitest';
import type { Entry } from '../../core/entity.ts';
import { countsNumbers, floorEntries, isTellerMark, readDraft } from './floor.ts';

const draft = (patch: Partial<{ list: string; name: string; value: string; max: string }>) => ({
  list: 'resources',
  name: 'Wounds',
  value: '',
  max: '',
  ...patch,
});

const lists: Record<string, Entry[]> = {
  resources: [{ name: 'Supply', value: 2 }],
  conditions: [{ name: 'Prone' }],
  meta: [{ name: 'side', value: 'party' }, { name: 'draft' }, { name: 'Hidden' }, { name: 'mood', value: 'grim' }],
};

describe('teller’s own marks', () => {
  it('side, draft and hidden in meta are teller’s, whatever their case', () => {
    expect(isTellerMark('meta', 'side')).toBe(true);
    expect(isTellerMark('Meta', { name: 'DRAFT' })).toBe(true);
    expect(isTellerMark('meta', 'hidden')).toBe(true);
    expect(floorEntries('meta', lists.meta).map((e) => e.name)).toEqual(['mood']);
  });

  it('the same names anywhere else are the game’s', () => {
    expect(isTellerMark('conditions', 'hidden')).toBe(false);
    expect(floorEntries('conditions', [{ name: 'side' }])).toHaveLength(1);
  });
});

describe('reading the add form', () => {
  it('a number is a counter, with a max it is a bar', () => {
    expect(readDraft(draft({ value: '3' }), lists)).toMatchObject({ ok: true, value: 3, mark: false });
    expect(readDraft(draft({ value: '2', max: '3' }), lists)).toMatchObject({ ok: true, value: 2, max: 3 });
  });

  it('a max with the value left blank starts full', () => {
    expect(readDraft(draft({ max: '5' }), lists)).toMatchObject({ ok: true, value: 5, max: 5, mark: false });
  });

  it('words are a plain value, and words cannot wear a ceiling', () => {
    expect(readDraft(draft({ value: 'notched' }), lists)).toMatchObject({ ok: true, value: 'notched' });
    expect(readDraft(draft({ value: 'notched', max: '3' }), lists)).toMatchObject({ ok: false });
    expect(readDraft(draft({ value: '1', max: 'lots' }), lists)).toMatchObject({ ok: false });
  });

  it('nothing is a mark — asked about in a list of counters, plain elsewhere', () => {
    expect(readDraft(draft({}), lists)).toMatchObject({ ok: true, mark: true, unlikely: true });
    expect(readDraft(draft({ list: 'conditions', name: 'Afraid' }), lists)).toMatchObject({
      ok: true,
      mark: true,
      unlikely: false,
    });
    expect(readDraft(draft({ list: 'gear', name: 'Rope' }), lists)).toMatchObject({ unlikely: false });
  });

  it('a list typed in another case lands in the one that exists', () => {
    expect(readDraft(draft({ list: 'Resources', value: '1' }), lists)).toMatchObject({ list: 'resources' });
  });

  it('refuses in words: no list, no name, a name already there, a mark of teller’s', () => {
    expect(readDraft(draft({ list: ' ' }), lists)).toMatchObject({ ok: false });
    expect(readDraft(draft({ name: '' }), lists)).toMatchObject({ ok: false });
    expect(readDraft(draft({ name: 'supply', value: '1' }), lists)).toMatchObject({ ok: false });
    expect(readDraft(draft({ list: 'meta', name: 'side', value: 'foe' }), lists)).toMatchObject({ ok: false });
  });

  it('a list of counters is one where every entry is a number', () => {
    expect(countsNumbers(lists.resources)).toBe(true);
    expect(countsNumbers([])).toBe(false);
    expect(countsNumbers([{ name: 'a', value: 1 }, { name: 'b' }])).toBe(false);
  });
});
