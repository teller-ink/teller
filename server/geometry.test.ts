// The fight's geometry — what a proposer is TOLD about the ground.
//
// Two halves, and the second is the reason the first exists. The
// arithmetic (`sizeInHeader`, `gridOf`, distances) is pinned because a
// measurement nobody checks is a guess with a decimal point. The
// ABSENCES are pinned because they were the actual bug: a snapshot with
// no board key reads, to whoever gets it, exactly like a fight in a
// featureless void — and a fact you hold and don't pass on is one the
// reader invents.
//
// Real files and a real Session, same reasoning as `boards.test.ts`: the
// board's proportions come out of a picture on disk, and a test that
// stubbed that would pin a shape the running host never produces.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf, type Shelf } from '../core/store.ts';
import { Session } from './session.ts';
import {
  bandOf,
  bandsIn,
  fightGeometry,
  gridOf,
  measureMove,
  movesBetween,
  sizeInHeader,
  zonesCrossed,
} from './geometry.ts';
import { nextUndoable } from './undo.ts';
import { snapshotFor } from './plugin-bridge.ts';
import { toNeed, type Need } from '../core/registry.ts';

let dir: string;
let shelf: Shelf;
let session: Session;

/** A picture's first bytes, and nothing after them — all this file reads. */
function pngHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/**
 * A 40-inch board over a 1200×900 picture — so it is 30 inches tall,
 * 40 squares across and 30 down, and every distance below is a whole
 * number somebody can check in their head.
 */
function board(widthInches: number | null = 40): string {
  mkdirSync(join(dir, 'map'), { recursive: true });
  writeFileSync(join(dir, 'map', 'field.png'), pngHeader(1200, 900));
  const row = shelf.putBoard({
    key: 'map/field.png',
    name: 'Open Field',
    ...(widthInches === null ? {} : { widthInches }),
  });
  const campaign = session.campaign;
  campaign.save(
    { ...campaign.root(), refs: { board: { id: row.id, name: row.name } } },
    'test',
  );
  session.reload();
  return row.id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-geometry-'));
  shelf = openShelf(dir);
  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  session = new Session(shelf, campaign, dir);
});

