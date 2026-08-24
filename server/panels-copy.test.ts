// `POST /api/panels/<name>/copy-to-table` — §M-6's owed concession.
//
// The merge puts the table's own `panels/` folder above everything, so
// customizing a shipped default means restating its name up there. What
// this pins is that the console can do that walk for you and that the
// walk is HONEST: the folder copied is the one whose declaration the
// table is actually rendering, the copy gets its own identity, and the
// one folder nothing may write over is the one already at the top.
//
// Real folders, same reasoning as `plugins.test.ts`: a copy is a thing
// the FILESYSTEM does, and a test that stubbed it would pin a shape the
// running host never produces.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  key: string | null = KEY,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { 'x-teller-key': key } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function json(path: string, value: unknown): void {
  write(path, JSON.stringify(value, null, 2));
}

const BLOCK = `export default function Widget() { return null; }\n`;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-copy-'));

  // A system with two panels: one plain, one carrying a block nobody
  // has enabled — the two halves of the trust question.
  const sys = join(dir, 'systems', 'wiw');
  json(join(sys, 'system.json'), { id: 'sys_wiw', name: 'The System', version: 1 });
  json(join(sys, 'panels', 'runner', 'panel.json'), {
    id: 'pan_runner00000001',
    name: 'runner',
    label: 'The Runner',
  });
  json(join(sys, 'panels', 'dial', 'panel.json'), { id: 'pan_dial000000001', name: 'dial' });
  write(join(sys, 'panels', 'dial', 'blocks', 'Widget.tsx'), BLOCK);

  shelf = openShelf(dir);
  host = new Host(shelf, dir);
  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  await api('POST', '/api/campaigns', { name: 'The Unlikely Duo', system: 'sys_wiw' });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  host.session?.campaign.close();
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

const panelsIn = async (): Promise<any[]> =>
  (await api('GET', '/api/stack/declarations/panels')).body;

describe('copying a default up to the table', () => {
  it("copies teller's own, mints a fresh id, and the copy wins the merge", async () => {
    const before = (await panelsIn()).find((p: any) => p.name === 'log');
    expect(before.id).toMatch(/^pan_/);

    const { status, body } = await api('POST', '/api/panels/log/copy-to-table');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, name: 'log', from: 'teller', code: 'none' });

    const path = join(dir, 'panels', 'log', 'panel.json');
    expect(existsSync(path)).toBe(true);
    const copied = JSON.parse(readFileSync(path, 'utf8'));
    // Identity is the id, never the name — two panels must not share one.
    expect(copied.id).toBe(body.id);
    expect(copied.id).not.toBe(before.id);
    expect(copied.name).toBe('log');

    // And it took effect without a sweep of anyone's own: the route
    // reloads, so the table's copy is what the merge answers with.
    const after = (await panelsIn()).find((p: any) => p.name === 'log');
    expect(after.id).toBe(body.id);
    const table = (await api('GET', '/api/plugins')).body.containers.find(
      (c: any) => c.kind === 'table',
    );
    expect(table.panels.map((p: any) => p.name)).toEqual(['log']);
  });

  it("copies a system's panel folder, code and all, from wherever it lies", async () => {
    const { status, body } = await api('POST', '/api/panels/dial/copy-to-table');
    expect(status).toBe(200);
    expect(body.from).toBe('system:sys_wiw');
    expect(existsSync(join(dir, 'panels', 'dial', 'blocks', 'Widget.tsx'))).toBe(true);
    // The source's compile output is never carried over — the sweep the
    // copy triggers builds the copy's own from its own sources.
    expect(existsSync(join(dir, 'panels', 'dial', '.build', 'blocks', 'Widget.js'))).toBe(true);
    // Nobody had said yes to the system's block, and copying is not an
    // answer to that question — it is a decision about where a file lives.
    expect(body.code).toBe('pending');
  });

  it('carries the trust forward when the code was already running here', async () => {
    await api('POST', '/api/plugins/pan_dial000000001', { enabled: true });
    const { body } = await api('POST', '/api/panels/dial/copy-to-table');
    expect(body.code).toBe('enabled');
    const dial = (await panelsIn()).find((p: any) => p.name === 'dial');
    expect(dial.id).toBe(body.id);
    expect(dial.code).toBeDefined();
  });

  it('refuses to write over the table\'s own file', async () => {
    await api('POST', '/api/panels/log/copy-to-table');
    const first = JSON.parse(readFileSync(join(dir, 'panels', 'log', 'panel.json'), 'utf8'));

    const { status, body } = await api('POST', '/api/panels/log/copy-to-table');
    expect(status).toBe(409);
    expect(String(body.error)).toContain('already');
    // Untouched — a refusal that had edited the file would be the one
    // thing this route may never do.
    const still = JSON.parse(readFileSync(join(dir, 'panels', 'log', 'panel.json'), 'utf8'));
    expect(still.id).toBe(first.id);
  });

  it('says so for a name nothing on the shelf declares', async () => {
    const { status } = await api('POST', '/api/panels/nowhere/copy-to-table');
    expect(status).toBe(404);
  });

  it('is the DM\'s alone', async () => {
    const { status } = await api('POST', '/api/panels/log/copy-to-table', undefined, null);
    expect(status).toBe(401);
    expect(existsSync(join(dir, 'panels', 'log'))).toBe(false);
  });

  it('appends to the event log like every other mutation (rule 3)', async () => {
    const { body } = await api('POST', '/api/panels/log/copy-to-table');
    const events = (await api('GET', '/api/events?limit=10')).body;
    const row = events.find((e: any) => e.kind === 'panel.copied');
    expect(row.payload).toMatchObject({ name: 'log', from: 'teller', id: body.id });
  });
});

