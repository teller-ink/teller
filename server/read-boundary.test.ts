// The READ side of rule 7, role by role (the audit, 2026-11-16).
//
// The write side held completely; the read side did not. One door
// answered any adopted screen with any slot, the file door opened every
// byte to any ticket, a seat read the Warden's prep by design, and a
// plugin door the room could knock on was handed the unredacted table.
// So what's pinned here is each role's reads — the ones it keeps, which
// are what the shipped client asks for, and the ones it lost.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { enablePlugin, loadPlugins } from '../core/plugins.ts';
import { DRAFT_MARK } from '../core/entity.ts';
import { serve } from './index.ts';
import { Host, Session } from './session.ts';
import { passNote } from './notes.ts';
import { snapshotFor } from './plugin-bridge.ts';

const KEY = 'test-key-0123456789abcdef';
const PEEK = 'plg_peek00000001';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

let dir: string;
let session: Session;
let host: Host;
let server: Server;
let base: string;

let barrett: string;
let watcher: string;
let ambusher: string;
let dolores: string;
let windmill: string;
let activeBoard: string;
let nextBoard: string;
let shownHandout: string;
let secretHandout: string;

async function call(
  method: string,
  path: string,
  opts: { key?: boolean; display?: string; body?: unknown; raw?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.key) headers['x-teller-key'] = KEY;
  if (opts.display) headers['x-teller-display'] = opts.display;
  if (opts.body !== undefined || opts.raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // bytes, or a plain-text refusal
  }
  return { status: res.status, body };
}

/** A screen the DM adopted and gave a job. */
async function screen(role: string, params?: Record<string, unknown>): Promise<string> {
  const hello = await call('POST', '/api/displays/hello', { body: {} });
  await call('POST', '/api/displays/claim', { key: true, body: { code: hello.body.display.code } });
  await call('PATCH', `/api/displays/${hello.body.display.id}`, {
    key: true,
    body: { role, ...(params ? { params } : {}) },
  });
  return hello.body.display.id;
}

/** Fetch one file the way an `<img>` does: the ticket in the query. */
async function file(fileKey: string, as: { display?: string; key?: boolean }): Promise<Response> {
  const slips = (await call('GET', '/api/ticket', as)).body;
  return fetch(
    `${base}/files/${fileKey}?handle=${encodeURIComponent(slips.handle)}&ticket=${encodeURIComponent(slips.files)}`,
  );
}

