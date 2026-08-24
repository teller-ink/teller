// Rule 5's port: the op machine headless, then the runner over HTTP —
// author a fight as prep, deploy it, roll into an order, walk it.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';
import { applyTurnOp, toTurnState, EMPTY_TURN, type TurnState } from './turn.ts';

describe('the op machine', () => {
  const three = (): TurnState =>
    toTurnState({
      order: [
        { id: 't1', label: 'Barrett' },
        { id: 't2', label: 'Sal' },
        { id: 't3', label: 'Watcher' },
      ],
      turn: null,
      round: 1,
    });

  it('next walks the list and wraps into a new round', () => {
    let s = three();
    s = applyTurnOp(s, { op: 'next' });
    expect([s.turn, s.round]).toEqual([0, 1]);
    s = applyTurnOp(s, { op: 'next' });
    s = applyTurnOp(s, { op: 'next' });
    s = applyTurnOp(s, { op: 'next' });
    expect([s.turn, s.round]).toEqual([0, 2]);
    s = applyTurnOp(s, { op: 'prev' });
    expect([s.turn, s.round]).toEqual([2, 1]);
    s = applyTurnOp(s, { op: 'end' });
    expect([s.turn, s.round]).toEqual([null, 1]);
  });

  it('scores sort as they arrive; the unrolled sink and keep their order', () => {
    let s = applyTurnOp(three(), { op: 'rolling', on: true });
    expect(s.order.every((e) => e.score === null)).toBe(true);
    s = applyTurnOp(s, { op: 'score', entryId: 't3', score: 4 });
    expect(s.order.map((e) => e.id)).toEqual(['t3', 't1', 't2']);
    s = applyTurnOp(s, { op: 'score', entryId: 't1', score: 6 });
    expect(s.order.map((e) => e.id)).toEqual(['t1', 't3', 't2']);
    // A genuine 0 still outranks "hasn't rolled".
    s = applyTurnOp(s, { op: 'score', entryId: 't2', score: 0 });
    expect(s.order.map((e) => e.id)).toEqual(['t1', 't3', 't2']);
  });

  it('remove keeps the pointer on whoever was acting', () => {
    let s = three();
    s = applyTurnOp(s, { op: 'next' });
    s = applyTurnOp(s, { op: 'next' }); // Sal's turn (index 1)
    s = applyTurnOp(s, { op: 'remove', entryId: 't1' });
    expect(s.order.map((e) => e.id)).toEqual(['t2', 't3']);
    expect(s.turn).toBe(0); // still Sal
  });

  it('a rearrangement follows the acting row, wherever it lands', () => {
    let s = three();
    s = applyTurnOp(s, { op: 'next' });
    s = applyTurnOp(s, { op: 'next' }); // Sal is up (index 1)
    // Drag the Watcher to the top — straight across the pointer.
    const [t1, t2, t3] = s.order;
    s = applyTurnOp(s, { op: 'set', order: [t3, t1, t2] });
    expect(s.order.map((e) => e.id)).toEqual(['t3', 't1', 't2']);
    expect(s.turn).toBe(2); // still Sal
    // And back the other way: Sal to the front.
    s = applyTurnOp(s, { op: 'set', order: [t2, t3, t1] });
    expect(s.turn).toBe(0); // still Sal
  });

  it('a set that drops the acting row falls back the way remove does', () => {
    let s = three();
    s = applyTurnOp(s, { op: 'next' });
    s = applyTurnOp(s, { op: 'next' }); // Sal is up (index 1)
    const [t1, , t3] = s.order;
    s = applyTurnOp(s, { op: 'set', order: [t1, t3] });
    expect(s.turn).toBe(1); // whoever slid into Sal's slot
    // Off the end, and then empty.
    s = applyTurnOp(s, { op: 'set', order: [t1] });
    expect(s.turn).toBe(0);
    s = applyTurnOp(s, { op: 'set', order: [] });
    expect(s.turn).toBe(null);
  });

  it('reads anything forgivingly and clamps a stale pointer', () => {
    expect(toTurnState(undefined)).toEqual(EMPTY_TURN);
    expect(toTurnState({ order: [{ label: 'x' }], turn: 9, round: 0 })).toMatchObject({
      turn: null,
      round: 1,
    });
    // A row with neither link nor label is nothing to act on — dropped.
    expect(toTurnState({ order: [{ id: 'z' }] }).order).toEqual([]);
  });
});

