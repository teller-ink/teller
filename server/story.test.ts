// `.story` at the seam — export, inspect, and the two import doors.
//
// What's worth holding still here is the pair of laws that are easy to
// write and easy to lose: a story CREATED fresh keeps its ids and its
// history, and a story LAYERED onto a running table never wins an
// argument with a value somebody already stored. Everything else is
// bookkeeping around those two.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openCampaign, openShelf, type Shelf } from '../core/store.ts';
import { Session } from './session.ts';
import { parseStory } from '../core/bundle.ts';
import {
  STORY_SLOT,
  exportStory,
  importFresh,
  importLayer,
  inspectStory,
} from './story.ts';

let dir: string;
let away: string;

/** A shelf with the Test system and one pack on it — what a story expects to find. */
function stock(at: string): Shelf {
  const shelf = openShelf(at);
  shelf.putSystem({ id: 'sys_test', name: 'Test', version: 1, data: {} });
  shelf.putPack({ id: 'pak_one', system: 'sys_test', name: 'One', version: 2, data: {} });
  return shelf;
}

/**
 * A table mid-game: a roster with something nested under it, a fight in
 * progress, a board with tokens on it, a handout with a real file
 * behind it, and enough history to matter.
 */
function table(at: string, slug = 'unlikely-duo'): Session {
  const shelf = stock(at);
  const campaign = createCampaign(at, slug, 'The Unlikely Duo');
  const root = campaign.root();
  campaign.save(
    {
      ...root,
      lists: { resources: [{ name: 'Supplies', value: 3, max: 5 }] },
      refs: {
        system: { id: 'sys_test', name: 'Test' },
        packs: [{ id: 'pak_one', name: 'One' }],
      },
    },
    'dm',
  );

  const barrett = campaign.create(
    { name: 'Barrett', type: 'character', lists: { skills: [{ name: 'Grit', value: 2 }] } },
    'dm',
  );
  campaign.create({ name: 'Pistol', type: 'item', lists: {} }, 'dm', barrett.id);
  campaign.create({ name: 'Bog Lurker', type: 'foe', lists: {} }, 'dm');

  campaign.putTemplate('bestiary', { id: 'npc_lurker', name: 'Bog Lurker' }, 'dm');
  campaign.putTemplate('encounters', { id: 'enc_reeds', name: 'The Reeds' }, 'dm');
  mkdirSync(join(at, 'art', 'handouts'), { recursive: true });
  writeFileSync(join(at, 'art', 'handouts', 'abc.png'), Buffer.from('a picture'));
  campaign.putTemplate(
    'handouts',
    { id: 'tpl_wanted', name: 'Wanted Poster', data: { key: 'art/handouts/abc.png' } },
    'dm',
  );

  shelf.putBoard({ id: 'brd_canyon', key: 'map/canyon.png', name: 'The Canyon', widthInches: 24 });
  campaign.putBoardState('brd_canyon', { tokens: [{ id: barrett.id, u: 2, v: 3 }] }, 'dm');
  campaign.putTurnState({ order: [{ id: barrett.id }], turn: 0, round: 2 }, 'dm', { op: 'start' });
  // A distinctive row in the log, so a test can tell "this table's
  // history" apart from "events this import happened to write".
  campaign.append(barrett.id, 'dm', 'dice.rolled', { pool: '2d6' });

  return new Session(shelf, campaign, at);
}

const hasBefore = (payload: unknown): boolean =>
  Boolean(payload && typeof payload === 'object' && 'before' in payload);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-story-'));
  away = mkdtempSync(join(tmpdir(), 'teller-away-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(away, { recursive: true, force: true });
});