function put(path: string, body: Buffer | string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-read-'));
  put(join(dir, 'art', 'handouts', 'shown.png'), PNG);
  put(join(dir, 'art', 'handouts', 'secret.png'), PNG);
  put(join(dir, 'map', 'active.png'), PNG);
  put(join(dir, 'map', 'next.png'), PNG);
  put(join(dir, 'art', 'pak_test', 'portrait.png'), PNG);
  put(join(dir, 'art', 'pak_test', 'foe.png'), PNG);
  put(join(dir, 'art', 'pak_test', 'page.html'), '<script>alert(1)</script>');
  put(join(dir, 'secret.txt'), 'the key');
  symlinkSync(join(dir, 'secret.txt'), join(dir, 'art', 'pak_test', 'link.png'));

  // A table door that hands back whatever it was handed.
  const peek = join(dir, 'plugins', 'peek');
  put(
    join(peek, 'plugin.json'),
    JSON.stringify({
      id: PEEK,
      name: 'Peek',
      version: 1,
      provides: [{ point: 'door.peek', role: 'table' }],
      needs: [
        'read:entities',
        'read:board',
        'read:templates/bestiary',
        'read:declarations/kinds',
        'read:declarations/encounters',
      ],
    }),
  );
  put(join(peek, 'host.mjs'), `export const provides = { 'door.peek': (req) => ({ body: req.table }) };`);

  const shelf = openShelf(dir);
  enablePlugin(dir, shelf, PEEK, true);
  shelf.putSystem({
    id: 'sys_test',
    name: 'Testing',
    version: 1,
    data: {
      kinds: [
        { name: 'conditions', domain: { kind: 'count', zero: 'clears' } },
        { name: 'resources', domain: { kind: 'count', zero: 'stays' } },
      ],
      trades: [{ name: 'Marshal' }],
      statuses: [{ name: 'Afraid' }],
    },
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
          art: 'art/pak_test/foe.png',
          lists: { resources: [{ name: 'Vigour', value: 12, max: 12 }] },
        },
      ],
      catalog: [{ id: 'cat_rifle', name: 'Rifle' }],
      portraits: { Marshal: 'art/pak_test/portrait.png' },
    },
  });
  activeBoard = shelf.putBoard({ key: 'map/active.png', name: 'The Crossing' }).id;
  nextBoard = shelf.putBoard({ key: 'map/next.png', name: 'The Vault, next week' }).id;

  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  campaign.save({ ...campaign.root(), refs: { system: { id: 'sys_test', name: 'Testing' } } }, 'host');
  session = new Session(shelf, campaign, dir);

  barrett = session.create(
    {
      name: 'Barrett',
      type: 'Marshal',
      notes: 'owes money in three counties',
      lists: { resources: [{ name: 'Vigour', value: 5, max: 10 }] },
    } as never,
    'console',
  ).id;
  watcher = session.stampFrom('bestiary', 'npc_watcher', 'console')!.id;
  ambusher = session.create({ name: 'Bark Watcher', type: 'foe', lists: {} } as never, 'console').id;
  dolores = session.create(
    { name: 'Draft Dolores', type: 'pc', lists: { meta: [{ name: DRAFT_MARK }] } } as never,
    'console',
  ).id;
  windmill = session.create(
    { name: 'Windmill', type: 'thing', lists: { meta: [{ name: 'side', value: 'none' }] } } as never,
    'console',
  ).id;

  session.campaign.putTemplate(
    'encounters',
    { name: 'The Lake', notes: 'AMBUSH', data: { foes: [{ name: 'Bark Watcher', hidden: true }] } },
    'console',
  );
  shownHandout = session.campaign.putTemplate(
    'handouts',
    { name: 'Wanted Poster', data: { key: 'art/handouts/shown.png' } },
    'console',
  ).id;
  secretHandout = session.campaign.putTemplate(
    'handouts',
    { name: 'Secret Letter', data: { key: 'art/handouts/secret.png', notes: 'not yet' } },
    'console',
  ).id;

  session.save(
    {
      ...session.campaign.root(),
      refs: {
        ...session.campaign.root().refs,
        board: { id: activeBoard, name: 'The Crossing' },
        handout: { id: shownHandout, name: 'Wanted Poster' },
      },
    },
    'console',
  );
  session.putBoardState(
    activeBoard,
    {
      placements: [
        { entityId: barrett, u: 1, v: 1 },
        { entityId: ambusher, u: 5, v: 5, hidden: true },
      ],
    },
    'console',
  );
  session.putBoardState(nextBoard, { placements: [{ label: 'Bandit Boss', u: 2, v: 2 }] }, 'console');

  for (const entityId of [barrett, watcher, ambusher, dolores, windmill]) {
    session.turnOp({ op: 'add', entityId }, 'console');
  }
  session.turnOp({ op: 'add', label: '3 coyotes' }, 'console');

  host = Host.around(session);
  const plugins = await loadPlugins(dir, shelf);
  expect(plugins.problems).toEqual([]);
  host.setPlugins(plugins.loaded, plugins.problems);
  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

const PASSIVE = ['table', 'board', 'art', 'badge', 'blank'];
const PREP = ['encounters', 'bestiary', 'handouts', 'made-up-slot'];

