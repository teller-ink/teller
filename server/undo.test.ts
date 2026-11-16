// `/undo` — rule 3's payoff, pinned. What's worth holding still is
// that undo is a READER: every case here is "the log already said what
// the before was", and the one that would rot silently is the chain —
// three edits, three undos, each stepping FURTHER back rather than
// fighting the last one.
//
// The templates gate rides along because it is the same law from the
// other side: prep is the Warden's, and an adopted table TV is glass in
// the middle of the room.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';

const KEY = 'test-key-0123456789abcdef';

let dir: string;
let session: Session;
let server: Server;
let base: string;

async function call(
  method: string,
  path: string,
  opts: { key?: boolean; display?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.key) headers['x-teller-key'] = KEY;
  if (opts.display) headers['x-teller-display'] = opts.display;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json() };
}

/** An adopted screen in whatever role — the gate's material. */
async function screen(role: string, params: Record<string, unknown> = {}): Promise<string> {
  const hello = await call('POST', '/api/displays/hello', { body: {} });
  await call('POST', '/api/displays/claim', {
    key: true,
    body: { code: hello.body.display.code },
  });
  await call('PATCH', `/api/displays/${hello.body.display.id}`, {
    key: true,
    body: { role, params },
  });
  return hello.body.display.id;
}

const kinds = async (): Promise<string[]> =>
  (await call('GET', '/api/events', { key: true })).body.map((e: any) => e.kind);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-undo-'));
  const shelf = openShelf(dir);
  shelf.putSystem({ id: 'sys_wiw', name: 'WiW', version: 1, data: {} });
  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  campaign.save(
    { ...campaign.root(), refs: { system: { id: 'sys_wiw', name: 'WiW' } } },
    'host',
  );
  session = new Session(shelf, campaign);
  server = serve(session, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('stepping one mutation back', () => {
  it('restores an edited value, and says what it put back', async () => {
    const hattie = session.create(
      { name: 'Hattie', lists: { resources: [{ name: 'Health', value: 7, max: 7 }] } },
      'console',
    );
    await call('POST', `/api/entities/${hattie.id}/entry`, {
      key: true,
      body: { list: 'resources', name: 'Health', value: 5 },
    });
    expect(session.campaign.get(hattie.id)!.lists.resources[0].value).toBe(5);

    const done = await call('POST', '/api/undo', { key: true, body: {} });
    expect(done.status).toBe(200);
    expect(done.body.undone.kind).toBe('entity.updated');
    expect(done.body.undone.name).toBe('Hattie');
    // Enough for a console to toast "undid: Hattie's Health 5 → 7".
    expect(done.body.undone.changes).toEqual([
      { list: 'resources', name: 'Health', from: 5, to: 7 },
    ]);
    expect(session.campaign.get(hattie.id)!.lists.resources[0].value).toBe(7);

    // The undo is itself a mutation, logged pointing at what it undid.
    const log = (await call('GET', '/api/events', { key: true })).body;
    const revert = log.find((e: any) => e.kind === 'revert');
    expect(revert.payload.reverted).toBe(done.body.undone.event);
    expect(revert.payload.wrote.length).toBeGreaterThan(0);
  });

  it('deletes what a create made', async () => {
    const made = await call('POST', '/api/entities', {
      key: true,
      body: { draft: { name: 'Coyote', lists: {} } },
    });
    expect(session.campaign.get(made.body.id)).toBeDefined();
    const done = await call('POST', '/api/undo', { key: true, body: {} });
    expect(done.body.undone.kind).toBe('entity.created');
    expect(session.campaign.get(made.body.id)).toBeUndefined();
  });

  it('puts a deleted entity back, under the parent it hung on', async () => {
    const posse = session.create({ name: 'The Posse', lists: {} }, 'console');
    const hattie = session.create({ name: 'Hattie', lists: {} }, 'console', posse.id);
    session.remove(hattie.id, 'console');

    await call('POST', '/api/undo', { key: true, body: {} });
    const back = session.campaign.get(hattie.id);
    expect(back?.name).toBe('Hattie');
    // The id is kept — history is keyed by it — and so is the parent.
    expect(session.campaign.parentOf(hattie.id)).toBe(posse.id);
  });

  it('a cascade is one event per row, so one undo restores one row', async () => {
    const posse = session.create({ name: 'The Posse', lists: {} }, 'console');
    const hattie = session.create({ name: 'Hattie', lists: {} }, 'console', posse.id);
    session.remove(posse.id, 'console');
    expect(session.campaign.get(posse.id)).toBeUndefined();
    expect(session.campaign.get(hattie.id)).toBeUndefined();

    // The owner comes back first (its delete was logged last), then the
    // child — and the child lands under the owner again.
    await call('POST', '/api/undo', { key: true, body: {} });
    expect(session.campaign.get(posse.id)).toBeDefined();
    expect(session.campaign.get(hattie.id)).toBeUndefined();
    await call('POST', '/api/undo', { key: true, body: {} });
    expect(session.campaign.parentOf(hattie.id)).toBe(posse.id);
  });

  it('moves a reparented thing back where it was', async () => {
    const hattie = session.create({ name: 'Hattie', lists: {} }, 'console');
    const barrett = session.create({ name: 'Barrett', lists: {} }, 'console');
    const pistol = session.create({ name: 'Pistol', lists: {} }, 'console', hattie.id);
    session.move(pistol.id, barrett.id, 'console');

    const done = await call('POST', '/api/undo', { key: true, body: {} });
    expect(done.body.undone.kind).toBe('entity.moved');
    expect(session.campaign.parentOf(pistol.id)).toBe(hattie.id);
  });

  it('restores the turn order — the accidental "next" mid-fight', async () => {
    const hattie = session.create({ name: 'Hattie', lists: {} }, 'console');
    session.turnOp({ op: 'add', entityId: hattie.id }, 'console');
    session.turnOp({ op: 'add', label: '3 coyotes' }, 'console');
    session.turnOp({ op: 'next' }, 'console');
    session.turnOp({ op: 'next' }, 'console');
    expect(session.turnState().turn).toBe(1);

    const done = await call('POST', '/api/undo', { key: true, body: {} });
    expect(done.body.undone.kind).toBe('turn.updated');
    expect(session.turnState().turn).toBe(0);
    expect(session.turnState().order).toHaveLength(2);
  });

  it('puts an amended template back, and a deleted one back in its slot', async () => {
    const made = await call('POST', '/api/templates/encounters', {
      key: true,
      body: { template: { name: 'Ambush at the Crossing' } },
    });
    await call('POST', '/api/templates/encounters', {
      key: true,
      body: { template: { id: made.body.id, name: 'Ambush at the Ford' } },
    });
    await call('POST', '/api/undo', { key: true, body: {} });
    expect((session.campaign.templateRaw(made.body.id) as any).name).toBe(
      'Ambush at the Crossing',
    );

    await call('DELETE', `/api/templates/encounters/${made.body.id}`, { key: true });
    expect(session.campaign.templateRaw(made.body.id)).toBeUndefined();
    const back = await call('POST', '/api/undo', { key: true, body: {} });
    expect(back.body.undone.kind).toBe('template.deleted');
    expect(session.campaign.templatesIn('encounters')).toHaveLength(1);
  });
});

describe('the walk', () => {
  it('steps further back each time instead of fighting the last undo', async () => {
    const hattie = session.create(
      { name: 'Hattie', lists: { resources: [{ name: 'Health', value: 9, max: 9 }] } },
      'console',
    );
    for (const value of [8, 7, 6]) {
      await call('POST', `/api/entities/${hattie.id}/entry`, {
        key: true,
        body: { list: 'resources', name: 'Health', value },
      });
    }
    const health = () => session.campaign.get(hattie.id)!.lists.resources[0].value;
    expect(health()).toBe(6);

    await call('POST', '/api/undo', { key: true, body: {} });
    expect(health()).toBe(7);
    await call('POST', '/api/undo', { key: true, body: {} });
    expect(health()).toBe(8);
    await call('POST', '/api/undo', { key: true, body: {} });
    expect(health()).toBe(9);
  });

  it('skips the records — a die the table watched land is not undone', async () => {
    const hattie = session.create(
      { name: 'Hattie', lists: { resources: [{ name: 'Health', value: 7 }] } },
      'console',
    );
    await call('POST', `/api/entities/${hattie.id}/entry`, {
      key: true,
      body: { list: 'resources', name: 'Health', value: 5 },
    });
    await call('POST', '/api/rolls', {
      key: true,
      body: { pool: '2d6', faces: [4, 2], total: 6, by: hattie.id },
    });
    expect(await kinds()).toContain('dice.rolled');

    const done = await call('POST', '/api/undo', { key: true, body: {} });
    expect(done.body.undone.kind).toBe('entity.updated');
    expect(session.campaign.get(hattie.id)!.lists.resources[0].value).toBe(7);
    // Still in the history — records are stepped OVER, never erased.
    expect(await kinds()).toContain('dice.rolled');
  });

  it('answers plainly when there is nothing left behind the table', async () => {
    // A minted campaign has exactly one mutation behind it — the
    // manifest's system ref — and its birth is not a step back.
    const first = await call('POST', '/api/undo', { key: true, body: {} });
    expect(first.body.undone.kind).toBe('entity.updated');
    const done = await call('POST', '/api/undo', { key: true, body: {} });
    expect(done.status).toBe(200);
    expect(done.body.undone).toBeNull();
  });

  it('peeks without writing', async () => {
    const hattie = session.create(
      { name: 'Hattie', lists: { resources: [{ name: 'Health', value: 7 }] } },
      'console',
    );
    await call('POST', `/api/entities/${hattie.id}/entry`, {
      key: true,
      body: { list: 'resources', name: 'Health', value: 5 },
    });
    const before = (await kinds()).length;
    const peek = await call('GET', '/api/undo/peek', { key: true });
    expect(peek.body.undoable.kind).toBe('entity.updated');
    expect(peek.body.undoable.name).toBe('Hattie');
    expect((await kinds()).length).toBe(before);
    expect(session.campaign.get(hattie.id)!.lists.resources[0].value).toBe(5);

    // And it named the same row the button would take.
    const done = await call('POST', '/api/undo', { key: true, body: {} });
    expect(done.body.undone.event).toBe(peek.body.undoable.event);
  });

  it('belongs to the DM, not to the table', async () => {
    const table = await screen('table');
    expect((await call('POST', '/api/undo', { display: table, body: {} })).status).toBe(401);
    expect((await call('GET', '/api/undo/peek', { display: table })).status).toBe(401);
  });
});

// Audit 2026-11-16, item 7: undo stepped over a fog change in silence
// and reverted an edit eleven days old; its label was ids; and undoing a
// delete rewound every token on the board. These pin the three answers.
describe('saying what it will do before it does it', () => {
  const lake = () => session.shelf.putBoard({ key: 'map/lake.png', name: 'The Lake' }).id;
  const tokens = (boardId: string) =>
    ((session.campaign.boardState(boardId) as any)?.placements ?? []) as any[];

  it('names who did it and what, in words — a seat by its character', async () => {
    const beau = session.create(
      { name: 'Beau Tillman', lists: { resources: [{ name: 'Health', value: 9, max: 10 }] } },
      'console',
    );
    const seat = await screen('seat', { entityId: beau.id });
    await call('POST', `/api/entities/${beau.id}/entry`, {
      display: seat,
      body: { list: 'resources', name: 'Health', value: 10 },
    });

    const peek = (await call('GET', '/api/undo/peek', { key: true })).body.undoable;
    expect(peek.who).toBe("Beau Tillman's seat");
    expect(peek.what).toBe('Beau Tillman — Health 9 → 10');
    expect(peek.ago).toBe('just now');
    expect(peek.skipped).toBeUndefined();
    expect(JSON.stringify([peek.who, peek.what])).not.toContain('ent_');
  });

  it('names a deletion by the thing, not the id', async () => {
    const watcher = session.create({ name: 'Bark Watcher 2', lists: {} }, 'console');
    session.remove(watcher.id, 'console');
    const peek = (await call('GET', '/api/undo/peek', { key: true })).body.undoable;
    expect(peek.who).toBe('the console');
    expect(peek.what).toBe('deleted Bark Watcher 2');
  });

  it('reports a newer board write it cannot undo, rather than passing it in silence', async () => {
    const board = lake();
    const beau = session.create(
      { name: 'Beau Tillman', lists: { resources: [{ name: 'Health', value: 9 }] } },
      'console',
    );
    await call('POST', `/api/entities/${beau.id}/entry`, {
      key: true,
      body: { list: 'resources', name: 'Health', value: 6 },
    });
    // A token down, then moved, then fog — three board writes, newest last.
    await call('PUT', `/api/board-state/${board}`, {
      key: true,
      body: { data: { placements: [{ id: 'plc_b', entityId: beau.id, u: 1, v: 1 }] } },
    });
    await call('PUT', `/api/board-state/${board}`, {
      key: true,
      body: { data: { placements: [{ id: 'plc_b', entityId: beau.id, u: 3, v: 1 }] } },
    });
    await call('PUT', `/api/board-state/${board}`, {
      key: true,
      body: {
        data: { placements: [{ id: 'plc_b', entityId: beau.id, u: 3, v: 1 }], fog: { dark: [1] } },
      },
    });

    const peek = (await call('GET', '/api/undo/peek', { key: true })).body.undoable;
    // The thing undo would take is still the Health edit — board writes
    // stay un-undoable — but it says, by name, what it reaches past.
    expect(peek.what).toBe('Beau Tillman — Health 9 → 6');
    expect(peek.skipped.count).toBe(3);
    expect(peek.skipped.what).toEqual([
      'fog, tokens or zones on The Lake ×2',
      'moved Beau Tillman on The Lake',
    ]);

    // The press says the same, and the board is exactly where it was.
    const done = await call('POST', '/api/undo', { key: true, body: { expect: peek.event } });
    expect(done.body.undone.skipped.count).toBe(3);
    expect(tokens(board)[0].u).toBe(3);
    expect((session.campaign.boardState(board) as any).fog).toEqual({ dark: [1] });
  });

  it('re-reads instead of undoing something the button was not showing', async () => {
    const beau = session.create(
      { name: 'Beau Tillman', lists: { resources: [{ name: 'Health', value: 9 }] } },
      'console',
    );
    await call('POST', `/api/entities/${beau.id}/entry`, {
      key: true,
      body: { list: 'resources', name: 'Health', value: 8 },
    });
    const shown = (await call('GET', '/api/undo/peek', { key: true })).body.undoable;
    // A seat writes between the peek and the press.
    const seat = await screen('seat', { entityId: beau.id });
    await call('POST', `/api/entities/${beau.id}/entry`, {
      display: seat,
      body: { list: 'resources', name: 'Health', value: 7 },
    });

    const stale = await call('POST', '/api/undo', { key: true, body: { expect: shown.event } });
    expect(stale.status).toBe(200);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.undoable.who).toBe("Beau Tillman's seat");
    expect(session.campaign.get(beau.id)!.lists.resources[0].value).toBe(7);

    // And the next press, now reading the fresh step, goes ahead.
    const done = await call('POST', '/api/undo', {
      key: true,
      body: { expect: stale.body.undoable.event },
    });
    expect(done.body.undone.who).toBe("Beau Tillman's seat");
    expect(session.campaign.get(beau.id)!.lists.resources[0].value).toBe(8);
  });

  it('undoing a delete puts its token back and leaves later moves and fog alone', async () => {
    const board = lake();
    const foeA = session.create({ name: 'Foe A', lists: {} }, 'console');
    const foeB = session.create({ name: 'Foe B', lists: {} }, 'console');
    const beau = session.create({ name: 'Beau Tillman', lists: {} }, 'console');
    session.putBoardState(
      board,
      {
        placements: [
          { id: 'plc_a', entityId: foeA.id, u: 1, v: 1 },
          { id: 'plc_b', entityId: foeB.id, u: 2, v: 2 },
          { id: 'plc_beau', entityId: beau.id, u: 3, v: 3 },
        ],
        fog: { dark: [1, 2, 3] },
      },
      'console',
    );
    session.turnOp({ op: 'add', entityId: foeA.id }, 'console');
    session.turnOp({ op: 'add', entityId: foeB.id }, 'console');
    session.turnOp({ op: 'add', entityId: beau.id }, 'console');
    session.turnOp({ op: 'next' }, 'console');

    session.remove(foeA.id, 'console');
    // The fight goes on: Foe B and Beau move, the fog lifts, a turn passes.
    session.putBoardState(
      board,
      {
        placements: [
          { id: 'plc_b', entityId: foeB.id, u: 5, v: 5 },
          { id: 'plc_beau', entityId: beau.id, u: 6, v: 6 },
        ],
        fog: { dark: [] },
      },
      'console',
    );
    // A turn passes too, written the way an older build wrote it — a
    // bare op with no before, so it is stepped over like the board and
    // the order undo finds is NOT the one the delete left behind.
    const passed = session.turnState();
    session.campaign.putTurnState({ ...passed, turn: 1 }, 'console', 'next');
    expect(session.turnState().order[1].entityId).toBe(beau.id);

    const peek = (await call('GET', '/api/undo/peek', { key: true })).body.undoable;
    expect(peek.what).toBe('deleted Foe A');
    expect(peek.skipped.what).toEqual([
      'a turn order change',
      'moved Foe B, Beau Tillman on The Lake',
    ]);
    expect(peek.also).toBeUndefined();
    await call('POST', '/api/undo', { key: true, body: { expect: peek.event } });

    expect(session.campaign.get(foeA.id)?.name).toBe('Foe A');
    const at = Object.fromEntries(tokens(board).map((p) => [p.entityId, [p.u, p.v]]));
    expect(at).toEqual({ [foeA.id]: [1, 1], [foeB.id]: [5, 5], [beau.id]: [6, 6] });
    expect((session.campaign.boardState(board) as any).fog).toEqual({ dark: [] });
    // Foe A is back in its old slot, and it is still Beau's turn.
    const turn = session.turnState();
    expect(turn.order.map((e) => e.entityId)).toEqual([foeA.id, foeB.id, beau.id]);
    expect(turn.order[turn.turn!].entityId).toBe(beau.id);
  });

  it('undoing a sweep brings the fight back without rewinding the board since', async () => {
    const board = lake();
    const root = session.campaign.root();
    session.save({ ...root, refs: { ...root.refs, board: { id: board, name: 'The Lake' } } }, 'host');
    const foe = session.create({ name: 'Coyote', lists: {} }, 'console');
    const pc = session.create({ name: 'Hattie', type: 'pc', lists: {} } as any, 'console');
    session.putBoardState(
      board,
      {
        placements: [
          { id: 'plc_c', entityId: foe.id, u: 1, v: 1 },
          { id: 'plc_h', entityId: pc.id, u: 2, v: 2 },
        ],
      },
      'console',
    );
    session.clearTable('console');
    expect(session.campaign.get(foe.id)).toBeUndefined();
    expect(session.campaign.get(pc.id)).toBeDefined();
    session.putBoardState(
      board,
      { placements: [{ id: 'plc_h', entityId: pc.id, u: 9, v: 9 }], fog: { dark: [4] } },
      'console',
    );

    await call('POST', '/api/undo', { key: true, body: {} });
    const at = Object.fromEntries(tokens(board).map((p) => [p.entityId, [p.u, p.v]]));
    expect(at[foe.id]).toEqual([1, 1]);
    expect(at[pc.id]).toEqual([9, 9]);
    expect((session.campaign.boardState(board) as any).fog).toEqual({ dark: [4] });
  });
});

describe('prep is the Warden\'s, and a seat shops', () => {
  it('lets the DM and a seat read templates, and refuses passive glass', async () => {
    await call('POST', '/api/templates/encounters', {
      key: true,
      body: { template: { name: 'Ambush at the Crossing' } },
    });
    const hattie = session.create({ name: 'Hattie', lists: {} }, 'console');
    const seat = await screen('seat', { entityId: hattie.id });
    const table = await screen('table');

    expect((await call('GET', '/api/templates/encounters', { key: true })).status).toBe(200);
    expect((await call('GET', '/api/templates/encounters', { display: seat })).status).toBe(200);
    expect((await call('GET', '/api/templates/encounters', { display: table })).status).toBe(401);

    // The merged stack's template half takes the same gate...
    expect((await call('GET', '/api/stack/templates/bestiary', { display: seat })).status).toBe(200);
    expect((await call('GET', '/api/stack/templates/bestiary', { display: table })).status).toBe(401);
    // ...while vocabulary and records stay watchable, because that is
    // what a passive panel renders with.
    expect(
      (await call('GET', '/api/stack/declarations/panels', { display: table })).status,
    ).toBe(200);
    expect((await call('GET', '/api/stack/record/dice', { display: table })).status).toBe(200);
  });
});