describe('export', () => {
  it('writes the manifest facts, references what it runs on, and carries nobody`s pack', () => {
    const session = table(dir);
    const { manifest, bytes } = exportStory(session);
    expect(manifest.teller).toBe(3);
    expect(manifest.name).toBe('The Unlikely Duo');
    expect(manifest.requires.system).toEqual({ id: 'sys_test', name: 'Test', version: 1 });
    expect(manifest.requires.packs).toEqual([{ id: 'pak_one', name: 'One', version: 2 }]);
    expect(manifest.contains).toEqual(
      expect.arrayContaining(['campaign', 'templates', 'entities', 'turn', 'boards', 'events', 'assets']),
    );
    // A pack's body is nowhere in the file — rule 9, as a property of
    // the bytes rather than of a comment.
    expect(bytes.toString('latin1')).not.toContain('pak_one_body');
    session.campaign.close();
  });

  it('mints a sto_ id once and keeps it; the version counts exports', () => {
    const session = table(dir);
    const first = exportStory(session);
    const second = exportStory(session);
    expect(first.manifest.story).toMatch(/^sto_[0-9a-f]{12}$/);
    expect(second.manifest.story).toBe(first.manifest.story);
    expect(first.manifest.version).toBe(1);
    expect(second.manifest.version).toBe(2);
    session.campaign.close();
  });

  it('rights are declared, absent reads personal, and the declaration is remembered', () => {
    const session = table(dir);
    expect(exportStory(session).manifest.rights).toEqual({ basis: 'personal' });
    const declared = exportStory(session, {
      rights: { basis: 'licensed', holder: 'A Publisher', terms: 'ask first' },
    });
    expect(declared.manifest.rights).toEqual({
      basis: 'licensed',
      holder: 'A Publisher',
      terms: 'ask first',
    });
    // Stated once, then remembered — the next export doesn't quietly
    // demote a licensed story to personal.
    expect(exportStory(session).manifest.rights.basis).toBe('licensed');
    session.campaign.close();
  });

  it('never writes its own identity row into the file', () => {
    const session = table(dir);
    const { bytes } = exportStory(session);
    const fresh = importFresh(stock(away), away, bytes);
    const copy = openCampaign(away, fresh.slug);
    expect(copy.templatesIn(STORY_SLOT)).toEqual([]);
    // …so the copy is its own story, not a second mouth on the original's id.
    const other = new Session(openShelf(away), copy, away);
    expect(exportStory(other).manifest.story).not.toBe(
      exportStory(session).manifest.story,
    );
    copy.close();
    session.campaign.close();
  });

  it('section switches actually leave things out', () => {
    const session = table(dir);
    const { manifest } = exportStory(session, {
      sections: { entities: false, events: false, boards: false, turn: false, assets: false },
    });
    expect(manifest.contains).toEqual(['campaign', 'templates']);
    // Dropping history takes the undo scaffolding with it — keeping the
    // heavy half of a thing you dropped is not a switch anyone wanted.
    const kit = exportStory(session, { sections: { events: false, undo: true } });
    expect(kit.manifest.contains).not.toContain('events');
    session.campaign.close();
  });

  it('the undo switch drops the before-snapshots and keeps what happened', () => {
    const session = table(dir);
    const kept = parseStory(exportStory(session).bytes).events;
    const stripped = parseStory(
      exportStory(session, { sections: { undo: false } }).bytes,
    ).events;
    // What HAPPENED survives; only the machinery for reversing it goes.
    // (The second export is one row longer, because stamping the story
    // version is itself a logged mutation — rule 3 applies to exporting
    // too — so the KINDS are what's compared.)
    expect(new Set(stripped.map((e) => e.kind))).toEqual(new Set(kept.map((e) => e.kind)));
    expect(kept.some((e) => hasBefore(e.payload))).toBe(true);
    expect(stripped.some((e) => hasBefore(e.payload))).toBe(false);
    session.campaign.close();
  });
});

describe('inspect', () => {
  it('counts what is inside and derives the kind, never storing it', () => {
    const session = table(dir);
    const summary = inspectStory(exportStory(session).bytes, stock(away));
    expect(summary.kind).toBe('a table in progress');
    expect(summary.sections.find((s) => s.name === 'entities')?.count).toBe(3);
    expect(summary.sections.find((s) => s.name === 'assets')).toMatchObject({
      count: 1,
      label: 'image',
    });
    expect(Object.keys(summary.manifest)).not.toContain('kind');
    session.campaign.close();
  });

  it('says which packs and books you are missing rather than dropping them', () => {
    const session = table(dir);
    const bare = openShelf(away);
    const summary = inspectStory(exportStory(session).bytes, bare);
    expect(summary.missing).toEqual([
      { slot: 'system', ref: { id: 'sys_test', name: 'Test', version: 1 } },
      { slot: 'pack', ref: { id: 'pak_one', name: 'One', version: 2 } },
    ]);
    session.campaign.close();
  });

  it('refuses something that is not a story, without crashing on it', () => {
    expect(() => inspectStory(Buffer.from('not a zip at all'), openShelf(away))).toThrow(
      /not a \.story/,
    );
  });
});