afterEach(() => {
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('reading a picture without decoding it', () => {
  it('finds the dimensions in a PNG, a GIF and a JPEG header', () => {
    expect(sizeInHeader(pngHeader(1200, 900))).toEqual({ w: 1200, h: 900 });

    const gif = Buffer.alloc(10);
    gif.write('GIF89a', 0);
    gif.writeUInt16LE(640, 6);
    gif.writeUInt16LE(480, 8);
    expect(sizeInHeader(gif)).toEqual({ w: 640, h: 480 });

    // SOI, then a segment to skip over, then the frame header.
    const jpeg = Buffer.alloc(40, 0);
    jpeg.writeUInt16BE(0xffd8, 0);
    jpeg.writeUInt16BE(0xffe0, 2);
    jpeg.writeUInt16BE(6, 4); // length, covering itself
    jpeg.writeUInt16BE(0xffc0, 10);
    jpeg.writeUInt16BE(11, 12);
    jpeg.writeUInt16BE(768, 15); // height
    jpeg.writeUInt16BE(1024, 17); // width
    expect(sizeInHeader(jpeg)).toEqual({ w: 1024, h: 768 });
  });

  it('answers undefined for bytes it cannot read, which becomes a stated absence', () => {
    expect(sizeInHeader(Buffer.from('not a picture at all'))).toBeUndefined();
    // No width declared is a different thing from no picture read, and
    // both of them are "no grid" — never a grid of one square.
    expect(gridOf(undefined, { w: 1200, h: 900 })).toBeUndefined();
    expect(gridOf(40, undefined)).toBeUndefined();
    expect(gridOf(40, { w: 1200, h: 900 })).toEqual({ cols: 40, rows: 30 });
  });
});

describe('measuring the fight', () => {
  it('measures every other token from the acting one, in inches and squares', () => {
    const id = board();
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const near = session.create({ name: 'Hosa', lists: {} }, 'test');
    const far = session.create({ name: 'Barrett', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          // A quarter of a 40" map away, straight across: 10 inches.
          { id: 'plc_b', entityId: near.id, u: 0.35, v: 0.5 },
          // And 0.2 of a 30" map down from that: 6 inches, so 3-4-5.
          { id: 'plc_c', entityId: far.id, u: 0.3, v: 0.7 },
        ],
      },
      'test',
    );

    const facts = fightGeometry(session, acting.id);
    if (!facts.present) throw new Error(facts.why);
    expect(facts.board).toEqual({
      id,
      name: 'Open Field',
      widthInches: 40,
      heightInches: 30,
    });
    expect(facts.grid).toEqual({ cols: 40, rows: 30 });
    expect(facts.measuredFrom).toBe('Peril');

    const byName = new Map(facts.tokens.map((t) => [t.name, t]));
    expect(byName.get('Peril')?.acting).toBe(true);
    expect(byName.get('Peril')?.awayInches).toBeUndefined();
    expect(byName.get('Hosa')?.awayInches).toBe(10);
    expect(byName.get('Hosa')?.awaySquares).toBe(10);
    // hypot(8, 6) — the numbers were chosen so the answer is exact.
    expect(byName.get('Barrett')?.awayInches).toBe(10);
    expect(byName.get('Peril')?.cell).toEqual([4, 15]);
    expect(byName.get('Hosa')?.cell).toEqual([14, 15]);
  });

  it('says who is standing in painted ground, and who is only beside it', () => {
    const id = board();
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const wading = session.create({ name: 'Hosa', lists: {} }, 'test');
    const beside = session.create({ name: 'Barrett', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          { id: 'plc_b', entityId: wading.id, u: 0.25, v: 0.5 },
          { id: 'plc_c', entityId: beside.id, u: 0.275, v: 0.5 },
        ],
        zones: [
          { id: 'zon_a', effect: 'water', cells: [[10, 15]] },
          // Painted, but not in a square anybody is standing in.
          { id: 'zon_b', effect: 'fire', cells: [[38, 2]] },
        ],
      },
      'test',
    );

    const facts = fightGeometry(session, acting.id);
    if (!facts.present) throw new Error(facts.why);
    const byName = new Map(facts.tokens.map((t) => [t.name, t]));
    expect(byName.get('Hosa')?.inZones).toEqual(['water']);
    expect(byName.get('Barrett')?.inZones).toBeUndefined();
    expect(byName.get('Barrett')?.nearZones).toEqual(['water']);
    expect(byName.get('Peril')?.nearZones).toBeUndefined();
    expect(facts.zones).toEqual([
      { name: 'water', cells: 1, hidden: false, standingIn: ['Hosa'] },
      { name: 'fire', cells: 1, hidden: false, standingIn: [] },
    ]);
  });

  it('keeps hidden tokens, and says they are hidden', () => {
    const id = board();
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const lurking = session.create({ name: 'Bark Watcher', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          { id: 'plc_b', entityId: lurking.id, u: 0.2, v: 0.5, hidden: true },
        ],
      },
      'test',
    );

    const facts = fightGeometry(session, acting.id);
    if (!facts.present) throw new Error(facts.why);
    // Not stripped — this slice is the Warden's own, gated at `dm`, and
    // a foe behind the screen is the whole subject of the question.
    // What it must never do is lose the flag and read as visible.
    const lurker = facts.tokens.find((t) => t.name === 'Bark Watcher');
    expect(lurker?.hidden).toBe(true);
    expect(lurker?.awayInches).toBe(4);
    expect(facts.tokens.find((t) => t.name === 'Peril')?.hidden).toBe(false);
  });
});

