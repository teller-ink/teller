// Handouts and passed notes — the two halves of §M-6's last screen.
//
// The tests are written as the LAWS read, because the laws are the
// feature: a handout is a template row whose file is a host asset, the
// active one is a manifest ref, and a note reaches the screen it was
// addressed to AND NO OTHER. That last one is the whole point, so it is
// tested as a truth table over the roles rather than as a happy path.

import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';
import { visibleTo, type PassedNote } from './notes.ts';
import { extFor, toHandout } from './handouts.ts';
import type { Auth } from './auth.ts';

const KEY = 'test-key-0123456789abcdef';

/** The smallest real PNG — enough for the upload door to have bytes to hash. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('the handout row, read defensively', () => {
  it('needs an id and a key, and takes its notes from either place', () => {
    expect(toHandout({ id: 'tpl_1', name: 'Poster', data: { key: 'art/handouts/a.png' } })).toEqual({
      id: 'tpl_1',
      name: 'Poster',
      key: 'art/handouts/a.png',
    });
    expect(toHandout({ id: 'tpl_1', name: 'x', data: {} })).toBeUndefined();
    expect(toHandout({ name: 'x', data: { key: 'k' } })).toBeUndefined();
    expect(toHandout(null)).toBeUndefined();
    expect(
      toHandout({ id: 'tpl_1', name: 'x', data: { key: 'k', notes: 'the seal is broken' } })?.notes,
    ).toBe('the seal is broken');
  });

  it('takes pictures and nothing else', () => {
    expect(extFor('image/png')).toBe('png');
    expect(extFor('image/jpeg; charset=binary')).toBe('jpg');
    expect(extFor('application/pdf')).toBeUndefined();
    expect(extFor('')).toBeUndefined();
  });
});

describe('who a note reaches', () => {
  const notes: PassedNote[] = [
    { id: 'n1', at: 'now', text: 'for barrett', to: ['ent_barrett'] },
    { id: 'n2', at: 'now', text: 'for the room', to: [] },
    { id: 'n3', at: 'now', text: 'for hattie', to: ['ent_hattie'] },
  ];
  const seat = (entityId: string): Auth => ({
    key: false,
    display: { id: 'd', role: 'seat', params: { entityId }, name: 'a seat' } as never,
  });
  const as = (role: string, params: Record<string, unknown> = {}): Auth => ({
    key: false,
    display: { id: 'd', role, params, name: role } as never,
  });
  const said = (auth: Auth) => visibleTo(notes, auth).map((n) => n.id);

  it('gives the DM every one — the review list is how they remember', () => {
    expect(said({ key: true })).toEqual(['n1', 'n2', 'n3']);
    expect(said(as('console'))).toEqual(['n1', 'n2', 'n3']);
  });

  it('gives a seat its own and the table-wide, and nobody else’s', () => {
    expect(said(seat('ent_barrett'))).toEqual(['n1', 'n2']);
    expect(said(seat('ent_hattie'))).toEqual(['n2', 'n3']);
  });

  it('gives a BADGE nothing — outward glass would read it to the room', () => {
    expect(said(as('badge', { entityId: 'ent_barrett' }))).toEqual([]);
  });

  it('gives the other passive surfaces nothing either', () => {
    for (const role of ['table', 'board', 'art', 'blank']) {
      expect(said(as(role))).toEqual([]);
    }
  });

  it('gives an unadopted screen nothing, whatever it claims to be', () => {
    expect(
      visibleTo(notes, {
        key: false,
        display: { id: 'd', role: 'seat', code: '4821', params: { entityId: 'ent_barrett' } } as never,
      }),
    ).toEqual([]);
    expect(visibleTo(notes, { key: false })).toEqual([]);
  });
});

describe('the doors', () => {
  let dir: string;
  let session: Session;
  let server: Server;
  let base: string;
  let barrett: string;
  let hattie: string;

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
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  async function upload(
    bytes: Buffer,
    type: string,
    opts: { key?: boolean } = { key: true },
  ): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = { 'Content-Type': type };
    if (opts.key) headers['x-teller-key'] = KEY;
    const res = await fetch(`${base}/api/handouts/upload`, {
      method: 'POST',
      headers,
      body: new Uint8Array(bytes),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  /** A screen the DM adopted and pointed at a role. */
  async function screen(role: string, params?: Record<string, unknown>): Promise<string> {
    const hello = await call('POST', '/api/displays/hello', { body: {} });
    await call('POST', '/api/displays/claim', {
      key: true,
      body: { code: hello.body.display.code },
    });
    await call('PATCH', `/api/displays/${hello.body.display.id}`, {
      key: true,
      body: { role, ...(params ? { params } : {}) },
    });
    return hello.body.display.id;
  }

  /** Upload + name in one — the two calls the gallery's 'add a picture' makes. */
  async function addHandout(name: string): Promise<string> {
    const { body } = await upload(PNG, 'image/png');
    const made = await call('POST', '/api/templates/handouts', {
      key: true,
      body: { template: { name, data: { key: body.key } } },
    });
    return made.body.id;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'teller-notes-'));
    const shelf = openShelf(dir);
    const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
    session = new Session(shelf, campaign, dir);
    barrett = session.create({ name: 'Barrett', lists: {} } as never, 'console').id;
    hattie = session.create({ name: 'Hattie', lists: {} } as never, 'console').id;
    server = serve(session, 0, KEY);
    await new Promise((r) => server.on('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    session.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // -- the picture, and where it lands --------------------------------

  it('takes bytes from the DM and nobody else, and hashes them onto the shelf', async () => {
    expect((await upload(PNG, 'image/png', { key: false })).status).toBe(401);
    expect((await upload(PNG, 'application/pdf')).status).toBe(415);

    const first = await upload(PNG, 'image/png');
    expect(first.status).toBe(201);
    expect(first.body.key).toMatch(/^art\/handouts\/[0-9a-f]{32}\.png$/);
    expect(existsSync(join(dir, first.body.key))).toBe(true);

    // Content-hashed: the same picture twice is one file.
    const again = await upload(PNG, 'image/png');
    expect(again.body.key).toBe(first.body.key);
    expect(readdirSync(join(dir, 'art', 'handouts'))).toHaveLength(1);
  });

  it('is a template row, authored and renamed through the ordinary door', async () => {
    const id = await addHandout('Wanted Poster');
    const listed = await call('GET', '/api/handouts', { key: true });
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id, name: 'Wanted Poster' });

    await call('POST', '/api/templates/handouts', {
      key: true,
      body: { template: { id, name: 'The Warrant', data: { key: listed.body[0].key } } },
    });
    const after = await call('GET', '/api/handouts', { key: true });
    expect(after.body[0]).toMatchObject({ id, name: 'The Warrant' });
    // Identity is the id, never the name (rule 4a).
    expect(after.body).toHaveLength(1);
  });

  it('refuses the gallery to player-facing glass, and allows a seat', async () => {
    await addHandout('Wanted Poster');
    const table = await screen('table');
    const seat = await screen('seat', { entityId: barrett });
    expect((await call('GET', '/api/handouts', { display: table })).status).toBe(401);
    expect((await call('GET', '/api/handouts', { display: seat })).status).toBe(200);
  });

  // -- the frame ------------------------------------------------------

  it('shows and clears through the refs door, and the snapshot carries it', async () => {
    const id = await addHandout('Wanted Poster');
    expect((await call('GET', '/api/public', { key: true })).body.handout).toBe(null);

    const shown = await call('PUT', '/api/campaign/refs', { key: true, body: { handout: id } });
    expect(shown.status).toBe(200);
    expect(shown.body.handout).toMatchObject({ id, name: 'Wanted Poster' });

    const snap = await call('GET', '/api/public', { key: true });
    expect(snap.body.handout).toMatchObject({ id, name: 'Wanted Poster' });
    expect(snap.body.handout.key).toMatch(/^art\/handouts\//);

    await call('PUT', '/api/campaign/refs', { key: true, body: { handout: null } });
    expect((await call('GET', '/api/public', { key: true })).body.handout).toBe(null);
  });

  it('refuses an id that is not a handout of this campaign', async () => {
    const encounter = await call('POST', '/api/templates/encounters', {
      key: true,
      body: { template: { name: 'The Ambush', data: { key: 'art/handouts/nope.png' } } },
    });
    const refused = await call('PUT', '/api/campaign/refs', {
      key: true,
      body: { handout: encounter.body.id },
    });
    expect(refused.status).toBe(400);
    expect((await call('PUT', '/api/campaign/refs', { key: true, body: { handout: 7 } })).status).toBe(400);
  });

  it('logs the reveal and the clearing, so the log is the history (rule 3)', async () => {
    const id = await addHandout('Wanted Poster');
    await call('PUT', '/api/campaign/refs', { key: true, body: { handout: id } });
    await call('PUT', '/api/campaign/refs', { key: true, body: { handout: null } });
    const events = (await call('GET', '/api/events', { key: true })).body as {
      kind: string;
      payload: any;
    }[];
    const shown = events.find((e) => e.kind === 'handout.shown');
    expect(shown?.payload).toMatchObject({ id, name: 'Wanted Poster' });
    expect(events.some((e) => e.kind === 'handout.cleared')).toBe(true);
  });

  it('removing one takes the bytes and the frame with it', async () => {
    const id = await addHandout('Wanted Poster');
    const key = (await call('GET', '/api/handouts', { key: true })).body[0].key;
    await call('PUT', '/api/campaign/refs', { key: true, body: { handout: id } });

    const seat = await screen('seat', { entityId: barrett });
    expect((await call('DELETE', `/api/handouts/${id}`, { display: seat })).status).toBe(401);

    expect((await call('DELETE', `/api/handouts/${id}`, { key: true })).status).toBe(200);
    expect((await call('GET', '/api/handouts', { key: true })).body).toEqual([]);
    expect((await call('GET', '/api/public', { key: true })).body.handout).toBe(null);
    expect(existsSync(join(dir, key))).toBe(false);
    expect((await call('DELETE', `/api/handouts/${id}`, { key: true })).status).toBe(404);
  });

  it('keeps the bytes while another row still names them', async () => {
    const first = await addHandout('Wanted Poster');
    await addHandout('The Same Poster');
    const key = (await call('GET', '/api/handouts', { key: true })).body[0].key;
    await call('DELETE', `/api/handouts/${first}`, { key: true });
    expect(existsSync(join(dir, key))).toBe(true);
  });

  // -- the note -------------------------------------------------------

  it('needs words or a picture, and a recipient who exists', async () => {
    expect((await call('POST', '/api/notes', { key: true, body: {} })).status).toBe(400);
    expect(
      (await call('POST', '/api/notes', { key: true, body: { text: '   ' } })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/notes', { key: true, body: { text: 'hi', to: ['ent_nobody'] } }))
        .status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/notes', { key: true, body: { text: 'hi', handoutId: 'tpl_no' } }))
        .status,
    ).toBe(400);
  });

  it('is the DM’s to pass, and nobody else’s', async () => {
    const seat = await screen('seat', { entityId: barrett });
    expect(
      (await call('POST', '/api/notes', { display: seat, body: { text: 'psst' } })).status,
    ).toBe(401);
  });

  it('reaches the seat it was addressed to and no other', async () => {
    const his = await screen('seat', { entityId: barrett });
    const hers = await screen('seat', { entityId: hattie });
    const badge = await screen('badge', { entityId: barrett });
    const art = await screen('art');

    await call('POST', '/api/notes', {
      key: true,
      body: { text: 'the sheriff already knows', to: [barrett] },
    });

    const mine = async (display: string) =>
      ((await call('GET', '/api/notes/mine', { display })).body as PassedNote[]).map((n) => n.text);

    expect(await mine(his)).toEqual(['the sheriff already knows']);
    expect(await mine(hers)).toEqual([]);
    expect(await mine(badge)).toEqual([]);
    expect(await mine(art)).toEqual([]);

    // Untargeted is the whole table — the DM notice, same act, wider.
    await call('POST', '/api/notes', { key: true, body: { text: 'the lamps go out' } });
    expect(await mine(his)).toEqual(['the lamps go out', 'the sheriff already knows']);
    expect(await mine(hers)).toEqual(['the lamps go out']);
    // Still nothing on outward-facing glass, table-wide or not.
    expect(await mine(badge)).toEqual([]);
  });

  it('carries the handout resolved, so a seat needs no second door', async () => {
    const id = await addHandout('Wanted Poster');
    const seat = await screen('seat', { entityId: barrett });
    const passed = await call('POST', '/api/notes', {
      key: true,
      body: { handoutId: id, to: [barrett] },
    });
    expect(passed.status).toBe(201);
    const [got] = (await call('GET', '/api/notes/mine', { display: seat })).body as PassedNote[];
    expect(got.handout).toMatchObject({ id, name: 'Wanted Poster' });
    expect(got.handout?.key).toMatch(/^art\/handouts\//);
  });

  it('never puts a note in the payload the whole room renders', async () => {
    await call('POST', '/api/notes', {
      key: true,
      body: { text: 'the sheriff already knows', to: [barrett] },
    });
    const snap = await call('GET', '/api/public', { key: true });
    expect(JSON.stringify(snap.body)).not.toContain('sheriff');
    expect(snap.body.notes).toBeUndefined();
  });

  it('files the permanent record in the log (rule 3), and the DM can review the pile', async () => {
    await call('POST', '/api/notes', {
      key: true,
      body: { text: 'the sheriff already knows', to: [barrett] },
    });
    const events = (await call('GET', '/api/events', { key: true })).body as {
      kind: string;
      payload: any;
    }[];
    const row = events.find((e) => e.kind === 'note.passed');
    expect(row?.payload).toMatchObject({ to: [barrett], text: 'the sheriff already knows' });

    const review = await call('GET', '/api/notes', { key: true });
    expect(review.body).toHaveLength(1);
    const seat = await screen('seat', { entityId: barrett });
    expect((await call('GET', '/api/notes', { display: seat })).status).toBe(401);
  });
});
