// Deploying a fight, pinned — the three things that were wrong at a
// real table on 2026-08-21.
//
// A deploy is a RESET: press it twice and the table holds one
// generation, not two (Brian found four). It is ONE action in the log,
// so one undo puts the previous generation back — foes, order and
// board together, the delete cascade's law applied to a bigger action.
// And a foe this host can't stamp is REPORTED BY NAME, because "you
// don't have this" beats a fight that quietly deploys half-empty
// (rule 9).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { Session } from './session.ts';
import { peekUndo, undo } from './undo.ts';

let dir: string;
let session: Session;

/** The fight, as prep — two watchers at the ford, one lurker in the reeds. */
const stageFight = (foes: unknown[]): string => {
  const id = 'enc_lake';
  session.campaign.putTemplate('encounters', { id, name: 'The Lake', foes }, 'console');
  return id;
};

/** A board on the shelf, with the table looking at it. */
const stageBoard = (): string => {
  const board = session.shelf.putBoard({ key: 'map/lake.png', name: 'The Lake' });
  const root = session.campaign.root();
  session.campaign.save(
    { ...root, refs: { ...root.refs, board: { id: board.id, name: 'The Lake' } } },
    'host',
  );
  session.reload();
  return board.id;
};

const placements = (boardId: string): string[] =>
  ((session.campaign.boardState(boardId) as any)?.placements ?? []).map(
    (p: any) => p.entityId,
  );

/**
 * Every promoted entity under the manifest, by name — the roster.
 * Sorted, because a deploy inside one second is ordered by minted id
 * and this is a test about WHO is on the table, not about arrival.
 */
const roster = (): string[] =>
  session.campaign
    .children(session.campaign.root().id)
    .map((e) => e.name)
    .sort();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-deploy-'));
  const shelf = openShelf(dir);
  shelf.putSystem({ id: 'sys_wiw', name: 'WiW', version: 1, data: {} });
  shelf.putPack({
    id: 'pak_guide',
    system: 'sys_wiw',
    name: 'Guidebook',
    data: {
      bestiary: [
        {
          id: 'npc_watcher',
          name: 'Bark Watcher',
          type: 'foe',
          lists: { resources: [{ name: 'Health', value: 12, max: 12 }] },
        },
      ],
    },
  });
  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  campaign.save(
    { ...campaign.root(), refs: { system: { id: 'sys_wiw', name: 'WiW' } } },
    'host',
  );
  session = new Session(shelf, campaign);
});