describe('the absences, each in its own words', () => {
  it('says there is no board rather than saying nothing', () => {
    const facts = fightGeometry(session, 'ent_nobody');
    expect(facts).toEqual({ present: false, why: 'no board is showing at this table' });
  });

  it('names the board when it is showing and empty', () => {
    board();
    const facts = fightGeometry(session, 'ent_nobody');
    expect(facts.present).toBe(false);
    if (facts.present) return;
    expect(facts.why).toBe("nothing is placed on the board ('Open Field')");
  });

  it('says so when the creature whose turn it is has no token', () => {
    const id = board();
    const other = session.create({ name: 'Hosa', lists: {} }, 'test');
    session.putBoardState(
      id,
      { placements: [{ id: 'plc_b', entityId: other.id, u: 0.35, v: 0.5 }] },
      'test',
    );
    const facts = fightGeometry(session, 'ent_not_here');
    if (!facts.present) throw new Error(facts.why);
    expect(facts.measuredFrom).toBeUndefined();
    expect(facts.unmeasured).toContain('no token on this board');
    expect(facts.tokens[0].awayInches).toBeUndefined();
  });

  it('says a board with no declared width could not be measured', () => {
    const id = board(null);
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const other = session.create({ name: 'Hosa', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          { id: 'plc_b', entityId: other.id, u: 0.35, v: 0.5 },
        ],
      },
      'test',
    );
    const facts = fightGeometry(session, acting.id);
    if (!facts.present) throw new Error(facts.why);
    expect(facts.grid).toBeUndefined();
    expect(facts.gridless).toContain('no declared width');
    expect(facts.units).toContain('declares no physical width');
    // No unit, so no number — never a number in an unstated unit.
    expect(facts.tokens.every((t) => t.awayInches === undefined)).toBe(true);
    expect(facts.tokens.every((t) => t.cell === undefined)).toBe(true);
  });

  it('keeps a token nobody linked, under its own label', () => {
    const id = board();
    session.putBoardState(
      id,
      { placements: [{ id: 'plc_a', label: 'a boulder', u: 0.5, v: 0.5 }] },
      'test',
    );
    const facts = fightGeometry(session, undefined);
    if (!facts.present) throw new Error(facts.why);
    expect(facts.tokens[0].name).toBe('a boulder');
    expect(facts.unmeasured).toContain('nobody is acting');
  });
});

// The same measurement, reached the other way — a door's snapshot.
describe('read:board, as a door sees it', () => {
  const needs = (...raw: string[]): Need[] =>
    raw.map(toNeed).filter((n): n is Need => n !== undefined);

  it('arrives measured from whoever is acting, and only for a door that asked', () => {
    const id = board();
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const other = session.create({ name: 'Hosa', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          { id: 'plc_b', entityId: other.id, u: 0.35, v: 0.5 },
        ],
      },
      'test',
    );
    session.turnOp({ op: 'add', entityId: acting.id }, 'test');
    session.turnOp({ op: 'next' }, 'test');

    // Nothing declared, nothing handed over — an absent key, never an error.
    expect(snapshotFor(session, needs('read:entities')).board).toBeUndefined();

    const asked = snapshotFor(session, needs('read:board — the ground')).board;
    expect(asked?.present).toBe(true);
    if (!asked?.present) return;
    // Whose turn it is comes out of the turn order here, so a door reads
    // the board from the acting creature's point of view without saying so.
    expect(asked.measuredFrom).toBe('Peril');
    expect(asked.tokens.find((t) => t.name === 'Hosa')?.awayInches).toBe(10);
  });
});

// The measurement, said in the system's own word for it.
//
// This is the second half of "measure, don't make the reader derive",
// and it was learned separately: handed inches with no ladder to hang
// them on, a reader said so out loud in the middle of a fight ("the
// snapshot gives no inch value for the bands — I am assuming"), and
// handed a band name with no inches behind it, an earlier one walked an
// attack out of its printed range to make a plan work. Both spellings,
// converted here, is the answer to both.
describe('converting a distance into the system’s own band', () => {
  const ladder = [
    { name: "Arm's Reach", to: 1, world: "within arm's reach" },
    { name: 'Short', from: 1, to: 6, world: 'up to 30 yards' },
    { name: 'Long', from: 6, world: 'past 30 yards' },
  ];

  it('reads the rungs forgivingly and picks the one a distance falls in', () => {
    const bands = bandsIn(ladder);
    expect(bands).toHaveLength(3);
    // `from` is inclusive and `to` exclusive, so a boundary belongs to
    // exactly one rung and never to both.
    expect(bandOf(0, bands)?.name).toBe("Arm's Reach");
    expect(bandOf(0.9, bands)?.name).toBe("Arm's Reach");
    expect(bandOf(1, bands)?.name).toBe('Short');
    expect(bandOf(5.9, bands)?.name).toBe('Short');
    expect(bandOf(6, bands)?.name).toBe('Long');
    // An open-topped rung has no ceiling to fall off.
    expect(bandOf(400, bands)?.name).toBe('Long');
  });

  it('drops a rung with no name, and answers nothing for a system with no ladder', () => {
    expect(bandsIn([{ world: 'somewhere' }, { name: '  ' }, 'Short'])).toEqual([]);
    expect(bandsIn(undefined)).toEqual([]);
    expect(bandOf(3, [])).toBeUndefined();
  });

  it('rides on every measured distance, or is absent when nothing was declared', () => {
    const id = board();
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const other = session.create({ name: 'Hosa', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          // 10 inches across a 40-inch map.
          { id: 'plc_b', entityId: other.id, u: 0.35, v: 0.5 },
        ],
      },
      'test',
    );

    // No system, no ladder: the inches stand alone rather than being
    // hung on a rung teller made up.
    const bare = fightGeometry(session, acting.id);
    if (!bare.present) throw new Error(bare.why);
    expect(bare.tokens.find((t) => t.name === 'Hosa')?.awayInches).toBe(10);
    expect(bare.tokens.find((t) => t.name === 'Hosa')?.awayBand).toBeUndefined();

    shelf.putSystem({ id: 'sys_ladder', name: 'Laddered', version: 1, data: { bands: ladder } });
    const root = session.campaign.root();
    session.campaign.save(
      { ...root, refs: { ...root.refs, system: { id: 'sys_ladder', name: 'Laddered' } } },
      'test',
    );
    session.reload();

    const facts = fightGeometry(session, acting.id);
    if (!facts.present) throw new Error(facts.why);
    expect(facts.tokens.find((t) => t.name === 'Hosa')).toMatchObject({
      awayInches: 10,
      awaySquares: 10,
      awayBand: { name: 'Long', world: 'past 30 yards' },
    });
    // The one it was measured FROM has no distance, so it has no band.
    expect(facts.tokens.find((t) => t.name === 'Peril')?.awayBand).toBeUndefined();
  });
});

