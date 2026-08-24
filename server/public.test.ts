// The player-safe snapshot: what a passive screen may see, and what it
// may never see. The redaction law is the point of the file, so the
// tests are written as the law reads — a foe's numbers are gone, its
// statuses are not, and nobody's notes or children travel at all.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';
import { publicBoardState, vitalityOf } from './public.ts';
import type { KindDef } from '../core/kind.ts';

const KEY = 'test-key-0123456789abcdef';

// The system's declarations, not teller's words: one list that clears
// at zero (held things) and one that stays (the sheet's numbers).
const KINDS: KindDef[] = [
  { name: 'conditions', domain: { kind: 'count', zero: 'clears' } },
  { name: 'resources', domain: { kind: 'count', zero: 'stays' } },
];

describe('vitality, off the first max-bearing entry', () => {
  const at = (value: number) =>
    vitalityOf({ resources: [{ name: 'Vigour', value, max: 20 }] }, KINDS);

  it('reads the ratio, and calls zero down rather than dead', () => {
    expect(at(20)).toBe('healthy');
    expect(at(11)).toBe('healthy');
    expect(at(10)).toBe('bloodied');
    expect(at(5)).toBe('critical');
    expect(at(0)).toBe('down');
    expect(at(-3)).toBe('down');
  });

  it('a max with no value reads as zero (§M-8)', () => {
    expect(vitalityOf({ resources: [{ name: 'Vigour', max: 20 }] }, KINDS)).toBe('down');
  });

  it('skips statuses and anything without a ceiling', () => {
    expect(
      vitalityOf(
        {
          conditions: [{ name: 'Afraid', value: 1, max: 6 }],
          resources: [{ name: 'Sand', value: 3 }, { name: 'Vigour', value: 4, max: 8 }],
        },
        KINDS,
      ),
    ).toBe('bloodied');
    expect(vitalityOf({ resources: [{ name: 'Sand', value: 3 }] }, KINDS)).toBeUndefined();
    expect(vitalityOf({}, KINDS)).toBeUndefined();
  });
});

describe('board state, stripped', () => {
  it('removes hidden placements rather than flagging them', () => {
    const state = publicBoardState({
      placements: [
        { entityId: 'e1', u: 1, v: 2 },
        { label: 'ambush', u: 9, v: 9, hidden: true },
      ],
      zones: [{ id: 'z1' }, { id: 'z2', hidden: true }],
      view: { scale: 2 },
    }) as any;
    expect(state.placements).toEqual([{ entityId: 'e1', u: 1, v: 2 }]);
    expect(JSON.stringify(state)).not.toContain('ambush');
    expect(state.zones).toEqual([{ id: 'z1' }]);
    // Calibration passes through — a drawn square must still be an inch.
    expect(state.view).toEqual({ scale: 2 });
  });

  it('flattens fog to revealed cells and drops the unrevealed shapes', () => {
    const state = publicBoardState({
      fog: {
        on: true,
        revealed: ['0,0'],
        regions: [
          { name: 'the vault', revealed: false, cells: ['9,9'] },
          { name: 'the porch', revealed: true, cells: ['1,1', '1,2'] },
        ],
      },
    }) as any;
    expect(state.fog).toEqual({ on: true, revealed: ['0,0', '1,1', '1,2'] });
    expect(JSON.stringify(state)).not.toContain('vault');
    expect(JSON.stringify(state)).not.toContain('9,9');
  });

  it('passes nothing through when there is nothing', () => {
    expect(publicBoardState(null)).toBe(null);
  });
});

