import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';

let dir: string;
let session: Session;
let server: Server;
let base: string;

/** These tests hold the key throughout — auth's own tests live in auth.test.ts. */
const KEY = 'test-key-0123456789abcdef';

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'x-teller-key': KEY,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-server-'));
  const shelf = openShelf(dir);
  shelf.putSystem({
    id: 'sys_wiw',
    name: 'WiW',
    version: 1,
    data: {
      kinds: [{ name: 'conditions', domain: { kind: 'count', zero: 'clears' } }],
    },
  });
  shelf.putPack({
    id: 'pak_guide',
    system: 'sys_wiw',
    name: 'Guidebook',
    data: {
      bestiary: [
        {
          id: 'npc_bark_watcher',
          name: 'Bark Watcher',
          type: 'foe',
          lists: { resources: [{ name: 'Health', value: 12, max: 12 }] },
        },
      ],
    },
  });
  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  const root = campaign.root();
  campaign.save(
    { ...root, refs: { system: { id: 'sys_wiw', name: 'WiW' } } },
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

describe('the campaign endpoint', () => {
  it('says what loaded and what is missing', async () => {
    const { status, body } = await api('GET', '/api/campaign');
    expect(status).toBe(200);
    expect(body.slug).toBe('duo');
    expect(body.system.id).toBe('sys_wiw');
    expect(body.packs.map((p: any) => p.id)).toEqual(['pak_guide']);
    expect(body.missing).toEqual([]);
    expect(body.manifest.name).toBe('The Unlikely Duo');
  });
});

describe('entities over HTTP', () => {
  it('create → roster → read → save → delete, each logged', async () => {
    const made = await api('POST', '/api/entities', {
      draft: {
        name: 'Barrett',
        type: 'character',
        lists: { resources: [{ name: 'Grit', value: 2, max: 3 }] },
      },
      actor: 'dm',
    });
    expect(made.status).toBe(201);
    const id = made.body.id;

    const roster = await api('GET', '/api/entities');
    expect(roster.body).toEqual([
      { id, name: 'Barrett', type: 'character' },
    ]);

    made.body.lists.resources[0].value = 1;
    const saved = await api('PUT', `/api/entities/${id}`, {
      entity: made.body,
      actor: 'seat:barrett',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.lists.resources[0].value).toBe(1);

    const events = await api('GET', `/api/events?entity=${id}`);
    expect(events.body.map((e: any) => e.kind)).toEqual([
      'entity.updated',
      'entity.created',
    ]);
    expect(events.body[0].actor).toBe('seat:barrett');

    await api('DELETE', `/api/entities/${id}`);
    expect((await api('GET', `/api/entities/${id}`)).status).toBe(404);
  });

  it('a nameless draft is a 400, not a row', async () => {
    const { status } = await api('POST', '/api/entities', { draft: {} });
    expect(status).toBe(400);
    expect(await api('GET', '/api/entities').then((r) => r.body)).toEqual([]);
  });
});

describe('stamping over HTTP', () => {
  it('stamps thin from the merged stack and resolves at read', async () => {
    const stamped = await api('POST', '/api/stamp', {
      slot: 'bestiary',
      templateId: 'npc_bark_watcher',
      name: 'Bark Watcher 1',
      actor: 'dm',
    });
    expect(stamped.status).toBe(201);
    expect(stamped.body.lists).toEqual({});
    expect(stamped.body.refs.from.id).toBe('npc_bark_watcher');

    const raw = await api('GET', `/api/entities/${stamped.body.id}`);
    expect(raw.body.lists).toEqual({});
    const resolved = await api(
      'GET',
      `/api/entities/${stamped.body.id}?resolved=1`,
    );
    expect(resolved.body.lists.resources).toEqual([
      { name: 'Health', value: 12, max: 12 },
    ]);
  });

  it('a template nobody has is a 404 naming the miss', async () => {
    const { status, body } = await api('POST', '/api/stamp', {
      slot: 'bestiary',
      templateId: 'npc_gone',
    });
    expect(status).toBe(404);
    expect(body.error).toMatch(/npc_gone/);
  });
});

describe('the stack endpoints', () => {
  it('serves merged templates and declarations', async () => {
    const templates = await api('GET', '/api/stack/templates/bestiary');
    expect(templates.body.map((t: any) => t.id)).toEqual(['npc_bark_watcher']);
    const declarations = await api('GET', '/api/stack/declarations/statuses');
    expect(declarations.body).toEqual([]);
  });
});

describe('the sparse write (the seat\'s door)', () => {
  async function stampOne(): Promise<string> {
    const stamped = await api('POST', '/api/stamp', {
      slot: 'bestiary',
      templateId: 'npc_bark_watcher',
      name: 'Watcher 1',
    });
    return stamped.body.id;
  }

  it('copies the touched entry down from the template, and only that', async () => {
    const id = await stampOne();
    const hit = await api('POST', `/api/entities/${id}/entry`, {
      list: 'resources',
      name: 'health', // wrong case on purpose
      value: 9,
    });
    expect(hit.status).toBe(200);
    // Stored: exactly one entry, with the TEMPLATE's spelling and max.
    expect(hit.body.stored.lists).toEqual({
      resources: [{ name: 'Health', value: 9, max: 12 }],
    });
    // Reads: the stored touch over the template underneath.
    expect(hit.body.reads.lists.resources).toEqual([
      { name: 'Health', value: 9, max: 12 },
    ]);
    // The template itself never moved.
    const stack = await api('GET', '/api/stack/templates/bestiary');
    expect(stack.body[0].lists.resources[0].value).toBe(12);
  });

  it('a declared kind clears at zero; an undeclared one keeps it', async () => {
    const id = await stampOne();
    await api('POST', `/api/entities/${id}/entry`, {
      list: 'conditions',
      name: 'Trapped',
      value: 2,
    });
    const eased = await api('POST', `/api/entities/${id}/entry`, {
      list: 'conditions',
      name: 'Trapped',
      value: 0,
    });
    expect(eased.body.stored.lists.conditions).toBeUndefined();

    // Resources made no such declaration: zero is a fact on the sheet.
    const spent = await api('POST', `/api/entities/${id}/entry`, {
      list: 'resources',
      name: 'Health',
      value: 0,
    });
    expect(spent.body.stored.lists.resources).toEqual([
      { name: 'Health', value: 0, max: 12 },
    ]);
  });

  it('remove is a human act and works on any entry', async () => {
    const id = await stampOne();
    await api('POST', `/api/entities/${id}/entry`, {
      list: 'descriptors',
      name: 'Gunslinger',
    });
    const gone = await api('POST', `/api/entities/${id}/entry`, {
      list: 'descriptors',
      name: 'Gunslinger',
      remove: true,
    });
    expect(gone.body.stored.lists.descriptors).toBeUndefined();
  });
});

describe('board state over HTTP', () => {
  it('round-trips and never touches the shelf', async () => {
    const put = await api('PUT', '/api/board-state/brd_canyon', {
      data: { placements: [{ label: 'rock', u: 1, v: 2 }] },
      actor: 'dm',
    });
    expect(put.status).toBe(200);
    const got = await api('GET', '/api/board-state/brd_canyon');
    expect(got.body.placements[0].label).toBe('rock');
  });
});

describe('the stream', () => {
  it('nudges subscribers when anything changes', async () => {
    const slip = await api('GET', '/api/ticket');
    expect(slip.body.handle).toBe('dm');
    const res = await fetch(
      `${base}/api/stream?handle=${slip.body.handle}&ticket=${slip.body.ticket}`,
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const drain = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
        if (text.includes('data: entities')) break;
      }
    })();
    // Let the subscription land before mutating.
    await new Promise((r) => setTimeout(r, 50));
    expect(session.watching).toBe(1);
    await api('POST', '/api/entities', { draft: { name: 'Sal' } });
    await drain;
    expect(text).toContain('data: entities');
    await reader.cancel();
  });
});

