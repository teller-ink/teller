// The panel declaration's own grammar: what a `panel.json` may say, and
// what a collection of them can be wrong about.
//
// §M-5a (the composite) and §M-5a′ (the include) both land here rather
// than in the renderer, because both are facts about DECLARATIONS: the
// tab list is data a table can reorder in four lines of json, and a
// dangling or circular include is knowable the moment the merge settles.

import { describe, expect, it } from 'vitest';
import {
  draftTakeover,
  includeProblems,
  includedNames,
  seatComposite,
  surfaceable,
  toPanel,
  type PanelDef,
} from './panels.ts';

describe('what toPanel keeps', () => {
  it('reads a composite whole — tabs, omissions, chrome overrides, its glyph', () => {
    const panel = toPanel({
      name: 'seat',
      label: 'Seat',
      icon: 'sheet',
      subject: 'entity',
      tabs: ['sheet', ' Weapons ', 'More'],
      omit: ['bare'],
      chrome: { header: 'Header', bar: 'ScreenBar', nonsense: 'Nope', frame: '  ' },
    });
    expect(panel?.tabs).toEqual(['sheet', 'Weapons', 'More']);
    expect(panel?.omit).toEqual(['bare']);
    expect(panel?.icon).toBe('sheet');
    // Only the five seams exist, and only a non-empty word names one.
    expect(panel?.chrome).toEqual({ header: 'Header', bar: 'ScreenBar' });
  });

  it('keeps `surface: false` and nothing else about it', () => {
    expect(toPanel({ name: 'vitals-strip', surface: false })?.surface).toBe(false);
    // Silence means surfaceable — the ordinary case must never need saying.
    expect(toPanel({ name: 'sheet' })?.surface).toBeUndefined();
    expect(toPanel({ name: 'sheet', surface: true })?.surface).toBeUndefined();
  });

  it('keeps the draft takeover the composite names, trimmed', () => {
    expect(toPanel({ name: 'seat', draft: '  builder ' })?.draft).toBe('builder');
    expect(toPanel({ name: 'seat', draft: '   ' })?.draft).toBeUndefined();
    expect(toPanel({ name: 'seat', draft: 7 })?.draft).toBeUndefined();
  });

  it('drops a tabs list that is not a list of words', () => {
    expect(toPanel({ name: 'seat', tabs: 'sheet' })?.tabs).toBeUndefined();
    expect(toPanel({ name: 'seat', tabs: ['sheet', 3, ''] })?.tabs).toEqual(['sheet']);
  });
});

describe('a fragment is not a surface', () => {
  it('says no to `surface: false` and yes to everything else', () => {
    expect(surfaceable({ name: 'sheet' })).toBe(true);
    expect(surfaceable({ name: 'strip', surface: false })).toBe(false);
  });
});

describe('what an arrangement includes', () => {
  it('finds includes at any depth, deduped, columns and both glasses walked', () => {
    const panel: PanelDef = {
      name: 'sheet',
      mounted: [
        { block: 'columns', columns: [[{ block: 'panel', name: 'vitals' }], [{ block: 'list' }]] },
        { block: 'panel', name: 'vitals' },
      ],
      held: [{ block: 'panel', name: 'statuses-strip' }],
    };
    expect(includedNames(panel).sort()).toEqual(['statuses-strip', 'vitals']);
  });

  it('ignores an include with no name', () => {
    expect(includedNames({ name: 'x', held: [{ block: 'panel' }] })).toEqual([]);
  });
});