describe('the declaration door, slot by slot', () => {
  it('a passive screen reads the kinds behind its chips and nothing else', async () => {
    for (const role of PASSIVE) {
      const display = await screen(role, role === 'badge' ? { entityId: barrett } : undefined);
      expect((await call('GET', '/api/stack/declarations/kinds', { display })).status).toBe(200);
      for (const slot of [...PREP, 'panels', 'trades']) {
        const res = await call('GET', `/api/stack/declarations/${slot}`, { display });
        expect([role, slot, res.status]).toEqual([role, slot, 401]);
      }
    }
  });

  it("a seat reads its sheet's and its builder's slots, and no prep", async () => {
    const seat = await screen('seat', { entityId: barrett });
    // `catalog` too: a builder on the shelf picks a starting kit off the
    // goods list, and asks for it as a declaration.
    for (const slot of ['panels', 'screens', 'ladders', 'statuses', 'sections', 'bands', 'kinds', 'trades', 'creation', 'catalog']) {
      expect([slot, (await call('GET', `/api/stack/declarations/${slot}`, { display: seat })).status]).toEqual([slot, 200]);
    }
    for (const slot of PREP) {
      expect([slot, (await call('GET', `/api/stack/declarations/${slot}`, { display: seat })).status]).toEqual([slot, 401]);
    }
  });

  it('a seat nobody pointed at a character reads as passive glass', async () => {
    const seat = await screen('seat');
    expect((await call('GET', '/api/stack/declarations/panels', { display: seat })).status).toBe(401);
    expect((await call('GET', '/api/stack/declarations/kinds', { display: seat })).status).toBe(200);
  });

  it('the DM and a console read every slot', async () => {
    const console_ = await screen('console');
    for (const as of [{ key: true }, { display: console_ }]) {
      for (const slot of PREP) {
        expect((await call('GET', `/api/stack/declarations/${slot}`, as)).status).toBe(200);
      }
    }
    const recipes = await call('GET', '/api/stack/declarations/encounters', { key: true });
    expect(JSON.stringify(recipes.body)).toContain('AMBUSH');
  });
});

describe('the template doors', () => {
  it('a seat reads the catalogue and the upgrades, never the bestiary or the encounters', async () => {
    const seat = await screen('seat', { entityId: barrett });
    expect((await call('GET', '/api/stack/templates/catalog', { display: seat })).body).toEqual([
      expect.objectContaining({ id: 'cat_rifle' }),
    ]);
    expect((await call('GET', '/api/stack/templates/upgrades', { display: seat })).status).toBe(200);
    expect((await call('GET', '/api/templates/catalog', { display: seat })).status).toBe(200);
    expect((await call('GET', '/api/stack/templates/bestiary', { display: seat })).status).toBe(401);
    expect((await call('GET', '/api/templates/encounters', { display: seat })).status).toBe(401);
    expect((await call('GET', '/api/templates/handouts', { display: seat })).status).toBe(401);
    expect((await call('GET', '/api/handouts', { display: seat })).status).toBe(401);
  });

  it('passive glass reads no template slot at all', async () => {
    const table = await screen('table');
    for (const path of ['/api/stack/templates/catalog', '/api/templates/catalog', '/api/handouts']) {
      expect((await call('GET', path, { display: table })).status).toBe(401);
    }
  });
});

