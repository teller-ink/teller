// The campaign screen's half of the server: which story this table is
// running, and the manifest refs that say what it runs ON.
//
// One host, one active campaign, every screen follows (rule 9). The
// things worth pinning here are the ones that would rot silently: that
// a bare host BOOTS instead of exiting, that the listeners survive a
// swap (they live on the Room, not the Session), and that an emptied
// pack list restores the default rather than meaning "no packs".

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShelf, type Shelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Host } from './session.ts';

let dir: string;
let shelf: Shelf;
let host: Host;
let server: Server;
let base: string;

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
  dir = mkdtempSync(join(tmpdir(), 'teller-campaigns-'));
  shelf = openShelf(dir);
  shelf.putSystem({ id: 'sys_wiw', name: 'WiW', version: 1, data: {} });
  shelf.putSystem({ id: 'sys_other', name: 'Other', version: 1, data: {} });
  shelf.putPack({ id: 'pak_one', system: 'sys_wiw', name: 'One', data: {} });
  shelf.putPack({ id: 'pak_two', system: 'sys_wiw', name: 'Two', data: {} });
  // A bare host on purpose: no campaign at all, which used to exit.
  host = new Host(shelf, dir);
  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  host.session?.campaign.close();
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('a host with no campaign', () => {
  it('serves anyway, and says so rather than failing the key', async () => {
    const { status, body } = await api('GET', '/api/campaign');
    expect(status).toBe(200);
    expect(body.slug).toBeNull();
    expect(body.packs).toEqual([]);
  });

  it('refuses the table routes with a 503, not a 401', async () => {
    expect((await api('GET', '/api/entities')).status).toBe(503);
    expect((await api('GET', '/api/turn')).status).toBe(503);
  });

  it('lists nothing, then lists what it was told to start', async () => {
    expect((await api('GET', '/api/campaigns')).body).toEqual({
      active: null,
      campaigns: [],
    });
    const made = await api('POST', '/api/campaigns', {
      name: 'The Unlikely Duo',
      system: 'sys_wiw',
    });
    expect(made.status).toBe(201);
    // The slug is DERIVED — nobody types a filename.
    expect(made.body.slug).toBe('the-unlikely-duo');
    // Creating plays it: the DM just made it to run it.
    const campaign = await api('GET', '/api/campaign');
    expect(campaign.body.slug).toBe('the-unlikely-duo');
    expect(campaign.body.system.id).toBe('sys_wiw');
    // And the table's routes are open again.
    expect((await api('GET', '/api/entities')).status).toBe(200);
  });
});

describe('switching campaigns', () => {
  beforeEach(async () => {
    await api('POST', '/api/campaigns', { name: 'First', system: 'sys_wiw' });
    await api('POST', '/api/entities', { draft: { name: 'Barrett' } });
    await api('POST', '/api/campaigns', { name: 'Second', system: 'sys_other' });
  });

  it('marks the active one and switches on demand', async () => {
    const listed = await api('GET', '/api/campaigns');
    expect(listed.body.active).toBe('second');
    expect(listed.body.campaigns.map((c: any) => c.slug).sort()).toEqual([
      'first',
      'second',
    ]);
    expect(listed.body.campaigns.find((c: any) => c.slug === 'first').system).toEqual({
      id: 'sys_wiw',
      name: 'WiW',
      installed: true,
    });

    // The second one is its own file — the first one's roster isn't here.
    expect((await api('GET', '/api/entities')).body).toEqual([]);

    const back = await api('POST', '/api/campaigns/first/activate');
    expect(back.status).toBe(200);
    expect((await api('GET', '/api/entities')).body.map((e: any) => e.name)).toEqual([
      'Barrett',
    ]);
  });

  it('remembers the choice on the shelf, so a reboot resumes it', async () => {
    await api('POST', '/api/campaigns/first/activate');
    expect(shelf.setting('campaign')).toBe('first');
  });

  it('a campaign nobody has is a 404 naming it', async () => {
    const { status, body } = await api('POST', '/api/campaigns/nope/activate');
    expect(status).toBe(404);
    expect(body.error).toMatch(/nope/);
  });

  it('keeps every listener across the swap, and nudges before it', async () => {
    const slip = await api('GET', '/api/ticket');
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
        // The nudge that proves the OLD subscription is still live on
        // the NEW session — it happens after the swap.
        if (text.includes('data: entities')) break;
      }
    })();
    await new Promise((r) => setTimeout(r, 50));
    await api('POST', '/api/campaigns/first/activate');
    await api('POST', '/api/entities', { draft: { name: 'Sal' } });
    await drain;
    expect(text).toContain('data: campaign');
    expect(text).toContain('data: entities');
    await reader.cancel();
  });
});