describe('door (a) — start this fresh', () => {
  it('round-trips: what came out reads the same on the other host', () => {
    const session = table(dir);
    const { bytes, manifest } = exportStory(session);
    const report = importFresh(stock(away), away, bytes);
    const copy = openCampaign(away, report.slug);

    const root = copy.root();
    expect(root.name).toBe('The Unlikely Duo');
    expect(root.lists.resources).toEqual([{ name: 'Supplies', value: 3, max: 5 }]);
    expect(root.refs?.system).toEqual({ id: 'sys_test', name: 'Test' });
    expect(root.refs?.packs).toEqual([{ id: 'pak_one', name: 'One' }]);
    // Provenance (§14): where this campaign was stamped from.
    expect(root.refs?.from).toEqual({ id: manifest.story, name: 'The Unlikely Duo' });

    const roster = copy.children(root.id);
    expect(roster.map((e) => e.name).sort()).toEqual(['Barrett', 'Bog Lurker']);
    // Ids are kept — a whole-file stamp, so the log, the placements and
    // the turn order keep pointing at the same things.
    const barrett = roster.find((e) => e.name === 'Barrett')!;
    expect(copy.get(barrett.id)).toBeDefined();
    expect(copy.children(barrett.id).map((e) => e.name)).toEqual(['Pistol']);

    expect(copy.templatesIn('bestiary')).toEqual([{ id: 'npc_lurker', name: 'Bog Lurker' }]);
    expect(copy.turnState()).toMatchObject({ round: 2 });
    expect(copy.boardState('brd_canyon')).toMatchObject({ tokens: [{ u: 2, v: 3 }] });
    expect(openShelf(away).board('brd_canyon')).toMatchObject({
      key: 'map/canyon.png',
      widthInches: 24,
    });
    expect(existsSync(join(away, 'art', 'handouts', 'abc.png'))).toBe(true);
    copy.close();
    session.campaign.close();
  });

  // A board's GEOGRAPHY travels with the row, not with the fight — the
  // areas already did, and terrain is the same category of fact for the
  // same reason: the canyon is a canyon on whoever's host it lands. The
  // bind between them has to survive too, or a `.story` arrives with a
  // ford that covers nothing.
  it('a board’s areas and terrain travel with the row, bind intact', () => {
    const session = table(dir);
    session.shelf.putBoard({
      ...session.shelf.board('brd_canyon')!,
      areas: [{ id: 'are_ford', name: 'the ford', cells: [[5, 15], [6, 15]] }],
      terrain: [
        {
          id: 'ter_water',
          kind: 'deep water',
          description: 'waist-deep, footing treacherous',
          elevation: -1,
          areaId: 'are_ford',
        },
        { id: 'ter_ridge', kind: 'ridge', blocksSight: true, cells: [[12, 15]] },
      ],
    });

    const report = importFresh(stock(away), away, exportStory(session).bytes);
    const copy = openCampaign(away, report.slug);
    const landed = openShelf(away).board('brd_canyon')!;
    expect(landed.areas).toEqual([
      { id: 'are_ford', name: 'the ford', cells: [[5, 15], [6, 15]] },
    ]);
    expect(landed.terrain).toEqual([
      {
        id: 'ter_water',
        kind: 'deep water',
        description: 'waist-deep, footing treacherous',
        elevation: -1,
        areaId: 'are_ford',
      },
      { id: 'ter_ridge', kind: 'ridge', blocksSight: true, cells: [[12, 15]] },
    ]);
    copy.close();
    session.campaign.close();
  });

  it('history comes through this door, and only this one', () => {
    const session = table(dir);
    const report = importFresh(stock(away), away, exportStory(session).bytes);
    const copy = openCampaign(away, report.slug);
    const kinds = copy.events({ limit: 1000 }).map((e) => e.kind);
    expect(kinds).toContain('dice.rolled');
    expect(report.applied.join(' ')).toMatch(/events of history/);
    copy.close();
    session.campaign.close();
  });

  it('the name is the opener`s to choose, and the slug follows it', () => {
    const session = table(dir);
    const report = importFresh(stock(away), away, exportStory(session).bytes, {
      name: 'A Second Table',
    });
    expect(report.slug).toBe('a-second-table');
    const copy = openCampaign(away, report.slug);
    expect(copy.root().name).toBe('A Second Table');
    copy.close();
    session.campaign.close();
  });

  it('imports onto a host missing the pack, and says so instead of failing', () => {
    const session = table(dir);
    const bare = openShelf(away);
    const report = importFresh(bare, away, exportStory(session).bytes);
    expect(report.missing.map((m) => m.slot)).toEqual(['system', 'pack']);
    const copy = openCampaign(away, report.slug);
    // The claim is restored either way: a reference you can't resolve
    // yet is still the truth about what this campaign runs on.
    expect(copy.root().refs?.packs).toEqual([{ id: 'pak_one', name: 'One' }]);
    copy.close();
    session.campaign.close();
  });
});