describe('the code door and what a browser may keep', () => {
  // The fixture above already carries a compiled block, so this is the
  // cheapest place to ask the question the stale-bundle afternoon
  // raised: does a served module say how long it is good for?

  it('a stamped url is immutable, and the same bytes unstamped revalidate', async () => {
    await api('POST', '/api/plugins/pan_dial000000001', { enabled: true });
    const dial = (await panelsIn()).find((p: any) => p.name === 'dial');
    const url: string = dial.code.blocks.Widget;
    expect(url).toMatch(/^\/panel-code\/pan_dial000000001\/blocks\/Widget\.js\?v=[0-9a-z]+$/);

    const stamped = await fetch(`${base}${url}`);
    expect(stamped.status).toBe(200);
    expect(stamped.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    // Strip the stamp and the promise goes with it — the url no longer
    // names a build, so it has to be asked about every time.
    const bare = await fetch(`${base}${url.split('?')[0]}`);
    expect(bare.status).toBe(200);
    expect(bare.headers.get('cache-control')).toBe('no-cache');
  });

  it('an untrusted panel serves no bytes — trust gates the door, not just the url', async () => {
    // Enabled: the bytes flow. Disabled: the same path is a 404, because
    // a branded panel's code can carry the book's prose in its strings,
    // and nothing leaves for a thing nobody enabled (the audit's one
    // refutation, closed).
    await api('POST', '/api/plugins/pan_dial000000001', { enabled: true });
    const dial = (await panelsIn()).find((p: any) => p.name === 'dial');
    const url: string = dial.code.blocks.Widget.split('?')[0];
    expect((await fetch(`${base}${url}`)).status).toBe(200);

    await api('POST', '/api/plugins/pan_dial000000001', { enabled: false });
    expect((await fetch(`${base}${url}`)).status).toBe(404);
    await api('POST', '/api/plugins/pan_dial000000001', { enabled: true });
  });

  it('the generated system module is never stored — it has no build to name', async () => {
    const res = await fetch(`${base}/pack-code/system.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