describe('the roster and the turn order', () => {
  it("a seat reads its own sheet whole and the room's roster for everyone else", async () => {
    const seat = await screen('seat', { entityId: barrett });
    const own = await call('GET', `/api/entities/${barrett}`, { display: seat });
    expect(own.body.notes).toBe('owes money in three counties');
    const roster = await call('GET', '/api/entities', { display: seat });
    expect(roster.body.map((e: any) => e.name).sort()).toEqual(['Barrett', 'Watcher']);
    expect(JSON.stringify(roster.body)).not.toMatch(/Bark|Dolores|Windmill/);
    expect((await call('GET', `/api/entities/${watcher}`, { display: seat })).status).toBe(401);
  });

  it('nobody but the DM learns a draft or a side-none row is in the order', async () => {
    const table = await screen('table');
    const seat = await screen('seat', { entityId: barrett });
    for (const display of [table, seat]) {
      const turn = await call('GET', '/api/turn', { display });
      const ids = turn.body.order.map((e: any) => e.entityId ?? e.label);
      expect(ids).toEqual([barrett, watcher, '3 coyotes']);
    }
    const snapshot = await call('GET', '/api/public', { display: table });
    expect(snapshot.body.turn.order.map((e: any) => e.entityId ?? e.label)).toEqual([
      barrett,
      watcher,
      '3 coyotes',
    ]);
    const dm = await call('GET', '/api/turn', { key: true });
    expect(dm.body.order).toHaveLength(6);
  });

  it("a seat whose own character is still being made still finds its row", async () => {
    const seat = await screen('seat', { entityId: dolores });
    const turn = await call('GET', '/api/turn', { display: seat });
    expect(turn.body.order.map((e: any) => e.entityId)).toContain(dolores);
    expect(turn.body.order.map((e: any) => e.entityId)).not.toContain(windmill);
  });
});

describe('a seat scores its own row, while the table is taking rolls', () => {
  const row = (entityId?: string, label?: string) =>
    session.turnState().order.find((e) => (entityId ? e.entityId === entityId : e.label === label))!.id;

  it('refuses a score outside the rolling phase, and lets the DM', async () => {
    const seat = await screen('seat', { entityId: barrett });
    const before = session.turnState();
    const res = await call('POST', '/api/turn', {
      display: seat,
      body: { op: 'score', entryId: row(barrett), score: 999 },
    });
    expect(res.status).toBe(401);
    expect(session.turnState()).toEqual(before);
    expect(
      (await call('POST', '/api/turn', { key: true, body: { op: 'score', entryId: row(barrett), score: 4 } }))
        .status,
    ).toBe(200);
  });

  it('takes a finite number while rolling, and answers with the room’s order', async () => {
    session.turnOp({ op: 'rolling', on: true }, 'console');
    const seat = await screen('seat', { entityId: barrett });
    for (const raw of ['{"op":"score","entryId":"ID","score":"999"}', '{"op":"score","entryId":"ID","score":1e999}']) {
      const res = await call('POST', '/api/turn', { display: seat, raw: raw.replace('ID', row(barrett)) });
      expect(res.status).toBe(401);
    }
    const ok = await call('POST', '/api/turn', {
      display: seat,
      body: { op: 'score', entryId: row(barrett), score: 7 },
    });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain(ambusher);
    expect(session.turnState().order.find((e) => e.entityId === barrett)?.score).toBe(7);
  });

  it('a seat nobody pointed anywhere scores nothing, not even a label row', async () => {
    session.turnOp({ op: 'rolling', on: true }, 'console');
    const seat = await screen('seat');
    const res = await call('POST', '/api/turn', {
      display: seat,
      body: { op: 'score', entryId: row(undefined, '3 coyotes'), score: 50 },
    });
    expect(res.status).toBe(401);
  });
});

