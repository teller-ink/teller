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
import { isParty, publicBoardState, publicTurn, vitalityOf } from './public.ts';
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

describe('who is on the party’s side, asked fail-closed', () => {
  const TRADES = new Set(['marshal', 'trapper']);

  it('lets in the declared word and the declared trades, and nothing else', () => {
    expect(isParty({ type: 'pc' }, TRADES)).toBe(true);
    expect(isParty({ type: 'Marshal' }, TRADES)).toBe(true);
    // The trade as creation might have cased it, and as a human retyped it.
    expect(isParty({ type: 'trapper' }, TRADES)).toBe(true);
    expect(isParty({ type: ' Trapper ' }, TRADES)).toBe(true);
  });

  it('everything else is a foe — including the words nobody typed', () => {
    expect(isParty({ type: 'foe' }, TRADES)).toBe(false);
    expect(isParty({ type: 'npc' }, TRADES)).toBe(false);
    expect(isParty({ type: 'vendor' }, TRADES)).toBe(false);
    expect(isParty({ type: 'Sheriff' }, TRADES)).toBe(false);
    // The one that put numbers on the glass: a foe whose template
    // never said the word.
    expect(isParty({}, TRADES)).toBe(false);
    expect(isParty({ type: '   ' }, TRADES)).toBe(false);
  });

  it('a system with no trades leaves `pc` as the only way in', () => {
    const none: Set<string> = new Set();
    expect(isParty({ type: 'pc' }, none)).toBe(true);
    expect(isParty({ type: 'Marshal' }, none)).toBe(false);
  });
});