describe('the campaign stack', () => {
  beforeEach(async () => {
    await api('POST', '/api/campaigns', { name: 'Stack', system: 'sys_wiw' });
  });

  it('runs every pack for the system when nothing is declared', async () => {
    const { body } = await api('GET', '/api/campaign');
    expect(body.packs.map((p: any) => p.id)).toEqual(['pak_one', 'pak_two']);
    expect(body.manifest.refs.packs).toBeUndefined();
  });

  it('declares an order, and the declaration is what loads', async () => {
    const put = await api('PUT', '/api/campaign/refs', {
      packs: ['pak_two', 'pak_one'],
    });
    expect(put.status).toBe(200);
    expect(put.body.packs.map((p: any) => p.id)).toEqual(['pak_two', 'pak_one']);
    const after = await api('GET', '/api/campaign');
    expect(after.body.manifest.refs.packs.map((r: any) => r.id)).toEqual([
      'pak_two',
      'pak_one',
    ]);
  });

  it('an emptied list restores the default rather than meaning none', async () => {
    await api('PUT', '/api/campaign/refs', { packs: ['pak_two'] });
    expect((await api('GET', '/api/campaign')).body.packs).toHaveLength(1);
    await api('PUT', '/api/campaign/refs', { packs: null });
    const back = await api('GET', '/api/campaign');
    expect(back.body.manifest.refs.packs).toBeUndefined();
    expect(back.body.packs.map((p: any) => p.id)).toEqual(['pak_one', 'pak_two']);
    // An empty ARRAY says the same thing — a box nobody ticked.
    await api('PUT', '/api/campaign/refs', { packs: ['pak_two'] });
    await api('PUT', '/api/campaign/refs', { packs: [] });
    expect((await api('GET', '/api/campaign')).body.packs).toHaveLength(2);
  });

  it('changes the system, and can take it away', async () => {
    const put = await api('PUT', '/api/campaign/refs', { system: 'sys_other' });
    expect(put.body.system.id).toBe('sys_other');
    // Different system, so none of WiW's packs apply by default.
    expect(put.body.packs).toEqual([]);
    const off = await api('PUT', '/api/campaign/refs', { system: null });
    expect(off.body.system).toBeNull();
  });

  it('a system nobody has on the shelf is a 400, not a dangling ref', async () => {
    const { status, body } = await api('PUT', '/api/campaign/refs', {
      system: 'sys_ghost',
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/sys_ghost/);
  });

  it('a declared pack that is missing is reported, never dropped', async () => {
    const put = await api('PUT', '/api/campaign/refs', {
      packs: ['pak_one', 'pak_ghost'],
    });
    expect(put.body.packs.map((p: any) => p.id)).toEqual(['pak_one']);
    expect(put.body.missing).toEqual([
      { slot: 'pack', ref: { id: 'pak_ghost', name: 'pak_ghost' } },
    ]);
  });
});

describe('a system that exists only as a folder', () => {
  // §M's normal case: `systems/<name>/`, no `shelf.db` row behind it at
  // all. The LOADER resolves one, and `/api/shelf` lists one, so the
  // dropdown offers it — but creation used to validate against the rows
  // alone and refused the system the console had just been shown.
  beforeEach(() => {
    const folder = join(dir, 'systems', 'folded');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'system.json'),
      JSON.stringify({ id: 'sys_folded', name: 'Folded', version: 2, kinds: [{ name: 'counter' }] }),
    );
  });

  it('is on the shelf the dropdown reads — on a host with nothing running', async () => {
    // The whole bootstrap, on a VIRGIN host: the shelf is inventory, not
    // table state, so it answers before any campaign exists — and what
    // the dropdown offers is what creation then takes.
    const { status, body } = await api('GET', '/api/shelf');
    expect(status).toBe(200);
    expect(body.systems).toContainEqual({ id: 'sys_folded', name: 'Folded', version: 2 });
    const made = await api('POST', '/api/campaigns', {
      name: 'First Ever',
      system: body.systems.find((s: any) => s.id === 'sys_folded').id,
    });
    expect(made.status).toBe(201);
  });

  it('is accepted at creation, and is what the new campaign loads', async () => {
    const made = await api('POST', '/api/campaigns', {
      name: 'Folded Tale',
      system: 'sys_folded',
    });
    expect(made.status).toBe(201);

    const campaign = await api('GET', '/api/campaign');
    expect(campaign.body.manifest.refs.system).toEqual({ id: 'sys_folded', name: 'Folded' });
    // Loading resolves the FOLDER — its version, not a row's.
    expect(campaign.body.system).toMatchObject({ id: 'sys_folded', name: 'Folded', version: 2 });
    expect(campaign.body.missing).toEqual([]);
  });

  it('reads as installed in the listing, not as a system nobody has', async () => {
    await api('POST', '/api/campaigns', { name: 'Folded Tale', system: 'sys_folded' });
    const listed = await api('GET', '/api/campaigns');
    expect(listed.body.campaigns.find((c: any) => c.slug === 'folded-tale').system).toEqual({
      id: 'sys_folded',
      name: 'Folded',
      installed: true,
    });
  });

  it('can be switched onto, the same reading the refs screen uses', async () => {
    await api('POST', '/api/campaigns', { name: 'Rowed', system: 'sys_wiw' });
    const put = await api('PUT', '/api/campaign/refs', { system: 'sys_folded' });
    expect(put.status).toBe(200);
    expect(put.body.system).toMatchObject({ id: 'sys_folded', version: 2 });
  });

  it('a system nobody has at all is still a 400 naming it', async () => {
    const { status, body } = await api('POST', '/api/campaigns', {
      name: 'Ghosted',
      system: 'sys_ghost',
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/sys_ghost/);
  });
});