describe("a seat doesn't hold its own marks", () => {
  it('refuses side, hidden, draft, type and refs, and takes everything else', async () => {
    const seat = await screen('seat', { entityId: barrett });
    const entry = (body: object) =>
      call('POST', `/api/entities/${barrett}/entry`, { display: seat, body });
    expect((await entry({ list: 'meta', name: 'side', value: 'none' })).status).toBe(401);
    expect((await entry({ list: 'meta', name: 'hidden' })).status).toBe(401);
    expect((await entry({ list: 'meta', name: 'draft' })).status).toBe(401);
    // The sheet's own words in the same list are still the player's.
    expect((await entry({ list: 'meta', name: 'Player', value: 'Ann' })).status).toBe(200);
    expect((await entry({ list: 'resources', name: 'Vigour', value: 4 })).status).toBe(200);

    const stored = (await call('GET', `/api/entities/${barrett}`, { display: seat })).body;
    const save = (entity: object) =>
      call('PUT', `/api/entities/${barrett}`, { display: seat, body: { entity } });
    expect((await save({ ...stored, type: 'vendor' })).status).toBe(401);
    expect((await save({ ...stored, refs: { from: { id: 'npc_watcher', name: 'Watcher' } } })).status).toBe(401);
    expect(
      (await save({ ...stored, lists: { ...stored.lists, meta: [...stored.lists.meta, { name: 'side', value: 'none' }] } }))
        .status,
    ).toBe(401);
    // Carried back exactly as it was read — the seat's carry does this.
    expect((await save({ ...stored, notes: 'paid one county back' })).status).toBe(200);
    expect(session.campaign.get(barrett)?.type).toBe('Marshal');

    // The DM holds them, and sets them.
    expect(
      (await call('POST', `/api/entities/${barrett}/entry`, { key: true, body: { list: 'meta', name: 'side', value: 'party' } }))
        .status,
    ).toBe(200);
  });

  // The audit's second pass: a `from` is a READ — the sheet resolves
  // through it — so a seat that could hang one anywhere on its own
  // character could read whatever it pointed at. The first check looked
  // at the top-level refs only, and let a drafting seat set those.
  it("a seat can't borrow a foe's numbers by carrying a reference to it", async () => {
    const seat = await screen('seat', { entityId: barrett });
    const stored = (await call('GET', `/api/entities/${barrett}`, { display: seat })).body;
    const save = (entity: object) =>
      call('PUT', `/api/entities/${barrett}`, { display: seat, body: { entity } });
    const carrying = (from: string, depth = 0): object => {
      let child: Record<string, unknown> = { id: 'itm_x', name: 'x', lists: {}, refs: { from: { id: from, name: from } } };
      for (let i = 0; i < depth; i++) child = { id: `itm_w${i}`, name: 'wrap', lists: {}, children: [child] };
      return { ...stored, children: [child] };
    };
    // A child pointed at the bestiary, at the top and tucked three deep.
    expect((await save(carrying('npc_watcher'))).status).toBe(401);
    expect((await save(carrying('npc_watcher', 3))).status).toBe(401);
    const read = (await call('GET', `/api/entities/${barrett}?resolved=1`, { display: seat })).body;
    expect(JSON.stringify(read)).not.toContain('Vigour","value":12');
    // The catalogue is what a seat shops, and stamping from it is carrying.
    expect((await save(carrying('cat_rifle'))).status).toBe(200);

    // A drafting seat sets its own refs — but not at a foe.
    const drafter = await screen('seat', { entityId: dolores });
    const draft = (await call('GET', `/api/entities/${dolores}`, { display: drafter })).body;
    const aimed = await call('PUT', `/api/entities/${dolores}`, {
      display: drafter,
      body: { entity: { ...draft, refs: { from: { id: 'npc_watcher', name: 'Watcher' } } } },
    });
    expect(aimed.status).toBe(401);

    // What the DM hung there stays readable and stays put.
    const given = { ...session.campaign.get(barrett)!, children: [{ id: 'itm_dm', name: 'trophy', lists: {}, refs: { from: { id: 'npc_watcher', name: 'Watcher' } } }] };
    expect((await call('PUT', `/api/entities/${barrett}`, { key: true, body: { entity: given } })).status).toBe(200);
    const kept = (await call('GET', `/api/entities/${barrett}`, { display: seat })).body;
    expect((await save({ ...kept, notes: 'still mine to write' })).status).toBe(200);
  });

  it('a character still being made may pick its trade and strike the draft mark', async () => {
    const seat = await screen('seat', { entityId: dolores });
    const stored = (await call('GET', `/api/entities/${dolores}`, { display: seat })).body;
    const named = await call('PUT', `/api/entities/${dolores}`, {
      display: seat,
      body: { entity: { ...stored, type: 'Marshal' } },
    });
    expect(named.status).toBe(200);
    const done = await call('POST', `/api/entities/${dolores}/entry`, {
      display: seat,
      body: { list: 'meta', name: 'draft', remove: true },
    });
    expect(done.status).toBe(200);
    // Finished: the trade is the DM's again.
    const after = (await call('GET', `/api/entities/${dolores}`, { display: seat })).body;
    expect(
      (await call('PUT', `/api/entities/${dolores}`, { display: seat, body: { entity: { ...after, type: 'pc' } } }))
        .status,
    ).toBe(401);
  });
});

