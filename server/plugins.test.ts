// `/api/plugins` — the console's trust screen, grouped by WHERE IT CAME
// FROM.
//
// The old endpoint answered with the trust TABLE's shape (a flat list of
// grants), which meant the console could say "this panel carries code"
// without ever saying which book it arrived in. The grouping is the
// fix, so what's pinned here is the grouping: that a system's panels
// list under the system, a pack's under the pack, teller's five under
// no container at all, and that a grant nothing accounts for still
// surfaces somewhere it can be taken back.
//
// Real folders on purpose. A code-carrying panel is a thing the SWEEP
// makes — compile output plus a trust row — and a test that faked it
// with a hand-written `codePending` would assert a state the running
// host can never produce.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function json(path: string, value: unknown): void {
  write(path, JSON.stringify(value, null, 2));
}

const BLOCK = `export default function Widget() { return null; }\n`;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-plugins-'));

  // A system folder: two panels, one carrying code and one not, plus
  // enough cargo for the summary line to have something to count.
  const sys = join(dir, 'systems', 'wiw');
  json(join(sys, 'system.json'), {
    id: 'sys_wiw',
    name: 'Wild Imaginary West',
    version: 3,
    statuses: [{ name: 'Trapped' }, { name: 'Afraid' }],
    kinds: [{ name: 'counter' }],
  });
  json(join(sys, 'panels', 'runner', 'panel.json'), {
    id: 'pan_runner00000001',
    name: 'runner',
    label: 'The Runner',
  });
  json(join(sys, 'panels', 'dial', 'panel.json'), {
    id: 'pan_dial000000001',
    name: 'dial',
  });
  write(join(sys, 'panels', 'dial', 'blocks', 'Widget.tsx'), BLOCK);

  // A pack folder on the same system: one panel, no code of its own.
  const pak = join(dir, 'packs', 'guidebook');
  json(join(pak, 'pack.json'), {
    id: 'pak_guide00000001',
    system: 'sys_wiw',
    name: 'WiW Guidebook',
    version: 2,
  });
  json(join(pak, 'bestiary.json'), [{ id: 'bes_a', name: 'Rattler' }, { id: 'bes_b', name: 'Coyote' }]);
  json(join(pak, 'panels', 'sheet', 'panel.json'), {
    id: 'pan_sheet00000001',
    name: 'wiw-sheet',
    label: 'WiW Sheet',
  });

  shelf = openShelf(dir);
  // A row UNDER the folder, on purpose: the folder shadows it — "a
  // folder beats a row" (§11) — which is why the name and version the
  // endpoint answers with are the folder's, not these. (It used to be
  // here because creation could only pick a system off the rows; that
  // was the bug, and creation now reads the shelf the loader reads.)
  shelf.putSystem({ id: 'sys_wiw', name: 'stale row', version: 1, data: {} });
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

const containerOf = (body: any, id: string) =>
  body.containers.find((c: any) => c.id === id);

describe('the grouped reading', () => {
  it('groups the system, its panels, and its own code state', async () => {
    const { status, body } = await api('GET', '/api/plugins');
    expect(status).toBe(200);
    const system = containerOf(body, 'sys_wiw');
    expect(system).toMatchObject({
      kind: 'system',
      name: 'Wild Imaginary West',
      version: 3,
      // No `presentations/` folder — "no code" is a state the console says.
      code: 'none',
      trusted: false,
    });
    // Cargo counts what the layer holds, in the layer's own words —
    // and never the panels, which are the container's children.
    expect(system.cargo).toEqual({ statuses: 2, kinds: 1 });

    const panels = Object.fromEntries(system.panels.map((p: any) => [p.name, p]));
    expect(Object.keys(panels).sort()).toEqual(['dial', 'runner']);
    // The one with `blocks/*.tsx` compiled and is waiting on a human.
    expect(panels.dial).toMatchObject({ id: 'pan_dial000000001', code: 'pending', trusted: false });
    // The declaration-only one says so rather than pretending to a gate.
    expect(panels.runner).toMatchObject({ code: 'none', label: 'The Runner' });
  });

  it('groups the pack under itself, never under the system', async () => {
    const { body } = await api('GET', '/api/plugins');
    const pack = containerOf(body, 'pak_guide00000001');
    expect(pack).toMatchObject({ kind: 'pack', name: 'WiW Guidebook', version: 2, code: 'none' });
    expect(pack.cargo).toEqual({ bestiary: 2 });
    expect(pack.panels.map((p: any) => p.name)).toEqual(['wiw-sheet']);
    // And the system's list didn't quietly absorb it.
    expect(containerOf(body, 'sys_wiw').panels.map((p: any) => p.name)).not.toContain('wiw-sheet');
  });

  it("lists teller's own seven as the floor, data-only", async () => {
    const { body } = await api('GET', '/api/plugins');
    const teller = body.containers.find((c: any) => c.kind === 'teller');
    expect(teller.panels.map((p: any) => p.name).sort()).toEqual([
      'boards',
      'books',
      'handouts',
      'log',
      'plugins',
      'screens',
      'shelf',
    ]);
    expect(teller.panels.every((p: any) => p.code === 'none')).toBe(true);
  });

  it('gives this table its own group, empty until someone writes there', async () => {
    const { body } = await api('GET', '/api/plugins');
    const table = body.containers.find((c: any) => c.kind === 'table');
    expect(table).toBeDefined();
    expect(table.panels).toEqual([]);

    json(join(dir, 'panels', 'mine', 'panel.json'), { id: 'pan_mine00000001', name: 'log' });
    await api('POST', '/api/shelf/sweep');
    const after = await api('GET', '/api/plugins');
    const mine = after.body.containers.find((c: any) => c.kind === 'table');
    expect(mine.panels.map((p: any) => p.name)).toEqual(['log']);
    // The table restated teller's word and wins — but teller's copy is
    // still listed under teller, because that IS the stack.
    const teller = after.body.containers.find((c: any) => c.kind === 'teller');
    expect(teller.panels.map((p: any) => p.name)).toContain('log');
  });

  it('turns pending into enabled through the same toggle, in place', async () => {
    await api('POST', '/api/plugins/pan_dial000000001', { enabled: true });
    const { body } = await api('GET', '/api/plugins');
    const dial = containerOf(body, 'sys_wiw').panels.find((p: any) => p.name === 'dial');
    expect(dial).toMatchObject({ code: 'enabled', trusted: true });
    // Which is the whole point of the rewrite: the row that offered
    // "enable" is the row that now offers "disable".
    expect(body.unresolved).toEqual([]);
  });
});