// WHO MOVED — the fact teller was not keeping.
//
// A board state is a photograph and cannot say anybody moved, so the
// diff below is where the fact comes from. Two halves are pinned
// separately because they failed separately in the design: the diff has
// to stay NARROW (a drag arrives as a whole-state PUT carrying fog,
// paint and the table's aim, and a repaint that logs six creatures
// standing still is worse than no history at all), and the measurement
// has to be teller's (a reader asked to work out 'toward' from two
// coordinate pairs will eventually work it out generously).
describe('what moved between two board states', () => {
  const at = (id: string, u: number, v: number, extra: object = {}) => ({
    id,
    entityId: `ent_${id}`,
    u,
    v,
    ...extra,
  });

  it('reports a step, and only a step', () => {
    const before = { placements: [at('plc_a', 0.1, 0.5), at('plc_b', 0.4, 0.5)] };
    const after = { placements: [at('plc_a', 0.2, 0.5), at('plc_b', 0.4, 0.5)] };
    expect(movesBetween(before, after)).toEqual([
      {
        placementId: 'plc_a',
        entityId: 'ent_plc_a',
        hidden: false,
        from: { u: 0.1, v: 0.5 },
        to: { u: 0.2, v: 0.5 },
      },
    ]);
  });

  it('says nothing about a write that only repainted, refogged or re-aimed', () => {
    const placements = [at('plc_a', 0.1, 0.5)];
    expect(
      movesBetween(
        { placements, zones: [], view: { mode: 'fit', zoom: 1, cu: 0.5, cv: 0.5 } },
        {
          placements,
          zones: [{ id: 'zon_a', effect: 'fire', cells: [[3, 3]] }],
          fog: { on: true, revealed: [[1, 1]] },
          view: { mode: 'true', zoom: 2, cu: 0.2, cv: 0.2 },
        },
      ),
    ).toEqual([]);
  });

  it('an arrival is not a step, and neither is a removal', () => {
    const one = { placements: [at('plc_a', 0.1, 0.5)] };
    const two = { placements: [at('plc_a', 0.1, 0.5), at('plc_b', 0.9, 0.9)] };
    expect(movesBetween(one, two)).toEqual([]);
    expect(movesBetween(two, one)).toEqual([]);
    // And a board that had nothing on it at all — a deploy — is all arrivals.
    expect(movesBetween(null, two)).toEqual([]);
  });

  it('matches on the placement id, and falls back to the entity for a state without one', () => {
    const before = { placements: [{ entityId: 'ent_a', u: 0.1, v: 0.5 }] };
    const after = { placements: [{ id: 'plc_new', entityId: 'ent_a', u: 0.3, v: 0.5 }] };
    expect(movesBetween(before, after)).toMatchObject([
      { entityId: 'ent_a', from: { u: 0.1, v: 0.5 }, to: { u: 0.3, v: 0.5 } },
    ]);
  });

  it('keeps a hidden token’s step, and an unlinked token under its own label', () => {
    const before = { placements: [{ id: 'plc_a', label: 'a boulder', u: 0.1, v: 0.5, hidden: true }] };
    const after = { placements: [{ id: 'plc_a', label: 'a boulder', u: 0.4, v: 0.5, hidden: true }] };
    expect(movesBetween(before, after)).toEqual([
      {
        placementId: 'plc_a',
        label: 'a boulder',
        hidden: true,
        from: { u: 0.1, v: 0.5 },
        to: { u: 0.4, v: 0.5 },
      },
    ]);
  });

  it('writes one record per moved token, filed against whoever took the step', () => {
    const id = board();
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const other = session.create({ name: 'Hosa', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          { id: 'plc_b', entityId: other.id, u: 0.9, v: 0.5 },
        ],
      },
      'test',
    );
    // A deploy is arrivals, so the log holds the board write and no step.
    expect(session.campaign.events({ limit: 20 }).some((e) => e.kind === 'token.moved')).toBe(false);

    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          { id: 'plc_b', entityId: other.id, u: 0.5, v: 0.5 },
        ],
      },
      'test',
    );
    const moved = session.campaign.events({ limit: 20 }).filter((e) => e.kind === 'token.moved');
    expect(moved).toHaveLength(1);
    expect(moved[0].entityId).toBe(other.id);
    expect(moved[0].payload).toMatchObject({
      boardId: id,
      placementId: 'plc_b',
      by: other.id,
      byName: 'Hosa',
      from: { u: 0.9, v: 0.5 },
      to: { u: 0.5, v: 0.5 },
      round: 1,
    });
    // It changed no state of its own, so `/undo` steps over it rather
    // than claiming to move a mini nobody touched.
    expect(nextUndoable(session)?.kind).not.toBe('token.moved');
  });
});