describe('the runner over HTTP', () => {
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

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'teller-turn-'));
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
    server = serve(session, 0, KEY);
    await new Promise((r) => server.on('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    session.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('an encounter is prep: authored once, deployed as numbered thin stamps', async () => {
    const made = await call('POST', '/api/templates/encounters', {
      key: true,
      body: {
        template: {
          name: 'Ambush at the Crossing',
          foes: [{ templateId: 'npc_watcher', count: 2 }],
        },
      },
    });
    expect(made.status).toBe(201);

    const run = await call('POST', `/api/encounters/${made.body.id}/deploy`, {
      key: true,
      body: {},
    });
    expect(run.status).toBe(200);
    expect(run.body.deployed.map((e: any) => e.name)).toEqual([
      'Bark Watcher 1',
      'Bark Watcher 2',
    ]);
    // Thin: the recipe stays pristine, the instances store nothing yet.
    expect(run.body.deployed[0].lists).toEqual({});
    expect(run.body.turn.order).toHaveLength(2);
    expect(run.body.turn.order[0].entityId).toBe(run.body.deployed[0].id);

    // Deploy again for another posse: the recipe never spent itself.
    const again = await call('POST', `/api/encounters/${made.body.id}/deploy`, {
      key: true,
      body: {},
    });
    expect(again.body.deployed).toHaveLength(2);
    expect(again.body.turn.order).toHaveLength(4);
  });

  it('a seat scores its own row and drives nothing else', async () => {
    const barrett = session.create({ name: 'Barrett', lists: {} }, 'console');
    let turn = session.turnOp({ op: 'add', entityId: barrett.id }, 'console');
    turn = session.turnOp({ op: 'add', label: '3 coyotes' }, 'console');
    session.turnOp({ op: 'rolling', on: true }, 'console');

    // Pair a seat onto Barrett.
    const hello = await call('POST', '/api/displays/hello', { body: {} });
    await call('POST', '/api/displays/claim', {
      key: true,
      body: { code: hello.body.display.code },
    });
    await call('PATCH', `/api/displays/${hello.body.display.id}`, {
      key: true,
      body: { role: 'seat', params: { entityId: barrett.id } },
    });
    const seat = hello.body.display.id;

    const mine = turn.order.find((e) => e.entityId === barrett.id)!;
    const coyotes = turn.order.find((e) => e.label === '3 coyotes')!;

    const ok = await call('POST', '/api/turn', {
      display: seat,
      body: { op: 'score', entryId: mine.id, score: 5 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.order[0].entityId).toBe(barrett.id);

    // Not my row, not my op.
    expect(
      (
        await call('POST', '/api/turn', {
          display: seat,
          body: { op: 'score', entryId: coyotes.id, score: 9 },
        })
      ).status,
    ).toBe(401);
    expect(
      (await call('POST', '/api/turn', { display: seat, body: { op: 'next' } })).status,
    ).toBe(401);

    // And every op landed in the log (rule 3 — which the old DO skipped).
    const events = await call('GET', '/api/events', { key: true });
    expect(
      events.body.filter((e: any) => e.kind === 'turn.updated').length,
    ).toBeGreaterThanOrEqual(4);
  });

  // -- the fight ON the map -------------------------------------------
  //
  // A fight staged on a board writes down where everyone starts, and
  // deploying used to throw that away: the order filled up and the map
  // stayed empty, which reads at the table as "the deploy didn't work".

  /** A board on the shelf, with the table looking at it. */
  const stage = (name = 'The Lake'): string => {
    const board = session.shelf.putBoard({ key: 'map/lake.png', name });
    const root = session.campaign.root();
    session.campaign.save(
      { ...root, refs: { ...root.refs, board: { id: board.id, name } } },
      'host',
    );
    return board.id;
  };

  /** Two watchers at the ford and one waiting in the reeds. */
  const stagedFight = async (): Promise<string> =>
    (
      await call('POST', '/api/templates/encounters', {
        key: true,
        body: {
          template: {
            name: 'The Lake',
            foes: [
              { templateId: 'npc_watcher', count: 2, u: 0.2, v: 0.3 },
              { templateId: 'npc_watcher', name: 'Lurker', u: 0.8, v: 0.6, hidden: true },
            ],
          },
        },
      })
    ).body.id;

  it('a staged fight arrives on the board it was staged for', async () => {
    const boardId = stage();
    const encounter = await stagedFight();
    const run = await call('POST', `/api/encounters/${encounter}/deploy`, {
      key: true,
      body: {},
    });
    expect(run.body.board).toBe(boardId);
    expect(run.body.placed).toBe(3);
    expect(run.body.unplaced).toBeUndefined();

    const state = session.campaign.boardState(boardId) as any;
    expect(state.placements.map((p: any) => p.entityId)).toEqual(
      run.body.deployed.map((e: any) => e.id),
    );
    expect(state.placements[0]).toMatchObject({ u: 0.2, v: 0.3, sizeInches: 1 });
    // Hidden is the recipe's word, carried to the token — the one in
    // the reeds is behind the screen, the two at the ford are not.
    expect(state.placements.map((p: any) => p.hidden)).toEqual([false, false, true]);

    // Run it again for another posse: new foes, new tokens, and nobody
    // standing twice.
    const again = await call('POST', `/api/encounters/${encounter}/deploy`, {
      key: true,
      body: {},
    });
    expect(again.body.placed).toBe(3);
    const after = session.campaign.boardState(boardId) as any;
    const ids = after.placements.map((p: any) => p.entityId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('a staged fight with no board up says so out loud', async () => {
    const encounter = await stagedFight();
    const run = await call('POST', `/api/encounters/${encounter}/deploy`, {
      key: true,
      body: {},
    });
    expect(run.body.deployed).toHaveLength(3);
    expect(run.body.board).toBeNull();
    expect(run.body.placed).toBe(0);
    // Loud absence: the count that came up short is IN the answer.
    expect(run.body.unplaced).toContain('no active board');
    expect(session.campaign.boardStates()).toHaveLength(0);
  });

  it('deleting a foe takes its row and its tokens with it', async () => {
    const boardId = stage();
    const encounter = await stagedFight();
    const run = await call('POST', `/api/encounters/${encounter}/deploy`, {
      key: true,
      body: {},
    });
    const [first, , lurker] = run.body.deployed;

    // A board this campaign played on last week, still holding the same
    // foe and a rock nobody ever deletes.
    const other = session.shelf.putBoard({ key: 'map/saloon.png', name: 'The Saloon' }).id;
    session.campaign.putBoardState(
      other,
      {
        placements: [
          { id: 'plc_x', entityId: lurker.id, u: 0.1, v: 0.1 },
          { id: 'plc_rock', label: 'a boulder', u: 0.9, v: 0.9 },
        ],
      },
      'console',
    );

    // Walk to the lurker — the last row — then delete it. The acting
    // pointer falls back the way `remove` does: off the end is nobody's
    // turn but the first row's.
    await call('POST', '/api/turn', { key: true, body: { op: 'next' } });
    await call('POST', '/api/turn', { key: true, body: { op: 'next' } });
    await call('POST', '/api/turn', { key: true, body: { op: 'next' } });
    expect((await call('GET', '/api/turn', { key: true })).body.turn).toBe(2);

    const del = await call('DELETE', `/api/entities/${lurker.id}`, { key: true });
    expect(del.status).toBe(200);

    const turn = (await call('GET', '/api/turn', { key: true })).body;
    expect(turn.order).toHaveLength(2);
    expect(turn.order.every((e: any) => e.entityId !== lurker.id)).toBe(true);
    expect(turn.turn).toBe(0);

    const state = session.campaign.boardState(boardId) as any;
    expect(state.placements.map((p: any) => p.entityId)).not.toContain(lurker.id);
    expect(state.placements).toHaveLength(2);
    expect(state.placements[0].entityId).toBe(first.id);

    // Every board, not just the one the table is looking at — and the
    // boulder is nobody's foe.
    const elsewhere = session.campaign.boardState(other) as any;
    expect(elsewhere.placements.map((p: any) => p.id)).toEqual(['plc_rock']);
  });

  it('and one undo puts the foe back with its place at the table', async () => {
    const boardId = stage();
    const encounter = await stagedFight();
    const run = await call('POST', `/api/encounters/${encounter}/deploy`, {
      key: true,
      body: {},
    });
    const lurker = run.body.deployed[2];
    const entryId = (await call('GET', '/api/turn', { key: true })).body.order[2].id;

    await call('DELETE', `/api/entities/${lurker.id}`, { key: true });
    const undone = await call('POST', '/api/undo', { key: true, body: {} });
    expect(undone.body.undone.kind).toBe('entity.deleted');

    // The foe, its row (the same row — history is keyed by the id that
    // didn't change), and its token.
    expect((await call('GET', `/api/entities/${lurker.id}`, { key: true })).status).toBe(200);
    const turn = (await call('GET', '/api/turn', { key: true })).body;
    expect(turn.order).toHaveLength(3);
    expect(turn.order[2].id).toBe(entryId);
    const state = session.campaign.boardState(boardId) as any;
    expect(state.placements.map((p: any) => p.entityId)).toContain(lurker.id);

    // And the NEXT press steps further back — to before the fight was
    // deployed at all — rather than re-undoing the cascade this one
    // already put back.
    await call('POST', '/api/undo', { key: true, body: {} });
    expect((await call('GET', '/api/turn', { key: true })).body.order).toHaveLength(0);
  });
});