describe('door (b) — layer onto a running table', () => {
  it('the stored value wins, and the report says what was left alone', () => {
    const session = table(dir);
    const bytes = exportStory(session).bytes;

    // A second table that already has its own Bog Lurker, edited.
    const other = table(away, 'other-table');
    other.campaign.putTemplate(
      'bestiary',
      { id: 'npc_lurker', name: 'Bog Lurker, as we play it' },
      'dm',
    );

    const report = importLayer(other, bytes);
    expect(other.campaign.templateRaw('npc_lurker')).toMatchObject({
      name: 'Bog Lurker, as we play it',
    });
    expect(report.skipped.join(' ')).toMatch(/yours kept/);
    other.campaign.close();
    session.campaign.close();
  });

  it('layering the same story twice adds nothing the second time', () => {
    const session = table(dir);
    const bytes = exportStory(session).bytes;
    const campaign = createCampaign(away, 'twice', 'Twice');
    const other = new Session(openShelf(away), campaign, away);

    importLayer(other, bytes);
    const roster = campaign.children(campaign.root().id).length;
    const again = importLayer(other, bytes);
    expect(campaign.children(campaign.root().id).length).toBe(roster);
    expect(again.applied.join(' ')).not.toMatch(/things in play/);
    expect(again.skipped.join(' ')).toMatch(/already at this table/);
    campaign.close();
    session.campaign.close();
  });

  it('brings across what this table did NOT have', () => {
    const session = table(dir);
    session.campaign.putTemplate('bestiary', { id: 'npc_drover', name: 'Drover' }, 'dm');
    const bytes = exportStory(session).bytes;

    const shelf = openShelf(away);
    const campaign = createCampaign(away, 'empty-table', 'Empty');
    const other = new Session(shelf, campaign, away);
    const report = importLayer(other, bytes);
    expect(campaign.templateRaw('npc_drover')).toMatchObject({ name: 'Drover' });
    expect(campaign.children(campaign.root().id).map((e) => e.name).sort()).toEqual([
      'Barrett',
      'Bog Lurker',
    ]);
    expect(report.applied.join(' ')).toMatch(/things in play/);
    campaign.close();
    session.campaign.close();
  });

  it('history stays with the table that lived it', () => {
    const session = table(dir);
    const bytes = exportStory(session).bytes;
    const shelf = openShelf(away);
    const campaign = createCampaign(away, 'empty-table', 'Empty');
    const other = new Session(shelf, campaign, away);
    const report = importLayer(other, bytes);
    expect(report.skipped.join(' ')).toMatch(/history stays with the table that lived it/);
    expect(campaign.events({ limit: 1000 }).some((e) => e.kind === 'dice.rolled')).toBe(false);
    campaign.close();
    session.campaign.close();
  });

  it('a fight already running is not overruled; an empty table takes the fight', () => {
    const session = table(dir);
    const bytes = exportStory(session).bytes;

    const running = table(away, 'running');
    running.campaign.putTurnState({ order: [], turn: null, round: 9 }, 'dm', { op: 'set' });
    expect(importLayer(running, bytes).skipped.join(' ')).toMatch(/already running/);
    expect(running.campaign.turnState()).toMatchObject({ round: 9 });
    running.campaign.close();

    const quiet = createCampaign(away, 'quiet', 'Quiet');
    const other = new Session(openShelf(away), quiet, away);
    importLayer(other, bytes);
    expect(quiet.turnState()).toMatchObject({ round: 2 });
    quiet.close();
    session.campaign.close();
  });

  it('section switches hold on the way in too', () => {
    const session = table(dir);
    const bytes = exportStory(session).bytes;
    const campaign = createCampaign(away, 'picky', 'Picky');
    const other = new Session(openShelf(away), campaign, away);
    importLayer(other, bytes, { sections: { entities: false, templates: false } });
    expect(campaign.children(campaign.root().id)).toEqual([]);
    expect(campaign.templatesIn('bestiary')).toEqual([]);
    campaign.close();
    session.campaign.close();
  });
});