afterEach(() => {
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('deploying is a reset, not an append', () => {
  it('four presses leave one generation of the same four foes', () => {
    const fight = stageFight([{ templateId: 'npc_watcher', count: 4 }]);
    let last: string[] = [];
    for (let press = 1; press <= 4; press += 1) {
      const out = session.deployEncounter(fight, 'console')!;
      expect(out.deployed).toHaveLength(4);
      expect(out.cleared).toBe(press === 1 ? 0 : 4);
      expect(session.turnState().order).toHaveLength(4);
      expect(roster()).toEqual([
        'Bark Watcher 1',
        'Bark Watcher 2',
        'Bark Watcher 3',
        'Bark Watcher 4',
      ]);
      // Fresh instances every time — the recipe never spent itself.
      const ids = out.deployed.map((e) => e.id);
      expect(ids).not.toEqual(last);
      expect(session.turnState().order.map((e) => e.entityId)).toEqual(ids);
      last = ids;
    }
  });

  it('takes the last generation off the board too', () => {
    const boardId = stageBoard();
    const fight = stageFight([
      { templateId: 'npc_watcher', count: 2, u: 0.2, v: 0.3 },
      { templateId: 'npc_watcher', name: 'Lurker', u: 0.8, v: 0.6, hidden: true },
    ]);
    session.deployEncounter(fight, 'console');
    const again = session.deployEncounter(fight, 'console')!;
    expect(placements(boardId)).toEqual(again.deployed.map((e) => e.id));
  });

  it('clears a foe the DM edited since — that is what starting again means', () => {
    const fight = stageFight([{ templateId: 'npc_watcher' }]);
    const first = session.deployEncounter(fight, 'console')!;
    session.writeEntry(
      first.deployed[0].id,
      { list: 'resources', name: 'Health', value: 3 },
      'console',
    );
    const again = session.deployEncounter(fight, 'console')!;
    expect(again.cleared).toBe(1);
    expect(session.campaign.get(first.deployed[0].id)).toBeUndefined();
    // The wounded one's story stays in the log, where a story belongs.
    const kinds = session.campaign.events({ limit: 50 }).map((e) => e.kind);
    expect(kinds).toContain('entity.updated');
  });

  it("leaves another fight's foes, and anything nobody deployed, alone", () => {
    const lake = stageFight([{ templateId: 'npc_watcher' }]);
    session.campaign.putTemplate(
      'encounters',
      { id: 'enc_ridge', name: 'The Ridge', foes: [{ templateId: 'npc_watcher' }] },
      'console',
    );
    const hattie = session.create({ name: 'Hattie', lists: {} }, 'console');
    const ridge = session.deployEncounter('enc_ridge', 'console')!;
    session.deployEncounter(lake, 'console');
    session.deployEncounter(lake, 'console');
    expect(session.campaign.get(ridge.deployed[0].id)).toBeDefined();
    expect(session.campaign.get(hattie.id)).toBeDefined();
    expect(session.turnState().order).toHaveLength(2);
  });
});

describe('one press peels the generation back', () => {
  it('undo restores the previous generation, its order and its board', () => {
    const boardId = stageBoard();
    const fight = stageFight([{ templateId: 'npc_watcher', count: 2, u: 0.2, v: 0.3 }]);
    const first = session.deployEncounter(fight, 'console')!;
    session.writeEntry(
      first.deployed[0].id,
      { list: 'resources', name: 'Health', value: 4 },
      'console',
    );
    const wounded = session.campaign.get(first.deployed[0].id)!;
    session.deployEncounter(fight, 'console');

    expect(peekUndo(session)).toMatchObject({ kind: 'encounter.deployed', name: 'The Lake' });
    const undone = undo(session, 'console')!;
    expect(undone.kind).toBe('encounter.deployed');

    // The generation before, whole: the same ids, the same stored
    // values, the same rows in the order, the same tokens on the map.
    expect(session.campaign.get(wounded.id)).toEqual(wounded);
    expect(session.turnState().order.map((e) => e.entityId)).toEqual(
      first.deployed.map((e) => e.id),
    );
    expect(placements(boardId)).toEqual(first.deployed.map((e) => e.id));
  });

  it('the press after steps further back, not around in a circle', () => {
    const fight = stageFight([{ templateId: 'npc_watcher' }]);
    session.deployEncounter(fight, 'console');
    session.deployEncounter(fight, 'console');
    undo(session, 'console');
    // Back to one generation; the next press peels the FIRST deploy,
    // leaving the table as it was before anyone fought.
    expect(session.campaign.children(session.campaign.root().id)).toHaveLength(1);
    const back = undo(session, 'console');
    expect(back?.kind).toBe('encounter.deployed');
    expect(session.campaign.children(session.campaign.root().id)).toHaveLength(0);
    expect(session.turnState().order).toHaveLength(0);
  });
});

describe('a foe this host has not got', () => {
  it('is named in the result rather than counted short', () => {
    const fight = stageFight([
      { templateId: 'npc_watcher', count: 2 },
      { templateId: 'npc_moss', name: 'Lurking Moss' },
      { templateId: 'npc_ghost' },
    ]);
    const out = session.deployEncounter(fight, 'console')!;
    expect(out.deployed).toHaveLength(2);
    expect(out.missing).toEqual([
      { templateId: 'npc_moss', name: 'Lurking Moss' },
      { templateId: 'npc_ghost' },
    ]);
  });

  it('says nothing when every foe is on this host', () => {
    const fight = stageFight([{ templateId: 'npc_watcher' }]);
    expect(session.deployEncounter(fight, 'console')!.missing).toEqual([]);
  });
});