describe('a grant nothing accounts for', () => {
  it('surfaces as unresolved, so it can be taken back', async () => {
    await api('POST', '/api/plugins/pak_ghost0000001', { enabled: true });
    const { body } = await api('GET', '/api/plugins');
    expect(body.unresolved).toEqual([{ id: 'pak_ghost0000001' }]);

    await api('POST', '/api/plugins/pak_ghost0000001', { enabled: false });
    expect((await api('GET', '/api/plugins')).body.unresolved).toEqual([]);
  });

  it('an ordinary plugin id is never unresolved — only content code rides that list', async () => {
    await api('POST', '/api/plugins/plg_something', { enabled: true });
    expect((await api('GET', '/api/plugins')).body.unresolved).toEqual([]);
  });

  it('a grant on something the stack DOES hold is not unresolved', async () => {
    await api('POST', '/api/plugins/pan_dial000000001', { enabled: true });
    expect((await api('GET', '/api/plugins')).body.unresolved).toEqual([]);
  });
});

describe('a panel switched off (the trust row as an on/off switch)', () => {
  // Disabling used to gate code and nothing else, so a data-only panel
  // stayed in the merge with its tab intact and no way back. These pin
  // the round trip: out of the merge, still on the screen, reversible.

  const panelsIn = async (): Promise<string[]> =>
    (await api('GET', '/api/stack/declarations/panels')).body.map((p: any) => p.name);

  it('leaves the merged declarations, through the same POST, without a restart', async () => {
    expect(await panelsIn()).toContain('runner');
    await api('POST', '/api/plugins/pan_runner00000001', { enabled: false });
    expect(await panelsIn()).not.toContain('runner');
    await api('POST', '/api/plugins/pan_runner00000001', { enabled: true });
    expect(await panelsIn()).toContain('runner');
  });

  it('still lists under its container, marked off, with the switch to bring it back', async () => {
    await api('POST', '/api/plugins/pan_runner00000001', { enabled: false });
    const { body } = await api('GET', '/api/plugins');
    const runner = containerOf(body, 'sys_wiw').panels.find((p: any) => p.name === 'runner');
    expect(runner).toMatchObject({ id: 'pan_runner00000001', disabled: true, trusted: false });
    // And it is not an orphan grant — the stack accounts for it.
    expect(body.unresolved).toEqual([]);
  });

  it("switches off one of teller's five, and only that one", async () => {
    const { body } = await api('GET', '/api/plugins');
    const teller = body.containers.find((c: any) => c.kind === 'teller');
    const log = teller.panels.find((p: any) => p.name === 'log');
    expect(log.disabled).toBe(false);

    await api('POST', `/api/plugins/${log.id}`, { enabled: false });
    expect((await panelsIn()).sort()).not.toContain('log');
    const after = await api('GET', '/api/plugins');
    const tellerAfter = after.body.containers.find((c: any) => c.kind === 'teller');
    expect(tellerAfter.panels.find((p: any) => p.name === 'log').disabled).toBe(true);
    expect(tellerAfter.panels.filter((p: any) => p.disabled).length).toBe(1);
  });

  it("a switched-off system panel doesn't take the table's restatement with it", async () => {
    json(join(dir, 'panels', 'mine', 'panel.json'), {
      id: 'pan_mine00000001',
      name: 'runner',
      label: 'Our Runner',
    });
    await api('POST', '/api/shelf/sweep');
    await api('POST', '/api/plugins/pan_runner00000001', { enabled: false });

    const panels = (await api('GET', '/api/stack/declarations/panels')).body;
    const runner = panels.find((p: any) => p.name === 'runner');
    expect(runner).toMatchObject({ id: 'pan_mine00000001', label: 'Our Runner' });
  });
});