describe('GET /api/public', () => {
  let dir: string;
  let session: Session;
  let server: Server;
  let base: string;
  let barrett: string;
  let watcher: string;
  let boardId: string;

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

  /** A screen the DM adopted and pointed at a passive role. */
  async function passiveScreen(): Promise<string> {
    const hello = await call('POST', '/api/displays/hello', { body: {} });
    await call('POST', '/api/displays/claim', {
      key: true,
      body: { code: hello.body.display.code },
    });
    await call('PATCH', `/api/displays/${hello.body.display.id}`, {
      key: true,
      body: { role: 'table' },
    });
    return hello.body.display.id;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'teller-public-'));
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_test',
      name: 'Testing',
      version: 1,
      data: { kinds: KINDS },
    });
    shelf.putPack({
      id: 'pak_test',
      system: 'sys_test',
      name: 'Bestiary',
      data: {
        bestiary: [
          {
            id: 'npc_watcher',
            name: 'Watcher',
            type: 'foe',
            notes: 'it waits in the treeline for the second night',
            lists: {
              resources: [{ name: 'Vigour', value: 12, max: 12 }],
              features: [{ name: 'Bark Skin', value: 'shrugs off the first shot' }],
            },
          },
        ],
      },
    });
    const board = shelf.putBoard({ key: 'maps/crossing.png', name: 'The Crossing' });
    boardId = board.id;

    const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_test', name: 'Testing' } } },
      'host',
    );
    session = new Session(shelf, campaign, dir);

    barrett = session.create(
      {
        name: 'Barrett',
        notes: 'owes money in three counties',
        lists: {
          resources: [{ name: 'Vigour', value: 5, max: 10 }],
          conditions: [{ name: 'Afraid', value: 2 }],
        },
        children: [{ name: 'Peacemaker', lists: {} }],
      } as never,
      'console',
    ).id;
    // A THIN stamp: the foe stores nothing, so everything it reads
    // comes through the template — including the ceiling vitality needs.
    watcher = session.stampFrom('bestiary', 'npc_watcher', 'console')!.id;
    session.writeEntry(watcher, { list: 'resources', name: 'Vigour', value: 3 }, 'console');
    session.writeEntry(watcher, { list: 'conditions', name: 'Poisoned', value: 2 }, 'console');

    server = serve(session, 0, KEY);
    await new Promise((r) => server.on('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    session.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a stranger is not at this table', async () => {
    expect((await call('GET', '/api/public')).status).toBe(401);
    const hello = await call('POST', '/api/displays/hello', { body: {} });
    // Introduced, but not yet adopted — a pairing code is not a power.
    expect(
      (await call('GET', '/api/public', { display: hello.body.display.id })).status,
    ).toBe(401);
  });

  it('an adopted passive screen may watch', async () => {
    const table = await passiveScreen();
    const res = await call('GET', '/api/public', { display: table });
    expect(res.status).toBe(200);
    expect(res.body.campaign).toEqual({ slug: 'duo', name: 'The Unlikely Duo' });
  });

  it("a foe's numbers never leave; its statuses and vitality do", async () => {
    const { body } = await call('GET', '/api/public', { key: true });
    const foe = body.roster.find((e: any) => e.id === watcher);
    expect(foe.side).toBe('foe');
    expect(foe.type).toBe('foe');
    expect(foe.lists.resources).toBeUndefined();
    expect(foe.lists.features).toBeUndefined();
    expect(foe.lists.conditions).toEqual([{ name: 'Poisoned', value: 2 }]);
    // 3 of 12, and the 12 lives only in the template it was stamped from.
    // The sweep excludes the minted id — random hex can spell any digits.
    expect(foe.vitality).toBe('critical');
    const { id: _, ...redacted } = foe;
    expect(JSON.stringify(redacted)).not.toContain('12');
    expect(JSON.stringify(body)).not.toContain('Bark Skin');
  });

  it('the party keeps its numbers, and everyone gets a vitality', async () => {
    const { body } = await call('GET', '/api/public', { key: true });
    const pc = body.roster.find((e: any) => e.id === barrett);
    expect(pc.side).toBe('party');
    expect(pc.lists.resources).toEqual([{ name: 'Vigour', value: 5, max: 10 }]);
    expect(pc.lists.conditions).toEqual([{ name: 'Afraid', value: 2 }]);
    expect(pc.vitality).toBe('bloodied');
  });

  it('notes and children travel for nobody', async () => {
    const { body } = await call('GET', '/api/public', { key: true });
    for (const entity of body.roster) {
      expect(entity.notes).toBeUndefined();
      expect(entity.children).toBeUndefined();
      expect(entity.refs).toBeUndefined();
    }
    const json = JSON.stringify(body);
    expect(json).not.toContain('three counties');
    expect(json).not.toContain('treeline');
    expect(json).not.toContain('Peacemaker');
  });

  it('carries the turn order the runner is already showing', async () => {
    session.turnOp({ op: 'add', entityId: barrett }, 'console');
    const { body } = await call('GET', '/api/public', { key: true });
    expect(body.turn.order).toHaveLength(1);
    expect(body.turn.round).toBe(1);
  });

  it('the active board is a manifest ref: absent means idle', async () => {
    expect((await call('GET', '/api/public', { key: true })).body.board).toBe(null);

    const set = await call('PUT', '/api/campaign/refs', {
      key: true,
      body: { board: boardId },
    });
    expect(set.status).toBe(200);
    expect(set.body.board).toEqual({ id: boardId, name: 'The Crossing' });

    session.putBoardState(
      boardId,
      {
        placements: [
          { entityId: barrett, u: 1, v: 1 },
          { label: 'the ambush', u: 8, v: 8, hidden: true },
        ],
        fog: { on: true, regions: [{ name: 'the vault', revealed: false, cells: ['9,9'] }] },
      },
      'console',
    );

    const { body } = await call('GET', '/api/public', { key: true });
    expect(body.board.board.name).toBe('The Crossing');
    expect(body.board.state.placements).toEqual([{ entityId: barrett, u: 1, v: 1 }]);
    expect(body.board.state.fog).toEqual({ on: true, revealed: [] });
    expect(JSON.stringify(body)).not.toContain('ambush');

    // And clearing it puts the table back to idle.
    await call('PUT', '/api/campaign/refs', { key: true, body: { board: null } });
    expect((await call('GET', '/api/public', { key: true })).body.board).toBe(null);

    // A board this host hasn't got is refused rather than stored blind.
    expect(
      (await call('PUT', '/api/campaign/refs', { key: true, body: { board: 'brd_nope' } }))
        .status,
    ).toBe(400);
  });

  // A movement record names a token that may be standing behind the
  // screen, so the record is DM material by construction. Nothing
  // player-facing reads the log at all — and that is exactly the kind
  // of fact that stays true until somebody adds a convenience endpoint,
  // so it is pinned here rather than assumed.
  it('a hidden token’s step lands in the log and never in a watcher’s hands', async () => {
    await call('PUT', '/api/campaign/refs', { key: true, body: { board: boardId } });
    session.putBoardState(
      boardId,
      {
        placements: [
          { id: 'plc_a', entityId: barrett, u: 0.1, v: 0.5 },
          { id: 'plc_b', label: 'the ambush', u: 0.8, v: 0.5, hidden: true },
        ],
      },
      'console',
    );
    session.putBoardState(
      boardId,
      {
        placements: [
          { id: 'plc_a', entityId: barrett, u: 0.1, v: 0.5 },
          { id: 'plc_b', label: 'the ambush', u: 0.3, v: 0.5, hidden: true },
        ],
      },
      'console',
    );

    const dm = await call('GET', '/api/events?limit=20', { key: true });
    const moved = dm.body.filter((e: { kind: string }) => e.kind === 'token.moved');
    expect(moved).toHaveLength(1);
    expect(moved[0].payload).toMatchObject({ byName: 'the ambush', hidden: true });

    // The passive snapshot carries no history at all, so the step is
    // not there to be stripped — and the hidden placement is gone from
    // it the way it has always been.
    const table = await passiveScreen();
    const snapshot = await call('GET', '/api/public', { display: table });
    expect(snapshot.status).toBe(200);
    expect(JSON.stringify(snapshot.body)).not.toContain('ambush');
    expect(JSON.stringify(snapshot.body)).not.toContain('token.moved');

    // And the log itself is not a door a screen at the table may open.
    expect((await call('GET', '/api/events', { display: table })).status).toBe(401);
    expect((await call('GET', '/api/events', {})).status).toBe(401);
  });

  it('board-state answers the DM fully and a watcher safely', async () => {
    session.putBoardState(
      boardId,
      { placements: [{ label: 'seen', u: 0, v: 0 }, { label: 'unseen', u: 5, v: 5, hidden: true }] },
      'console',
    );
    const dm = await call('GET', `/api/board-state/${boardId}`, { key: true });
    expect(dm.body.placements).toHaveLength(2);

    const table = await passiveScreen();
    const watching = await call('GET', `/api/board-state/${boardId}`, { display: table });
    expect(watching.status).toBe(200);
    expect(watching.body.placements).toEqual([{ label: 'seen', u: 0, v: 0 }]);
    expect(JSON.stringify(watching.body)).not.toContain('unseen');
  });
});
