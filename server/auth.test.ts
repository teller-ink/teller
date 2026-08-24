// Rule 7 over HTTP: one key, assignments, tickets. These tests are the
// story of a screen's life — a stranger, a code, an adoption, a role —
// and of every door staying shut until the role opens it.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRAFT_LIST, DRAFT_MARK, isDraft } from '../core/entity.ts';
import { createCampaign, openShelf } from '../core/store.ts';
import { checkTicket, loadDmKey, mintTicket } from './auth.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';

const KEY = 'test-key-0123456789abcdef';

let dir: string;
let session: Session;
let server: Server;
let base: string;

type Headers = Record<string, string>;

async function call(
  method: string,
  path: string,
  opts: { key?: boolean; display?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Headers = {};
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

/** hello → claim → assign: the whole adoption, as the tests' one helper. */
async function adoptScreen(role: string, params: Record<string, unknown> = {}) {
  const hello = await call('POST', '/api/displays/hello', { body: {} });
  const { display, handle } = hello.body;
  const claimed = await call('POST', '/api/displays/claim', {
    key: true,
    body: { code: display.code, name: 'Test Screen' },
  });
  expect(claimed.status).toBe(200);
  const assigned = await call('PATCH', `/api/displays/${display.id}`, {
    key: true,
    body: { role, params },
  });
  expect(assigned.status).toBe(200);
  return { id: display.id as string, handle: handle as string };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-auth-'));
  const shelf = openShelf(dir);
  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
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

describe('the one key', () => {
  it('is minted once and read back forever', () => {
    const minted = loadDmKey(dir);
    expect(minted).toMatch(/^[0-9a-f]{48}$/);
    expect(loadDmKey(dir)).toBe(minted);
  });

  it('gates everything: no key, no table', async () => {
    expect((await call('GET', '/api/campaign')).status).toBe(401);
    expect((await call('GET', '/api/entities')).status).toBe(401);
    expect((await call('GET', '/api/events')).status).toBe(401);
    expect((await call('GET', '/api/displays')).status).toBe(401);
    expect(
      (await call('POST', '/api/entities', { body: { draft: { name: 'X' } } }))
        .status,
    ).toBe(401);
    // Nothing leaked past the door.
    expect((await call('GET', '/api/entities', { key: true })).body).toEqual([]);
  });
});

describe('tickets', () => {
  it('opens only its own subject, until it expires', () => {
    const ticket = mintTicket(KEY, 'stream:abc', 5);
    expect(checkTicket(KEY, 'stream:abc', ticket)).toBe(true);
    expect(checkTicket(KEY, 'stream:other', ticket)).toBe(false);
    expect(checkTicket('wrong-key', 'stream:abc', ticket)).toBe(false);
    // A client can't extend its own expiry — the signature covers it.
    const [, sig] = ticket.split('.');
    expect(checkTicket(KEY, 'stream:abc', `${Date.now() + 9e9}.${sig}`)).toBe(false);
    const dead = mintTicket(KEY, 'stream:abc', -1);
    expect(checkTicket(KEY, 'stream:abc', dead)).toBe(false);
  });

  it('guards the stream itself', async () => {
    const bare = await fetch(`${base}/api/stream`);
    expect(bare.status).toBe(401);
    const forged = await fetch(`${base}/api/stream?handle=dm&ticket=1.abc`);
    expect(forged.status).toBe(401);
  });
});

describe("a screen's life", () => {
  it('hello mints a stranger with a code and confers nothing', async () => {
    const hello = await call('POST', '/api/displays/hello', { body: {} });
    expect(hello.status).toBe(200);
    const { display, handle } = hello.body;
    expect(display.id).toMatch(/^dsp_[0-9a-f]{48}$/);
    expect(display.role).toBe('blank');
    expect(display.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(handle).toMatch(/^[0-9a-f]{64}$/);

    // Same id, same screen.
    const again = await call('POST', '/api/displays/hello', {
      body: { id: display.id },
    });
    expect(again.body.display.id).toBe(display.id);

    // Unclaimed: not at this table, and no permission slip either.
    expect(
      (await call('GET', '/api/campaign', { display: display.id })).status,
    ).toBe(401);
    expect(
      (await call('GET', '/api/ticket', { display: display.id })).status,
    ).toBe(401);
  });

  it('adoption is by code, and the code is consumed', async () => {
    const hello = await call('POST', '/api/displays/hello', { body: {} });
    const { display } = hello.body;

    const wrong = await call('POST', '/api/displays/claim', {
      key: true,
      body: { code: 'NOPE99' },
    });
    expect(wrong.status).toBe(404);

    const claimed = await call('POST', '/api/displays/claim', {
      key: true,
      body: { code: display.code, name: 'Table TV' },
    });
    expect(claimed.status).toBe(200);
    expect(claimed.body.code).toBeUndefined();
    expect(claimed.body.name).toBe('Table TV');

    // Adopted: may watch, may hold a ticket, and the ticket opens the stream.
    expect(
      (await call('GET', '/api/campaign', { display: display.id })).status,
    ).toBe(200);
    const slip = await call('GET', '/api/ticket', { display: display.id });
    expect(slip.status).toBe(200);
    const stream = await fetch(
      `${base}/api/stream?handle=${slip.body.handle}&ticket=${slip.body.ticket}`,
    );
    expect(stream.status).toBe(200);
    await stream.body?.cancel();

    // The same code buys nothing twice.
    const reused = await call('POST', '/api/displays/claim', {
      key: true,
      body: { code: display.code },
    });
    expect(reused.status).toBe(404);
  });

  it('a seat files its OWN roll and nobody else\'s', async () => {
    const own = session.create({ name: 'Barrett', lists: {} }, 'console');
    const other = session.create({ name: 'Sal', lists: {} }, 'console');
    const seat = await adoptScreen('seat', { entityId: own.id });
    const roll = { pool: '2B', faces: ['hit'], total: 1 };

    const mine = await call('POST', '/api/rolls', {
      display: seat.id,
      body: { ...roll, by: own.id, byName: 'Barrett', for: 'Used Pistol — Short' },
    });
    expect(mine.status).toBe(200);

    // Somebody else's dice, and dice belonging to nobody at all.
    expect(
      (await call('POST', '/api/rolls', { display: seat.id, body: { ...roll, by: other.id } }))
        .status,
    ).toBe(401);
    expect((await call('POST', '/api/rolls', { display: seat.id, body: roll })).status).toBe(401);

    const events = await call('GET', `/api/events?entity=${own.id}`, { key: true });
    expect(events.body.some((e: any) => e.kind === 'dice.rolled')).toBe(true);
  });

  it('a seat edits its one entity and nobody else', async () => {
    const own = session.create({ name: 'Barrett', lists: {} }, 'console');
    const other = session.create({ name: 'Sal', lists: {} }, 'console');
    const seat = await adoptScreen('seat', { entityId: own.id });

    const read = await call('GET', `/api/entities/${own.id}`, { display: seat.id });
    expect(read.status).toBe(200);
    read.body.notes = 'my own notes';
    const write = await call('PUT', `/api/entities/${own.id}`, {
      display: seat.id,
      body: { entity: read.body },
    });
    expect(write.status).toBe(200);

    // The actor is the assignment, not whatever the client claims.
    const events = await call('GET', `/api/events?entity=${own.id}`, { key: true });
    expect(events.body[0].actor).toBe(`seat:${own.id}`);

    // The neighbour's sheet: unreadable, unwritable.
    expect(
      (await call('GET', `/api/entities/${other.id}`, { display: seat.id })).status,
    ).toBe(401);
    expect(
      (
        await call('PUT', `/api/entities/${other.id}`, {
          display: seat.id,
          body: { entity: { ...other, notes: 'graffiti' } },
        })
      ).status,
    ).toBe(401);

    // And a seat is not a DM.
    expect(
      (await call('POST', '/api/entities', { display: seat.id, body: { draft: { name: 'New' } } }))
        .status,
    ).toBe(401);
    expect(
      (await call('DELETE', `/api/entities/${other.id}`, { display: seat.id })).status,
    ).toBe(401);
    expect((await call('GET', '/api/events', { display: seat.id })).status).toBe(401);
  });

  // The console's "+ new character…" — the old app's stamp flow, cut
  // down to what the seat's builder left it. Two ordinary doors, in
  // this order: make somebody wearing the draft mark, then point the
  // screen at them. Nothing here is special-cased, which is the point.
  it('a seat can be given somebody new to be, still being made', async () => {
    const seat = await adoptScreen('seat');

    const made = await call('POST', '/api/entities', {
      key: true,
      body: {
        draft: {
          name: 'Drifter',
          type: 'pc',
          lists: { [DRAFT_LIST]: [{ name: DRAFT_MARK }] },
        },
      },
    });
    expect(made.status).toBe(201);
    expect(made.body.name).toBe('Drifter');
    expect(isDraft(made.body)).toBe(true);

    const pointed = await call('PATCH', `/api/displays/${seat.id}`, {
      key: true,
      body: { params: { entityId: made.body.id } },
    });
    expect(pointed.status).toBe(200);
    expect(pointed.body.params.entityId).toBe(made.body.id);

    // The seat owns them now, and reads a draft like any other sheet.
    const read = await call('GET', `/api/entities/${made.body.id}`, {
      display: seat.id,
    });
    expect(read.status).toBe(200);
    expect(isDraft(read.body)).toBe(true);

    // Ordinary data, so the mark comes off the ordinary way (rule 1) —
    // which is exactly what the builder's last step does.
    const done = { ...read.body, lists: { ...read.body.lists, [DRAFT_LIST]: [] } };
    const cleared = await call('PUT', `/api/entities/${made.body.id}`, {
      display: seat.id,
      body: { entity: done },
    });
    expect(cleared.status).toBe(200);
    expect(isDraft(cleared.body)).toBe(false);

    // And it was written down, both halves (rule 3).
    const events = await call('GET', `/api/events?entity=${made.body.id}`, { key: true });
    expect(events.body.map((e: any) => e.kind)).toContain('entity.created');
  });

  it('a passive screen watches and never writes', async () => {
    const board = await adoptScreen('board');
    expect((await call('GET', '/api/boards', { display: board.id })).status).toBe(200);
    expect((await call('GET', '/api/entities', { display: board.id })).status).toBe(200);
    expect(
      (
        await call('PUT', '/api/board-state/brd_x', {
          display: board.id,
          body: { data: {} },
        })
      ).status,
    ).toBe(401);
  });

  it('a console screen has the full authority of its assignment', async () => {
    const console_ = await adoptScreen('console');
    const made = await call('POST', '/api/entities', {
      display: console_.id,
      body: { draft: { name: 'Rook' } },
    });
    expect(made.status).toBe(201);
    // Role-derived, not key-derived: demote it and the power is gone.
    await call('PATCH', `/api/displays/${console_.id}`, {
      key: true,
      body: { role: 'blank' },
    });
    expect(
      (
        await call('POST', '/api/entities', {
          display: console_.id,
          body: { draft: { name: 'Rook 2' } },
        })
      ).status,
    ).toBe(401);
  });

  it('an assignment change reaches exactly that screen on the stream', async () => {
    const screen = await adoptScreen('board');
    const slip = await call('GET', '/api/ticket', { display: screen.id });
    const res = await fetch(
      `${base}/api/stream?handle=${slip.body.handle}&ticket=${slip.body.ticket}`,
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const drain = (async () => {
      while (!text.includes('data: assign')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    })();
    await new Promise((r) => setTimeout(r, 50));
    await call('PATCH', `/api/displays/${screen.id}`, {
      key: true,
      body: { role: 'art' },
    });
    await drain;
    expect(text).toContain('data: assign');
    await reader.cancel();
  });
});