describe('/pack-code — the `system` specifier and the bytes behind it', () => {
  it('system.js is a valid EMPTY module when no pack supplies code', async () => {
    const res = await fetch(`${base}/pack-code/system.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toBe('export {};\n');
  });

  it('an unknown pack id is 404, and so is a path climbing out of .build', async () => {
    expect((await fetch(`${base}/pack-code/pak_nope/presentations/X.js`)).status).toBe(404);
    expect((await fetch(`${base}/pack-code/pak_guide/../../pack.json`)).status).toBe(404);
  });
});

describe('the shelf listing', () => {
  /**
   * The listing has to tell the same story the loader lives: a folder
   * beats a row, per id (`loadCampaign`). It didn't, and the console
   * spent a session announcing a version nothing was running.
   */
  it('reads a folder over the row of the same id, and lists a folder with no row', async () => {
    mkdirSync(join(dir, 'systems', 'wiw'), { recursive: true });
    writeFileSync(
      join(dir, 'systems', 'wiw', 'system.json'),
      JSON.stringify({ id: 'sys_wiw', name: 'Wild Imaginary West', version: 22 }),
    );
    mkdirSync(join(dir, 'packs', 'guidebook'), { recursive: true });
    writeFileSync(
      join(dir, 'packs', 'guidebook', 'pack.json'),
      JSON.stringify({ id: 'pak_guide', system: 'sys_wiw', name: 'WiW Guidebook', version: 7 }),
    );
    mkdirSync(join(dir, 'packs', 'homebrew'), { recursive: true });
    writeFileSync(
      join(dir, 'packs', 'homebrew', 'pack.json'),
      JSON.stringify({ id: 'pak_brew', system: 'sys_wiw', name: 'Brew', version: 1 }),
    );

    // A session that knows its data dir is the only one with folders to
    // sweep — the shared one above deliberately has none.
    const rooted = new Session(openShelf(dir), openCampaign(dir, 'duo'), dir);
    const server2 = serve(rooted, 0, KEY);
    await new Promise((r) => server2.on('listening', r));
    const port = (server2.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://localhost:${port}/api/shelf`, {
        headers: { 'x-teller-key': KEY },
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      // The rows say v1; the folders say otherwise, and the folders win.
      expect(body.systems).toContainEqual({
        id: 'sys_wiw',
        name: 'Wild Imaginary West',
        version: 22,
      });
      expect(body.packs).toContainEqual({
        id: 'pak_guide',
        system: 'sys_wiw',
        name: 'WiW Guidebook',
        version: 7,
      });
      // Folder-only, no row at all — it loads, so it lists.
      expect(body.packs).toContainEqual({
        id: 'pak_brew',
        system: 'sys_wiw',
        name: 'Brew',
        version: 1,
      });
      // Shadowing, not duplicating.
      expect(body.systems.filter((s: any) => s.id === 'sys_wiw')).toHaveLength(1);
      expect(body.packs.filter((p: any) => p.id === 'pak_guide')).toHaveLength(1);
    } finally {
      await new Promise((r) => server2.close(r));
      rooted.close();
    }
  });
});