describe('boards', () => {
  it('a watcher is told about the board on the table and no other', async () => {
    const table = await screen('table');
    const listed = await call('GET', '/api/boards', { display: table });
    expect(listed.body.map((b: any) => b.id)).toEqual([activeBoard]);
    expect((await call('GET', `/api/board-state/${activeBoard}`, { display: table })).status).toBe(200);
    const next = await call('GET', `/api/board-state/${nextBoard}`, { display: table });
    expect(next.status).toBe(404);
    expect(JSON.stringify(next.body)).not.toContain('Bandit');

    expect((await call('GET', '/api/boards', { key: true })).body).toHaveLength(2);
    expect((await call('GET', `/api/board-state/${nextBoard}`, { key: true })).body.placements).toHaveLength(1);
  });
});

describe('the file door', () => {
  it('passive glass fetches the map and the handout on show, and nothing else', async () => {
    const table = await screen('table');
    expect((await file('map/active.png', { display: table })).status).toBe(200);
    expect((await file('art/handouts/shown.png', { display: table })).status).toBe(200);
    for (const key of ['map/next.png', 'art/handouts/secret.png', 'art/pak_test/portrait.png', 'art/pak_test/foe.png']) {
      expect([key, (await file(key, { display: table })).status]).toEqual([key, 404]);
    }
  });

  it('follows the table: a board taken down takes its picture with it', async () => {
    const table = await screen('table');
    await call('PUT', '/api/campaign/refs', { key: true, body: { board: nextBoard, handout: secretHandout } });
    expect((await file('map/active.png', { display: table })).status).toBe(404);
    expect((await file('map/next.png', { display: table })).status).toBe(200);
    expect((await file('art/handouts/secret.png', { display: table })).status).toBe(200);
    expect((await file('art/handouts/shown.png', { display: table })).status).toBe(404);
  });

  it("a seat fetches the art its own reads name, and what it was passed", async () => {
    const seat = await screen('seat', { entityId: barrett });
    expect((await file('art/pak_test/portrait.png', { display: seat })).status).toBe(200);
    expect((await file('art/pak_test/foe.png', { display: seat })).status).toBe(404);
    expect((await file('art/handouts/secret.png', { display: seat })).status).toBe(404);
    expect((await file('map/next.png', { display: seat })).status).toBe(404);

    passNote(session, { to: [barrett], handout: { id: secretHandout, name: 'Secret Letter', key: 'art/handouts/secret.png' } });
    expect((await file('art/handouts/secret.png', { display: seat })).status).toBe(200);
  });

  it('the DM and a console fetch anything', async () => {
    const console_ = await screen('console');
    for (const as of [{ key: true }, { display: console_ }]) {
      for (const key of ['map/next.png', 'art/handouts/secret.png', 'art/pak_test/foe.png']) {
        expect((await file(key, as)).status).toBe(200);
      }
    }
  });

  it('never follows a link out of its root, and serves live content inert', async () => {
    expect((await file('art/pak_test/link.png', { key: true })).status).toBe(404);

    const png = await file('map/next.png', { key: true });
    expect(png.headers.get('x-content-type-options')).toBe('nosniff');
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-disposition')).toBeNull();

    const page = await file('art/pak_test/page.html', { key: true });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-disposition')).toBe('attachment');
    expect(page.headers.get('content-security-policy')).toContain('sandbox');
    expect(page.headers.get('content-type')).toBe('application/octet-stream');
  });
});

