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
import { fightGeometry, gridOf, sizeInHeader } from './geometry.ts';
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