describe('includes that refuse out loud', () => {
  it('says nothing about a collection that resolves', () => {
    expect(
      includeProblems([
        { name: 'seat', held: [{ block: 'panel', name: 'vitals' }] },
        { name: 'vitals', surface: false, held: [{ block: 'list', list: 'resources' }] },
      ]),
    ).toEqual([]);
  });

  it('names the panel and the word when nobody declares it', () => {
    const [problem] = includeProblems([
      { name: 'seat', held: [{ block: 'panel', name: 'vitals' }] },
    ]);
    expect(problem.dir).toBe("panel 'seat'");
    expect(problem.problem).toContain("includes 'vitals'");
    expect(problem.problem).toContain('no panel by that name');
  });

  it('catches a cycle — direct, and around a longer ring', () => {
    const direct = includeProblems([
      { name: 'a', held: [{ block: 'panel', name: 'b' }] },
      { name: 'b', held: [{ block: 'panel', name: 'a' }] },
    ]);
    expect(direct.length).toBeGreaterThan(0);
    expect(direct[0].problem).toContain('includes it back');

    const ring = includeProblems([
      { name: 'a', held: [{ block: 'panel', name: 'b' }] },
      { name: 'b', held: [{ block: 'panel', name: 'c' }] },
      { name: 'c', held: [{ block: 'panel', name: 'a' }] },
    ]);
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.some((p) => p.problem.includes('a → b → c → a'))).toBe(true);
  });

  it('a panel that includes itself is a cycle, not a stack overflow', () => {
    const problems = includeProblems([
      { name: 'sheet', held: [{ block: 'panel', name: 'sheet' }] },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('includes it back');
  });

  it('resolves the name against the MERGE, case-insensitively', () => {
    expect(
      includeProblems([
        { name: 'Seat', held: [{ block: 'panel', name: 'VITALS' }] },
        { name: 'vitals', held: [] },
      ]),
    ).toEqual([]);
  });
});

describe("the composite's draft takeover (§M-4a)", () => {
  const builder: PanelDef = { name: 'builder', surface: false, held: [] };
  const seat: PanelDef = { name: 'seat', tabs: ['sheet'], draft: 'builder' };

  it('hands the whole strip to the named panel while the subject is a draft', () => {
    expect(draftTakeover(seat, [builder], true)).toEqual({ panel: builder });
  });

  it('a fragment is a legal target — a builder is nowhere anyone can be pointed', () => {
    expect(surfaceable(builder)).toBe(false);
    expect(draftTakeover(seat, [builder], true)).toEqual({ panel: builder });
  });

  it('the mark clearing hands the seat straight back — no reload, it is live data', () => {
    expect(draftTakeover(seat, [builder], false)).toBeUndefined();
  });

  it('no draft key is the FLOOR: today\'s behaviour, unchanged', () => {
    expect(draftTakeover({ name: 'seat', tabs: ['sheet'] }, [builder], true)).toBeUndefined();
    expect(draftTakeover(undefined, [builder], true)).toBeUndefined();
  });

  it('a dangling name refuses out loud, and the caller keeps the normal seat', () => {
    const answer = draftTakeover(seat, [], true);
    expect(answer).toEqual({
      refusal:
        "no panel named 'builder' — this seat's draft takeover asked for it and nothing declares it",
    });
  });

  it('resolves the name against the merge, case-insensitively', () => {
    expect(draftTakeover({ name: 'seat', draft: 'BUILDER' }, [builder], true)).toEqual({
      panel: builder,
    });
  });
});

describe('which composite the seat wears (§M-5a, ruled 2026-08-20)', () => {
  const sheet: PanelDef = { name: 'sheet', subject: 'entity', held: [] };
  const seat: PanelDef = { name: 'seat', subject: 'entity', tabs: ['sheet', 'More'] };

  it('is the entity-subject panel carrying tabs — nothing the DM points at', () => {
    expect(seatComposite([sheet, seat])).toBe(seat);
  });

  it('is nothing at all on a shelf that declares none — the floor keeps the seat', () => {
    expect(seatComposite([sheet])).toBeUndefined();
    // A tool panel with tabs is not a seat, and neither is an empty list.
    expect(seatComposite([{ name: 'seat', subject: 'none', tabs: ['sheet'] }])).toBeUndefined();
    expect(seatComposite([{ name: 'seat', subject: 'entity', tabs: [] }])).toBeUndefined();
  });

  it("the word 'seat' wins, wherever it sits in the merge", () => {
    const other: PanelDef = { name: 'strip', subject: 'entity', tabs: ['sheet'], order: 1 };
    expect(seatComposite([other, seat])).toBe(seat);
    expect(seatComposite([{ ...seat, name: 'SEAT' }, other])?.name).toBe('SEAT');
  });

  it('otherwise the lowest order, and otherwise the earliest declaration', () => {
    const first: PanelDef = { name: 'strip', subject: 'entity', tabs: ['sheet'] };
    const second: PanelDef = { name: 'card', subject: 'entity', tabs: ['sheet'] };
    expect(seatComposite([first, second])).toBe(first);
    expect(seatComposite([first, { ...second, order: 1 }])?.name).toBe('card');
  });

  it('a fragment is a legal answer — nobody is pointed at a seat any more', () => {
    const hidden: PanelDef = { name: 'seat', subject: 'entity', tabs: ['sheet'], surface: false };
    expect(seatComposite([hidden])).toBe(hidden);
  });
});
