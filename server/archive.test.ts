// `GET /api/packs/<pak_id>/export` and `GET /api/panels/<pan_id>/export`
// — rule 4a's "zipped it's a `.pack` you hand someone", over HTTP.
//
// The way IN has no route on purpose (the sweep is the door), so these
// two are the whole export surface. What's pinned here is the gate (DM
// only, like the shelf listing it sits beside), the file it hands back
// (a real archive, named after the folder), and the FULL LOOP: what
// leaves one host installs on another and reads back the same.
//
// Real folders and a real socket, like `panels-copy.test.ts`: an archive
// is a thing the filesystem does, and a stubbed one would pin a shape no
// running host produces.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveJson, openArchive } from '../core/archive.ts';
import { sweepPacks } from '../core/packs-shelf.ts';
import { defaultPanels, sweepPanels } from '../core/panels-shelf.ts';
import { openShelf, type Shelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Host } from './session.ts';

let dir: string;
let shelf: Shelf;
let host: Host;
let server: Server;
let base: string;

const KEY = 'test-key-0123456789abcdef';

function json(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

async function api(method: string, path: string, key: string | null = KEY) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: key ? { 'x-teller-key': key } : {},
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as { error?: string },
  };
}

/** The bytes of a download, plus how the response named the file. */
async function file(path: string, key: string | null = KEY) {
  const res = await fetch(`${base}${path}`, { headers: key ? { 'x-teller-key': key } : {} });
  return {
    status: res.status,
    disposition: res.headers.get('Content-Disposition') ?? '',
    type: res.headers.get('Content-Type') ?? '',
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-export-'));

  const sys = join(dir, 'systems', 'wiw');
  json(join(sys, 'system.json'), { id: 'sys_wiw', name: 'The System', version: 1 });

  const pack = join(dir, 'packs', 'the-guidebook');
  json(join(pack, 'pack.json'), {
    id: 'pak_guide00000001',
    system: 'sys_wiw',
    name: 'The Guidebook',
    version: 4,
    rights: { status: 'personal', holder: 'the author' },
  });
  json(join(pack, 'bestiary.json'), [
    { id: 'foe_1', name: 'Coyote', art: 'art/coyote.png', lists: {} },
    { id: 'foe_2', name: 'Rattler', lists: {} },
  ]);
  write(join(pack, 'art', 'coyote.png'), 'pixels');

  json(join(dir, 'panels', 'house-log', 'panel.json'), {
    id: 'pan_house00000001',
    name: 'house-log',
    label: 'House Log',
    mounted: [{ block: 'log' }],
  });
  write(join(dir, 'panels', 'house-log', 'style.css'), '.log { color: red }\n');

  shelf = openShelf(dir);
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

describe('exporting a pack', () => {
  it('hands back an archive named after the folder', async () => {
    const out = await file('/api/packs/pak_guide00000001/export');
    expect(out.status).toBe(200);
    expect(out.type).toBe('application/zip');
    expect(out.disposition).toBe('attachment; filename="the-guidebook.pack"');

    const files = openArchive(out.bytes);
    expect([...files.keys()].sort()).toEqual([
      'art/coyote.png',
      'bestiary.json',
      'pack.json',
    ]);
    expect(archiveJson(files, 'pack.json')).toMatchObject({
      id: 'pak_guide00000001',
      version: 4,
      rights: { status: 'personal', holder: 'the author' },
    });
  });

  it('is the DM\'s business and nobody else\'s', async () => {
    expect((await file('/api/packs/pak_guide00000001/export', null)).status).toBe(401);
  });

  it('a pak_ id with no folder on this host is a 404, not an empty file', async () => {
    const { status, body } = await api('GET', '/api/packs/pak_nothing/export');
    expect(status).toBe(404);
    expect(body.error).toMatch(/no pack folder/);
  });
});

describe('exporting a panel', () => {
  it('hands back the table\'s own panel, id and all', async () => {
    const out = await file('/api/panels/pan_house00000001/export');
    expect(out.status).toBe(200);
    expect(out.disposition).toBe('attachment; filename="house-log.panel"');
    const files = openArchive(out.bytes);
    expect([...files.keys()].sort()).toEqual(['panel.json', 'style.css']);
    expect(archiveJson(files, 'panel.json')).toMatchObject({
      id: 'pan_house00000001',
      name: 'house-log',
    });
  });

  it("finds teller's own shipped defaults too — the fourth place it looks", async () => {
    const log = defaultPanels().find((p) => p.name === 'log');
    const out = await file(`/api/panels/${log?.id}/export`);
    expect(out.status).toBe(200);
    expect(out.disposition).toBe('attachment; filename="log.panel"');
    expect(archiveJson(openArchive(out.bytes), 'panel.json')).toMatchObject({ name: 'log' });
  });

  it('a pan_ id with no folder anywhere is a 404', async () => {
    const { status, body } = await api('GET', '/api/panels/pan_not_a_panel/export');
    expect(status).toBe(404);
    expect(body.error).toMatch(/no panel folder/);
  });

  it('requires the key', async () => {
    expect((await file('/api/panels/pan_house00000001/export', null)).status).toBe(401);
  });
});

describe('the loop — what leaves this host installs on the next one', () => {
  it('pack: export, drop, sweep, identical', async () => {
    const here = sweepPacks(dir, shelf);
    const bytes = (await file('/api/packs/pak_guide00000001/export')).bytes;

    const other = mkdtempSync(join(tmpdir(), 'teller-export-there-'));
    const otherShelf = openShelf(other);
    try {
      mkdirSync(join(other, 'packs'), { recursive: true });
      writeFileSync(join(other, 'packs', 'the-guidebook.pack'), bytes);
      const there = sweepPacks(other, otherShelf);
      expect(there.problems).toEqual([]);
      expect(there.packs).toEqual(here.packs);
      expect(there.packs[0].version).toBe(4);
      // The art reference resolves to bytes that actually arrived.
      const art = (there.packs[0].data.bestiary as { art?: string }[])[0].art;
      expect(art).toBe('art/pak_guide00000001/coyote.png');
      expect(readFileSync(join(other, 'art', 'pak_guide00000001', 'coyote.png'), 'utf8')).toBe(
        'pixels',
      );
    } finally {
      otherShelf.close();
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('panel: export, drop, sweep, identical', async () => {
    const here = sweepPanels(dir).panels;
    const bytes = (await file('/api/panels/pan_house00000001/export')).bytes;

    const other = mkdtempSync(join(tmpdir(), 'teller-export-there-'));
    try {
      mkdirSync(join(other, 'panels'), { recursive: true });
      writeFileSync(join(other, 'panels', 'house-log.panel'), bytes);
      const there = sweepPanels(other);
      expect(there.problems).toEqual([]);
      expect(there.panels).toEqual(here);
      expect(existsSync(join(other, 'panels', 'house-log', 'style.css'))).toBe(true);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
