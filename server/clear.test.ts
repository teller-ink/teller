// Clearing the table (TEL-111) — "the fight is over" as one press.
//
// The tests are written as the rule reads: who goes is asked with the
// REDACTOR'S question and nobody else's, so what a passive screen was
// hiding numbers for is exactly what a sweep takes off the table. The
// posse stays, the store stays, a half-made character stays, and one
// undo puts the whole fight back — minis, order and all.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRAFT_LIST, DRAFT_MARK, type Entity, type Entry } from '../core/entity.ts';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';
import { peekUndo, undo } from './undo.ts';

const KEY = 'test-key-0123456789abcdef';

let dir: string;
let session: Session;
let boardId: string;

const roster = (): string[] =>
  session.campaign
    .children(session.campaign.root().id)
    .map((e) => e.name)
    .sort();

const placements = (): string[] =>
  ((session.campaign.boardState(boardId) as { placements?: { entityId?: string }[] })
    ?.placements ?? []
  ).map((p) => p.entityId ?? '');

/** Somebody at the table, and a mini for them on the live board. */
const stand = (entity: {
  name: string;
  type?: string;
  lists?: Record<string, Entry[]>;
}): Entity => {
  const made = session.create({ lists: {}, ...entity }, 'console');
  const state = (session.campaign.boardState(boardId) ?? {}) as {
    placements?: unknown[];
  };
  session.putBoardState(
    boardId,
    {
      ...state,
      placements: [
        ...(state.placements ?? []),
        { id: `plc_${made.id}`, entityId: made.id, u: 0.5, v: 0.5 },
      ],
    },
    'console',
  );
  session.turnOp({ op: 'add', entityId: made.id }, 'console');
  return made;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-clear-'));
  const shelf = openShelf(dir);
  shelf.putSystem({
    id: 'sys_test',
    name: 'Testing',
    version: 1,
    // The trades: the same declaration `isParty` reads, because there
    // is only one answer to who the fight was.
    data: { trades: [{ name: 'Marshal' }, { name: 'Trapper' }] },
  });
  const board = shelf.putBoard({ key: 'maps/crossing.png', name: 'The Crossing' });
  boardId = board.id;
  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  campaign.save(
    {
      ...campaign.root(),
      refs: {
        system: { id: 'sys_test', name: 'Testing' },
        board: { id: board.id, name: 'The Crossing' },
      },
    },
    'host',
  );
  session = new Session(shelf, campaign, dir);
  session.reload();
});

afterEach(() => {
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('one press sweeps the fight off the table', () => {
  it('takes every foe, its mini and the whole order — and reports what went', () => {
    const barrett = stand({ name: 'Barrett', type: 'Marshal' });
    stand({ name: 'Watcher', type: 'foe' });
    stand({ name: 'Lurker', type: 'foe' });
    // A word nobody recognises is a foe, exactly as the redactor reads
    // it — the fail-closed side rule, applied to the sweep.
    stand({ name: 'The Thing', type: 'whatever' });

    const out = session.clearTable('console');
    expect(out).toEqual({ cleared: 3, tokens: 3, order: 4 });
    expect(roster()).toEqual(['Barrett']);
    expect(placements()).toEqual([barrett.id]);
    // The order goes WHOLE — the posse's rows with it. Empty is the
    // between-fights state, and the round starts again at one.
    expect(session.turnState()).toEqual({ order: [], turn: null, round: 1 });
  });

  it('leaves the posse, the store and anyone half-made alone', () => {
    stand({ name: 'Barrett', type: 'Marshal' });
    stand({ name: 'Sil', type: 'trapper' });
    stand({ name: 'The Emporium', type: 'vendor' });
    stand({
      name: 'Nobody Yet',
      type: 'foe',
      lists: { [DRAFT_LIST]: [{ name: DRAFT_MARK, value: 1 }] },
    });
    stand({ name: 'Watcher', type: 'foe' });

    const out = session.clearTable('console');
    expect(out.cleared).toBe(1);
    expect(roster()).toEqual(['Barrett', 'Nobody Yet', 'Sil', 'The Emporium']);
  });

  it('never reaches under a character for what they carry', () => {
    const barrett = stand({ name: 'Barrett', type: 'Marshal' });
    // A pistol is an entity, promoted under its owner, wearing no
    // party word of its own — and a walk that recursed would sweep it
    // out from under him.
    session.create({ name: 'Peacemaker', type: 'item', lists: {} }, 'console', barrett.id);

    session.clearTable('console');
    expect(session.campaign.children(barrett.id).map((e) => e.name)).toEqual(['Peacemaker']);
  });

  it('takes a foe’s own children with it, the way a deletion does', () => {
    const watcher = stand({ name: 'Watcher', type: 'foe' });
    const knife = session.create(
      { name: 'Bone Knife', type: 'item', lists: {} },
      'console',
      watcher.id,
    );

    const out = session.clearTable('console');
    // Counted as the one thing the Warden swept, not as two.
    expect(out.cleared).toBe(1);
    expect(session.campaign.get(knife.id)).toBeUndefined();
  });

  it('an empty table is a plain answer, not a fault', () => {
    expect(session.clearTable('console')).toEqual({ cleared: 0, tokens: 0, order: 0 });
  });
});

describe('POST /api/table/clear', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = serve(session, 0, KEY);
    await new Promise((r) => server.on('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    server.close();
  });

  const post = async (key: boolean) =>
    fetch(`${base}/api/table/clear`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'x-teller-key': KEY } : {}),
      },
      body: JSON.stringify({ actor: 'console' }),
    });

  it('is the DM’s door and nobody else’s', async () => {
    stand({ name: 'Watcher', type: 'foe' });
    const denied = await post(false);
    expect(denied.status).toBe(401);
    expect(roster()).toEqual(['Watcher']);
  });

  it('answers with what it took', async () => {
    stand({ name: 'Barrett', type: 'Marshal' });
    stand({ name: 'Watcher', type: 'foe' });
    const res = await post(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: 1, tokens: 1, order: 2 });
  });
});

describe('one press back', () => {
  it('undo puts the fight, its minis and the order back in one press', () => {
    const barrett = stand({ name: 'Barrett', type: 'Marshal' });
    const watcher = stand({ name: 'Watcher', type: 'foe' });
    const lurker = stand({ name: 'Lurker', type: 'foe' });
    session.turnOp({ op: 'next' }, 'console');
    const before = session.turnState();

    session.clearTable('console');
    expect(peekUndo(session)?.kind).toBe('table.cleared');

    undo(session, 'console');
    expect(roster()).toEqual(['Barrett', 'Lurker', 'Watcher']);
    expect(session.campaign.get(watcher.id)?.name).toBe('Watcher');
    expect(placements()).toEqual([barrett.id, watcher.id, lurker.id]);
    expect(session.turnState()).toEqual(before);
  });

  it('the press after the undo steps past the sweep, it does not re-undo it', () => {
    stand({ name: 'Watcher', type: 'foe' });
    session.clearTable('console');
    undo(session, 'console');
    // Whatever comes next, it is not this sweep again — the cascade's
    // rows are claimed, so the walk keeps stepping backwards.
    expect(peekUndo(session)?.kind).not.toBe('table.cleared');
    expect(roster()).toEqual(['Watcher']);
  });
});