describe('measuring a step', () => {
  const ladder = [
    { name: "Arm's Reach", to: 1, world: "within arm's reach" },
    { name: 'Short', from: 1, to: 6, world: 'up to 30 yards' },
    { name: 'Long', from: 6, world: 'past 30 yards' },
  ];

  /** A fight with Peril acting at u=0.1 on the 40" × 30" field. */
  function fight() {
    const id = board();
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const other = session.create({ name: 'Hosa', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, u: 0.1, v: 0.5 },
          { id: 'plc_b', entityId: other.id, u: 0.6, v: 0.5 },
        ],
      },
      'test',
    );
    return { id, acting, other, facts: fightGeometry(session, acting.id) };
  }

  it('says how far it went and which way, in inches and in the system’s word', () => {
    const { acting, other, facts } = fight();
    const bands = bandsIn(ladder);
    // 0.9 → 0.6 across a 40" map: an 12" step that closes from 32" to 20".
    const closing = measureMove(
      {
        boardId: 'brd',
        by: other.id,
        byName: 'Hosa',
        from: { u: 0.9, v: 0.5 },
        to: { u: 0.6, v: 0.5 },
        round: 2,
      },
      facts,
      bands,
    );
    expect(closing).toMatchObject({
      name: 'Hosa',
      round: 2,
      wentInches: 12,
      wentSquares: 12,
      wentBand: { name: 'Long' },
      wasAwayInches: 32,
      nowAwayInches: 20,
      sense: 'toward',
      wasBand: { name: 'Long' },
      nowBand: { name: 'Long' },
    });
    expect(closing.mine).toBeUndefined();

    // The same step, backwards.
    expect(
      measureMove(
        { boardId: 'brd', by: other.id, byName: 'Hosa', from: { u: 0.6, v: 0.5 }, to: { u: 0.9, v: 0.5 } },
        facts,
        bands,
      ).sense,
    ).toBe('away');

    // A circle at the same reach is neither, and saying it was one
    // would put intent in the reader's mouth.
    expect(
      measureMove(
        { boardId: 'brd', by: other.id, byName: 'Hosa', from: { u: 0.6, v: 0.4 }, to: { u: 0.6, v: 0.6 } },
        facts,
        bands,
      ).sense,
    ).toBe('neither');

    // The acting creature's own step gets a distance and no direction.
    const own = measureMove(
      { boardId: 'brd', by: acting.id, byName: 'Peril', from: { u: 0.05, v: 0.5 }, to: { u: 0.1, v: 0.5 } },
      facts,
      bands,
    );
    expect(own).toMatchObject({ mine: true, wentInches: 2 });
    expect(own.sense).toBeUndefined();
  });

  it('measures nothing on an uncalibrated board, and keeps the name either way', () => {
    board(null);
    const other = session.create({ name: 'Hosa', lists: {} }, 'test');
    const facts = fightGeometry(session, undefined);
    const record = {
      boardId: 'brd',
      by: other.id,
      byName: 'Hosa',
      hidden: true,
      from: { u: 0.1, v: 0.5 },
      to: { u: 0.4, v: 0.5 },
    };
    // No board is present at all here — no placements — so nothing but
    // the name and the concealment survive. An absent number beats an
    // unlabelled one.
    expect(measureMove(record, facts, [])).toEqual({ name: 'Hosa', hidden: true });
  });
});