describe('trust, listed so it can be taken back', () => {
  beforeEach(async () => {
    await api('POST', '/api/campaigns', { name: 'Trust', system: 'sys_wiw' });
  });

  it('names the enabled content code, and forgets it when revoked', async () => {
    await api('POST', '/api/plugins/pak_one', { enabled: true });
    const on = await api('GET', '/api/plugins');
    expect(on.body.trusted).toEqual([{ id: 'pak_one', name: 'One', kind: 'pack' }]);

    await api('POST', '/api/plugins/pak_one', { enabled: false });
    expect((await api('GET', '/api/plugins')).body.trusted).toEqual([]);
  });

  it('an ordinary plugin id never appears there — only content code', async () => {
    await api('POST', '/api/plugins/plg_something', { enabled: true });
    expect((await api('GET', '/api/plugins')).body.trusted).toEqual([]);
  });
});

describe('the system teller ships', () => {
  // A virgin data dir used to offer ZERO systems, and the campaign
  // screen — the only screen a host with nothing running has — was a
  // dead end. Starter ships in the INSTALL (§M-6, 2026-08-21): never
  // seeded, never written anywhere, and last in the fallback.

  it('is offered on a shelf with nothing on it, and creation takes it', async () => {
    const listed = await api('GET', '/api/shelf');
    expect(listed.body.systems.map((s: any) => s.id)).toContain('sys_starter');

    const made = await api('POST', '/api/campaigns', {
      name: 'First Table',
      system: 'sys_starter',
    });
    expect(made.status).toBe(201);

    const campaign = await api('GET', '/api/campaign');
    expect(campaign.body.system).toMatchObject({ id: 'sys_starter', name: 'Starter' });
    expect(campaign.body.missing).toEqual([]);
    // The play screens arrive with it — the thing a bare host lacked.
    const panels = await api('GET', '/api/stack/declarations/panels');
    expect(panels.body.map((p: any) => p.name)).toContain('encounters');
  });

  it('is read from the install: nothing is written into the data dir', async () => {
    await api('POST', '/api/campaigns', { name: 'First Table', system: 'sys_starter' });
    expect(existsSync(join(dir, 'systems'))).toBe(false);
  });

  it('is outranked by a shelf system of the same id', async () => {
    const folder = join(dir, 'systems', 'starter');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'system.json'),
      JSON.stringify({ id: 'sys_starter', name: 'My Own Starter', version: 4 }),
    );
    const listed = await api('GET', '/api/shelf');
    expect(listed.body.systems.filter((s: any) => s.id === 'sys_starter')).toEqual([
      { id: 'sys_starter', name: 'My Own Starter', version: 4 },
    ]);
  });
});