describe('a door the room can knock on', () => {
  it("hands the plugin the room's table, never the stored one", async () => {
    const blank = await screen('blank');
    const res = await call('GET', `/api/plugin/${PEEK}/peek`, { display: blank });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('owes money');
    expect(text).not.toMatch(/Bark|Dolores|Windmill|AMBUSH/);
    expect(res.body.board).toBeUndefined();
    expect(res.body.templates).toEqual({});
    expect(Object.keys(res.body.declarations)).toEqual(['kinds']);
    const foe = res.body.entities.find((e: any) => e.reading.id === watcher).reading;
    expect(foe.lists).toEqual({});
    expect(foe.vitality).toBe('healthy');
  });

  it('the stored table still reaches a door that is not the room’s', () => {
    const needs = [{ verb: 'read' as const, subject: 'entities' }];
    const stored = snapshotFor(session, needs);
    expect(JSON.stringify(stored)).toContain('owes money');
    expect(JSON.stringify(snapshotFor(session, needs, true))).not.toContain('owes money');
  });
});

describe('screens', () => {
  it("a deleted screen's open stream ends", async () => {
    const table = await screen('table');
    const slips = (await call('GET', '/api/ticket', { display: table })).body;
    const res = await fetch(
      `${base}/api/stream?handle=${encodeURIComponent(slips.handle)}&ticket=${encodeURIComponent(slips.ticket)}`,
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read(); // retry:
    await call('DELETE', `/api/displays/${table}`, { key: true });
    const decoder = new TextDecoder();
    let heard = '';
    const ended = await Promise.race([
      (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return true;
          heard += decoder.decode(value);
        }
      })(),
      new Promise<false>((r) => setTimeout(() => r(false), 2000)),
    ]);
    expect(ended).toBe(true);
    // The word that told it to look at itself still arrived first.
    expect(heard).toContain('data: assign');
  });

  it('a renamed screen keeps its stream', async () => {
    const table = await screen('table');
    const slips = (await call('GET', '/api/ticket', { display: table })).body;
    const res = await fetch(
      `${base}/api/stream?handle=${encodeURIComponent(slips.handle)}&ticket=${encodeURIComponent(slips.ticket)}`,
    );
    const reader = res.body!.getReader();
    await reader.read();
    await call('PATCH', `/api/displays/${table}`, { key: true, body: { name: 'Big Glass' } });
    session.changed('entities');
    const next = await Promise.race([
      reader.read(),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 1000)),
    ]);
    expect(next && !next.done).toBe(true);
    await reader.cancel();
  });

  it('bounds how fast new screens arrive, and never refuses one that has an id', async () => {
    const made: string[] = [];
    let refused = 0;
    for (let n = 0; n < 40; n++) {
      const res = await call('POST', '/api/displays/hello', { body: {} });
      if (res.status === 429) refused++;
      else made.push(res.body.display.id);
    }
    expect(refused).toBeGreaterThan(0);
    expect(made.length).toBeLessThanOrEqual(31);
    // A screen that already exists says hello as often as it likes.
    for (let n = 0; n < 5; n++) {
      expect((await call('POST', '/api/displays/hello', { body: { id: made[0] } })).status).toBe(200);
    }
  });

  it('bounds how many screens may wait to be adopted', async () => {
    for (let n = 0; n < 80; n++) session.shelf.createDisplay();
    const res = await call('POST', '/api/displays/hello', { body: {} });
    expect(res.status).toBe(200);
    const waiting = session.shelf.displays().filter((d) => d.code);
    expect(waiting.length).toBeLessThanOrEqual(64);
    expect(waiting.map((d) => d.id)).toContain(res.body.display.id);
  });
});
