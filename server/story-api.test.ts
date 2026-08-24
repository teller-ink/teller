// The four `.story` routes — the seam between the format and a socket.
//
// `story.test.ts` holds the format's laws; what's worth pinning HERE is
// the plumbing that would rot silently: that two of the doors work on a
// host with nothing running (you can look in a box, and you can start a
// campaign from one), that the two that touch the table refuse with a
// 503 rather than a 401, and that a file which isn't a story is a 400
// and not a stack trace.

import { mkdtempSync, rmSync } from 'node:fs';
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

/** The bytes doors: a buffer in, and either a file or a report back. */
async function send(
  path: string,
  bytes: Buffer,
  key = KEY,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'x-teller-key': key, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
  });
  return { status: res.status, body: await res.json() };
}

/** Export the running campaign and hand back the file plus its headers. */
async function exported(
  body: unknown = {},
): Promise<{ bytes: Buffer; filename: string; skipped: string[] }> {
  const res = await fetch(`${base}/api/story/export`, {
    method: 'POST',
    headers: { 'x-teller-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    filename: /filename="([^"]+)"/.exec(disposition)?.[1] ?? '',
    skipped: JSON.parse(decodeURIComponent(res.headers.get('x-story-skipped') ?? '%5B%5D')),
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-story-api-'));
  shelf = openShelf(dir);
  shelf.putSystem({ id: 'sys_test', name: 'Test', version: 1, data: {} });
  // A bare host: no campaign at all, which two of the four doors must
  // survive and two must refuse.
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

/** Start a table with something on it, so an export has something to carry. */
async function playing(name = 'The Unlikely Duo'): Promise<void> {
  const made = await api('POST', '/api/campaigns', { name, system: 'sys_test' });
  expect(made.status).toBe(201);
  const cast = await api('POST', '/api/entities', {
    draft: { name: 'Barrett', type: 'character' },
  });
  expect(cast.status).toBe(201);
}

describe('a host with no campaign', () => {
  it('refuses the two doors that touch the table, with a 503', async () => {
    expect((await api('GET', '/api/story')).status).toBe(503);
    expect((await api('POST', '/api/story/export', {})).status).toBe(503);
    expect((await send('/api/story/import', Buffer.from('nope'))).status).toBe(503);
  });

  it('still lets you look inside a file, and start one', async () => {
    // Nothing to import yet — but the door answers 400 (not a story)
    // rather than 503 (no campaign), which is the distinction.
    expect((await send('/api/story/inspect', Buffer.from('nope'))).status).toBe(400);
    expect((await send('/api/campaigns/from-story', Buffer.from('nope'))).status).toBe(400);
  });
});

describe('export', () => {
  it('hands back a named file, and stamps the version it just wrote', async () => {
    await playing();
    const first = await exported();
    expect(first.filename).toBe('the-unlikely-duo.story');
    expect(first.bytes.length).toBeGreaterThan(0);
    expect(first.skipped).toEqual([]);

    // The identity is remembered, and counts exports.
    const held = await api('GET', '/api/story');
    expect(held.body.identity.version).toBe(1);
    expect(held.body.identity.rights).toEqual({ basis: 'personal' });
    expect(held.body.name).toBe('The Unlikely Duo');

    // A declared rights basis is stated once and then remembered.
    await exported({ rights: { basis: 'homebrew', holder: 'Brian' } });
    const again = await api('GET', '/api/story');
    expect(again.body.identity.version).toBe(2);
    expect(again.body.identity.rights).toEqual({ basis: 'homebrew', holder: 'Brian' });
  });

  it('drops the sections it was told to drop', async () => {
    await playing();
    const whole = await exported();
    const light = await exported({ sections: { events: false, undo: false, assets: false } });
    expect(light.bytes.length).toBeLessThan(whole.bytes.length);

    const looked = await send('/api/story/inspect', light.bytes);
    expect(looked.status).toBe(200);
    expect(looked.body.sections.map((s: { name: string }) => s.name)).not.toContain('events');
  });

  it('is the DM’s business and nobody else’s', async () => {
    await playing();
    const res = await fetch(`${base}/api/story/export`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('inspect', () => {
  it('says what is in the box, and what this host has not got', async () => {
    await playing();
    const file = await exported();
    const { status, body } = await send('/api/story/inspect', file.bytes);
    expect(status).toBe(200);
    expect(body.manifest.name).toBe('The Unlikely Duo');
    expect(body.kind).toBeTypeOf('string');
    expect(body.sections.length).toBeGreaterThan(0);
    expect(body.missing).toEqual([]);
  });

  it('answers 400 for something that is not a story', async () => {
    const { status, body } = await send('/api/story/inspect', Buffer.from('hello'));
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/not a \.story|not an archive/);
  });
});

describe('the campaign door', () => {
  it('creates a campaign from the file, plays it, and lists it', async () => {
    await playing();
    const file = await exported();

    const made = await send('/api/campaigns/from-story?name=A%20Copy', file.bytes);
    expect(made.status).toBe(201);
    expect(made.body.slug).toBe('a-copy');
    expect(made.body.from).toMatch(/^sto_/);
    expect(made.body.applied.length).toBeGreaterThan(0);

    // Importing it plays it — you opened it to run it.
    const list = await api('GET', '/api/campaigns');
    expect(list.body.active).toBe('a-copy');
    expect(list.body.campaigns.map((c: { slug: string }) => c.slug).sort()).toEqual([
      'a-copy',
      'the-unlikely-duo',
    ]);

    // And the roster came with it.
    const entities = await api('GET', '/api/entities');
    expect(entities.body.map((e: { name: string }) => e.name)).toContain('Barrett');
  });
});

describe('layering onto a running table', () => {
  it('reports what it applied, and leaves history where it happened', async () => {
    await playing();
    const file = await exported();
    // Onto a fresh table, so nothing here is an argument with the
    // campaign the file came from.
    await api('POST', '/api/campaigns', { name: 'Another Table', system: 'sys_test' });

    const { status, body } = await send('/api/story/import', file.bytes);
    expect(status).toBe(200);
    expect(body.applied.length).toBeGreaterThan(0);
    expect(body.missing).toEqual([]);
    expect(body.skipped.join(' ')).toMatch(/history stays with the table that lived it/);

    const entities = await api('GET', '/api/entities');
    expect(entities.body.map((e: { name: string }) => e.name)).toContain('Barrett');
  });

  it('answers 400 for something that is not a story', async () => {
    await playing();
    expect((await send('/api/story/import', Buffer.from('hello'))).status).toBe(400);
  });
});