// WHAT LIES BETWEEN — a fact about the PATH, not about either end.
describe('the ground a straight line crosses', () => {
  const grid = { cols: 40, rows: 30 };
  /** Map space for the centre of cell [col, row] on the 40 × 30 grid. */
  const cell = (col: number, row: number) => ({
    u: (col + 0.5) / grid.cols,
    v: (row + 0.5) / grid.rows,
  });

  it('names the zones in the way, and counts the squares of them', () => {
    const zones = [
      { name: 'fire', cells: [[5, 10], [6, 10], [7, 10]] as [number, number][] },
      { name: 'water', cells: [[20, 20]] as [number, number][] },
    ];
    expect(zonesCrossed(cell(2, 10), cell(10, 10), zones, grid)).toEqual([
      { name: 'fire', cells: 3 },
    ]);
    // Nothing painted in the way says nothing — not 'none'.
    expect(zonesCrossed(cell(2, 0), cell(10, 0), zones, grid)).toEqual([]);
  });

  it('leaves out ground either end is already standing in', () => {
    const zones = [{ name: 'water', cells: [[2, 10], [5, 10], [8, 10]] as [number, number][] }];
    // Standing in it at one end: already reported as standing in, so it
    // is not also a patch to be crossed.
    expect(zonesCrossed(cell(2, 10), cell(10, 10), zones, grid)).toEqual([]);
    expect(zonesCrossed(cell(10, 10), cell(8, 10), zones, grid)).toEqual([]);
    // Neither end in it, and it is squarely in the middle.
    expect(zonesCrossed(cell(3, 10), cell(10, 10), zones, grid)).toEqual([
      { name: 'water', cells: 2 },
    ]);
  });

  it('carries hidden ground, because this rides a DM-gated need', () => {
    const zones = [{ name: 'pit', cells: [[5, 10]] as [number, number][], hidden: true }];
    expect(zonesCrossed(cell(2, 10), cell(9, 10), zones, grid)).toEqual([
      { name: 'pit', cells: 1, hidden: true },
    ]);
  });

  it('rides on the acting token’s measurement of everyone else', () => {
    const id = board();
    const acting = session.create({ name: 'Peril', lists: {} }, 'test');
    const across = session.create({ name: 'Hosa', lists: {} }, 'test');
    const clear = session.create({ name: 'Barrett', lists: {} }, 'test');
    session.putBoardState(
      id,
      {
        placements: [
          { id: 'plc_a', entityId: acting.id, ...cell(2, 15) },
          { id: 'plc_b', entityId: across.id, ...cell(10, 15) },
          { id: 'plc_c', entityId: clear.id, ...cell(2, 2) },
        ],
        zones: [{ id: 'zon_a', effect: 'fire', cells: [[5, 15], [6, 15]] }],
      },
      'test',
    );
    const facts = fightGeometry(session, acting.id);
    if (!facts.present) throw new Error(facts.why);
    const byName = new Map(facts.tokens.map((t) => [t.name, t]));
    expect(byName.get('Hosa')?.between).toEqual([{ name: 'fire', cells: 2 }]);
    // Nothing in the way is silence, and the acting token measures
    // nothing against itself.
    expect(byName.get('Barrett')?.between).toBeUndefined();
    expect(byName.get('Peril')?.between).toBeUndefined();
  });
});