describe('the turn order, with the ambush taken out of it', () => {
  const order = [
    { id: 't1', entityId: 'e1' },
    { id: 't2', entityId: 'hidden' },
    { id: 't3', label: '3 coyotes' },
  ];
  const hidden = new Set(['hidden']);
  const at = (turn: number | null) =>
    publicTurn({ order, turn, round: 2 }, hidden);

  it('drops the hidden row and keeps the bare label', () => {
    expect(at(0).order).toEqual([order[0], order[2]]);
    expect(at(0).round).toBe(2);
  });

  it('follows the acting row when it survives', () => {
    expect(at(0).turn).toBe(0);
    expect(at(2).turn).toBe(1);
  });

  it('lands on the next surviving row when the acting one was hidden', () => {
    expect(at(1).turn).toBe(1);
    // …and wraps, rather than pointing past the end.
    expect(
      publicTurn(
        { order: [order[0], { id: 't2', entityId: 'hidden' }], turn: 1, round: 1 },
        hidden,
      ).turn,
    ).toBe(0);
  });

  it('points at nobody when nobody was acting, or nobody is left', () => {
    expect(at(null).turn).toBe(null);
    expect(publicTurn({ order: [order[1]], turn: 0, round: 1 }, hidden)).toEqual({
      order: [],
      turn: null,
      round: 1,
    });
  });

  it('hands back the very same state when nothing was hidden', () => {
    const state = { order, turn: 1, round: 1 };
    expect(publicTurn(state, new Set())).toBe(state);
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

  // The mask, both bases. What the table may know is WHERE the dark
  // is; what it may never know is that the dark patch has a name, a
  // shape, or a neighbour it hasn't walked into yet.
  const VAULT = { id: 'a1', name: 'the vault', cells: [[9, 9]] as [number, number][] };
  const PORCH = { id: 'a2', name: 'the porch', cells: [[1, 1], [1, 2]] as [number, number][] };

  it('under dark, ships the lit cells — freehand and lifted areas, no names', () => {
    const state = publicBoardState(
      {
        fog: {
          base: 'dark',
          revealed: [[0, 0]],
          fogged: [],
          areas: [
            { areaId: 'a1', fogged: true },
            { areaId: 'a2', fogged: false },
          ],
        },
      },
      [VAULT, PORCH],
    ) as any;
    expect(state.fog).toEqual({
      base: 'dark',
      revealed: [[0, 0], [1, 1], [1, 2]],
      fogged: [],
    });
    expect(JSON.stringify(state)).not.toContain('vault');
    expect(JSON.stringify(state)).not.toContain('porch');
    expect(JSON.stringify(state)).not.toContain('9,9');
    expect(JSON.stringify(state)).not.toContain('areaId');
  });

  it('under clear, ships the covered cells — and only those', () => {
    const state = publicBoardState(
      {
        fog: {
          base: 'clear',
          revealed: [],
          fogged: [[0, 0]],
          areas: [{ areaId: 'a1', fogged: true }],
        },
      },
      [VAULT, PORCH],
    ) as any;
    expect(state.fog).toEqual({
      base: 'clear',
      revealed: [],
      fogged: [[0, 0], [9, 9]],
    });
    // The porch is not covered, so its shape never leaves the host —
    // the same rule as an unentered room under the old model.
    expect(JSON.stringify(state)).not.toContain('1,1');
    expect(JSON.stringify(state)).not.toContain('porch');
  });

  it('an old blob flattens the way it always rendered', () => {
    const state = publicBoardState({
      fog: {
        on: true,
        revealed: [[0, 0]],
        regions: [
          { name: 'the vault', revealed: false, cells: [[9, 9]] },
          { name: 'the porch', revealed: true, cells: [[1, 1], [1, 2]] },
        ],
      },
    }) as any;
    expect(state.fog).toEqual({
      base: 'dark',
      revealed: [[0, 0], [1, 1], [1, 2]],
      fogged: [],
    });
    expect(JSON.stringify(state)).not.toContain('vault');
    expect(JSON.stringify(state)).not.toContain('9,9');
  });

  it('a clear map with nothing covered carries no darkness at all', () => {
    const state = publicBoardState({ fog: { base: 'clear' } }, [VAULT]) as any;
    expect(state.fog).toEqual({ base: 'clear', revealed: [], fogged: [] });
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

  /** A screen the DM pointed at one character — authority, not a watcher. */
  async function seatScreen(entityId: string): Promise<string> {
    const hello = await call('POST', '/api/displays/hello', { body: {} });
    await call('POST', '/api/displays/claim', {
      key: true,
      body: { code: hello.body.display.code },
    });
    await call('PATCH', `/api/displays/${hello.body.display.id}`, {
      key: true,
      body: { role: 'seat', params: { entityId } },
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
      // The trades are the system's own declaration, and they are what
      // says who is on the party's side — a live character wears its
      // trade in `type`, because that is what creation writes there.
      data: { kinds: KINDS, trades: [{ name: 'Marshal' }, { name: 'Trapper' }] },
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
        type: 'Marshal',
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
        fog: { on: true, regions: [{ name: 'the vault', revealed: false, cells: [[9, 9]] }] },
      },
      'console',
    );

    const { body } = await call('GET', '/api/public', { key: true });
    expect(body.board.board.name).toBe('The Crossing');
    expect(body.board.state.placements).toEqual([{ entityId: barrett, u: 1, v: 1 }]);
    expect(body.board.state.fog).toEqual({ base: 'dark', revealed: [], fogged: [] });
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

  // The board row grew a field that is not player-safe, and the row
  // ships whole inside the snapshot. Areas are the name AND the shape
  // of a place — exactly what the flattened mask exists to withhold —
  // so this pins that the two halves can't drift apart: the mask says
  // where the dark is, and nothing anywhere in the payload says what
  // it's called.
  it('a board’s areas never travel — only the mask they add up to', async () => {
    session.shelf.putBoard({
      id: boardId,
      key: 'maps/crossing.png',
      name: 'The Crossing',
      areas: [
        { id: 'a1', name: 'the vault', cells: [[9, 9]] },
        { id: 'a2', name: 'the porch', cells: [[1, 1]] },
      ],
    });
    await call('PUT', '/api/campaign/refs', { key: true, body: { board: boardId } });
    session.putBoardState(
      boardId,
      {
        fog: {
          base: 'clear',
          revealed: [],
          fogged: [[0, 0]],
          areas: [{ areaId: 'a1', fogged: true }],
        },
      },
      'console',
    );

    const { body } = await call('GET', '/api/public', { key: true });
    expect(body.board.state.fog).toEqual({
      base: 'clear',
      revealed: [],
      fogged: [[0, 0], [9, 9]],
    });
    expect(body.board.board.areas).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('vault');
    expect(JSON.stringify(body)).not.toContain('porch');
    // The porch isn't covered, so its cells aren't in the mask either.
    expect(JSON.stringify(body.board.state.fog)).not.toContain('1,1');

    // And the shelf listing a passive screen may read is stripped the
    // same way — one law, every door.
    const display = await passiveScreen();
    const listed = await call('GET', '/api/boards', { display });
    expect(listed.status).toBe(200);
    expect(listed.body[0].areas).toBeUndefined();
    expect((await call('GET', '/api/boards', { key: true })).body[0].areas).toHaveLength(2);

    await call('PUT', '/api/campaign/refs', { key: true, body: { board: null } });
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

  // -- the table notice --------------------------------------------------
  //
  // The law it has to satisfy is the one this whole file is about, read
  // from the other end: a notice is IN the payload every passive screen
  // renders, and a note is not — because the DM typed one FOR the room
  // and aimed the other at one person.

  it('there is no notice until somebody puts one up', async () => {
    const table = await passiveScreen();
    expect((await call('GET', '/api/public', { display: table })).body.notice).toBe(null);
  });

  it('reaches the outward glass, and comes down again', async () => {
    const table = await passiveScreen();
    const up = await call('POST', '/api/notice', { key: true, body: { text: '  break  ' } });
    expect(up.status).toBe(200);
    expect(up.body.notice).toMatchObject({ text: 'break' });

    const seen = await call('GET', '/api/public', { display: table });
    expect(seen.body.notice.text).toBe('break');
    expect(typeof seen.body.notice.at).toBe('string');

    // Empty words are the way down — one door, both directions.
    const down = await call('POST', '/api/notice', { key: true, body: { text: '   ' } });
    expect(down.body.notice).toBe(null);
    expect((await call('GET', '/api/public', { display: table })).body.notice).toBe(null);
  });

  it('is the DM\'s to write and nobody else\'s', async () => {
    const table = await passiveScreen();
    expect((await call('POST', '/api/notice', { display: table, body: { text: 'x' } })).status)
      .toBe(401);
    expect((await call('POST', '/api/notice', { body: { text: 'x' } })).status).toBe(401);
    expect((await call('GET', '/api/public', { display: table })).body.notice).toBe(null);
  });

  it('both directions are in the log (rule 3)', async () => {
    await call('POST', '/api/notice', { key: true, body: { text: 'everyone up' } });
    await call('POST', '/api/notice', { key: true, body: { text: '' } });
    const log = (await call('GET', '/api/events?limit=20', { key: true })).body;
    const kinds = log.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('notice.posted');
    expect(kinds).toContain('notice.cleared');
    const posted = log.find((e: { kind: string }) => e.kind === 'notice.posted');
    expect(posted.payload).toMatchObject({ text: 'everyone up' });
  });

  it('is not a note: a passed one still reaches nobody through this payload', async () => {
    const table = await passiveScreen();
    await call('POST', '/api/notice', { key: true, body: { text: 'the room hears this' } });
    await call('POST', '/api/notes', {
      key: true,
      body: { text: 'only barrett hears this', to: [barrett] },
    });
    const snapshot = await call('GET', '/api/public', { display: table });
    expect(snapshot.body.notice.text).toBe('the room hears this');
    expect(JSON.stringify(snapshot.body)).not.toContain('only barrett');
    expect(snapshot.body.notes).toBeUndefined();
    // And the note door still answers a passive screen with nothing.
    expect((await call('GET', '/api/notes/mine', { display: table })).body).toEqual([]);
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

  // -- the fail-closed party rule, through the door -----------------------
  //
  // The audit of 2026-08-24 found the side taken off `type`, a field
  // that holds three different things depending on who wrote it. These
  // pin all three arrivals at the boundary rather than at the function.

  const rosterOf = async (id: string) => {
    const { body } = await call('GET', '/api/public', { key: true });
    return body.roster.find((e: any) => e.id === id);
  };

  it('an entity nobody typed a word onto is a foe, not the posse', async () => {
    const nameless = session.create(
      { name: 'Something In The Reeds', lists: { resources: [{ name: 'Vigour', value: 9, max: 9 }] } } as never,
      'console',
    ).id;
    const row = await rosterOf(nameless);
    expect(row.side).toBe('foe');
    expect(row.lists.resources).toBeUndefined();
    expect(row.vitality).toBe('healthy');
  });

  it('an `npc` is a foe too — the word means somebody else’s sheet', async () => {
    const sheriff = session.create(
      { name: 'Sheriff Pike', type: 'npc', lists: { resources: [{ name: 'Vigour', value: 4, max: 8 }] } } as never,
      'console',
    ).id;
    const row = await rosterOf(sheriff);
    expect(row.side).toBe('foe');
    expect(row.lists).toEqual({});
    // The ceiling is gone with the rest; only the band survives.
    expect(row.vitality).toBe('bloodied');
  });

  it('the declared word gets in, cased however a human cased it', async () => {
    const pc = session.create(
      { name: 'Ida', type: 'pc', lists: { resources: [{ name: 'Vigour', value: 7, max: 10 }] } } as never,
      'console',
    ).id;
    const trade = session.create(
      { name: 'Cassidy', type: 'trapper', lists: { resources: [{ name: 'Vigour', value: 6, max: 10 }] } } as never,
      'console',
    ).id;
    expect((await rosterOf(pc)).side).toBe('party');
    expect((await rosterOf(pc)).lists.resources).toEqual([
      { name: 'Vigour', value: 7, max: 10 },
    ]);
    expect((await rosterOf(trade)).side).toBe('party');
    expect((await rosterOf(trade)).lists.resources).toEqual([
      { name: 'Vigour', value: 6, max: 10 },
    ]);
  });

  // -- the ambush, and the character still being made ---------------------

  it('a hidden foe is absent from the roster AND the order, not merely tokenless', async () => {
    await call('PUT', '/api/campaign/refs', { key: true, body: { board: boardId } });
    session.turnOp({ op: 'add', entityId: barrett }, 'console');
    session.turnOp({ op: 'add', entityId: watcher }, 'console');
    session.putBoardState(
      boardId,
      {
        placements: [
          { id: 'plc_a', entityId: barrett, u: 0.1, v: 0.5 },
          { id: 'plc_b', entityId: watcher, u: 0.8, v: 0.5, hidden: true },
        ],
      },
      'console',
    );

    const { body } = await call('GET', '/api/public', { key: true });
    expect(body.roster.map((e: any) => e.id)).toEqual([barrett]);
    expect(body.turn.order.map((e: any) => e.entityId)).toEqual([barrett]);
    expect(JSON.stringify(body)).not.toContain('Watcher');

    // A token anyone can see is a reveal: the same entity standing
    // openly elsewhere on the board keeps its name.
    session.putBoardState(
      boardId,
      {
        placements: [
          { id: 'plc_b', entityId: watcher, u: 0.8, v: 0.5, hidden: true },
          { id: 'plc_c', entityId: watcher, u: 0.2, v: 0.2 },
        ],
      },
      'console',
    );
    const shown = await call('GET', '/api/public', { key: true });
    expect(shown.body.roster.map((e: any) => e.id)).toContain(watcher);
  });

  it('the pointer follows the fight when the hidden one is acting', async () => {
    await call('PUT', '/api/campaign/refs', { key: true, body: { board: boardId } });
    session.turnOp({ op: 'add', entityId: watcher }, 'console');
    session.turnOp({ op: 'add', entityId: barrett }, 'console');
    session.turnOp({ op: 'next' }, 'console'); // the watcher is acting
    session.putBoardState(
      boardId,
      { placements: [{ id: 'plc_b', entityId: watcher, u: 0.8, v: 0.5, hidden: true }] },
      'console',
    );

    // The console still sees the truth: two rows, the hidden one acting.
    const dm = await call('GET', '/api/turn', { key: true });
    expect(dm.body.order).toHaveLength(2);
    expect(dm.body.turn).toBe(0);

    // The room sees one row, and the highlight is on it — never on the
    // wrong name, which is the whole reason the index is remapped.
    const { body } = await call('GET', '/api/public', { key: true });
    expect(body.turn.order.map((e: any) => e.entityId)).toEqual([barrett]);
    expect(body.turn.turn).toBe(0);

    // …and when the visible one takes the turn, the pointer is still on it.
    session.turnOp({ op: 'next' }, 'console');
    const after = await call('GET', '/api/public', { key: true });
    expect(after.body.turn.turn).toBe(0);
  });

  it('a half-made character is prep, and prep is nobody’s but the DM’s', async () => {
    const draft = session.create(
      { name: 'Unnamed', type: 'pc', lists: { meta: [{ name: 'draft' }] } } as never,
      'console',
    ).id;
    const { body } = await call('GET', '/api/public', { key: true });
    expect(body.roster.map((e: any) => e.id)).not.toContain(draft);
    expect(JSON.stringify(body)).not.toContain('Unnamed');

    // Clearing the mark is the last step of creation, and it is what
    // puts the character in the room.
    session.writeEntry(draft, { list: 'meta', name: 'draft', remove: true } as never, 'console');
    const after = await call('GET', '/api/public', { key: true });
    expect(after.body.roster.map((e: any) => e.id)).toContain(draft);
  });

  // -- the two doors beside the snapshot ---------------------------------
  //
  // `/api/entities` and `/api/turn` are behind `canWatch`, which is how
  // the ambush and the draft walked out past the whole redaction law.
  // They answer a watcher from the same redactor now, and the console
  // and the seat keep the truth.

  describe('a watch-only credential gets the redacted answer', () => {
    let table: string;

    beforeEach(async () => {
      table = await passiveScreen();
      await call('PUT', '/api/campaign/refs', { key: true, body: { board: boardId } });
      session.turnOp({ op: 'add', entityId: barrett }, 'console');
      session.turnOp({ op: 'add', entityId: watcher }, 'console');
      session.putBoardState(
        boardId,
        { placements: [{ id: 'plc_b', entityId: watcher, u: 0.8, v: 0.5, hidden: true }] },
        'console',
      );
      session.create(
        { name: 'Unnamed', type: 'pc', lists: { meta: [{ name: 'draft' }] } } as never,
        'console',
      );
    });

    it('the roster door hands over exactly what the snapshot would', async () => {
      const snapshot = await call('GET', '/api/public', { display: table });
      const watching = await call('GET', '/api/entities', { display: table });
      expect(watching.status).toBe(200);
      expect(watching.body).toEqual(
        snapshot.body.roster.map((e: any) => ({ id: e.id, name: e.name, type: e.type ?? null })),
      );
      expect(JSON.stringify(watching.body)).not.toContain('Watcher');
      expect(JSON.stringify(watching.body)).not.toContain('Unnamed');
    });

    it('and someone else’s children never travel through it at all', async () => {
      const watching = await call('GET', `/api/entities?parent=${barrett}`, { display: table });
      expect(watching.body).toEqual([]);
    });

    it('the turn door hands over the snapshot’s order and pointer', async () => {
      const snapshot = await call('GET', '/api/public', { display: table });
      const watching = await call('GET', '/api/turn', { display: table });
      expect(watching.body).toEqual(snapshot.body.turn);
      expect(watching.body.order.map((e: any) => e.entityId)).toEqual([barrett]);
    });

    it('the console and the seat keep the truth', async () => {
      const seat = await seatScreen(barrett);
      for (const opts of [{ key: true }, { display: seat }]) {
        const roster = await call('GET', '/api/entities', opts);
        expect(roster.body.map((e: any) => e.name)).toEqual(
          expect.arrayContaining(['Barrett', 'Watcher', 'Unnamed']),
        );
        const turn = await call('GET', '/api/turn', opts);
        expect(turn.body.order.map((e: any) => e.entityId)).toEqual([barrett, watcher]);
      }
    });
  });
});
